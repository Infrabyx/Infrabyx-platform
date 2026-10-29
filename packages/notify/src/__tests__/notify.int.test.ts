// @infrabyx/notify on PostgreSQL 18 with every platform migration applied (PL3 plan §6, §12).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PortError } from "@infrabyx/contracts/errors";
import type { KernelContext } from "@infrabyx/contracts/kernel";
import type { EmailMessage, EmailPort, SmsPort } from "@infrabyx/contracts/ports";
import { PgSettingsStore, SettingsService } from "@infrabyx/config/settings";
import { ExpoPush } from "@infrabyx/connectors/push";
import { SecretKey, localTenantKeyId } from "@infrabyx/crypto";
import { FieldCrypto, PgOutbox } from "@infrabyx/tenancy";
import {
  fakeKms,
  startExpoStub,
  startPostgres,
  withTenant,
  type ExpoStub,
  type TestDatabase,
} from "@infrabyx/testing";
import {
  Catalogue,
  lintCatalogues,
  PLATFORM_CATALOGUE_PATH,
  readCatalogueFiles,
} from "../catalogue.js";
import { notifyApprovalNotifier } from "../approval-notifier.js";
import { PgPushTokenStore } from "../push-store.js";
import { notifyOtpSender } from "../otp-sender.js";
import { notifyContext, NotifyService } from "../service.js";

let db: TestDatabase;
let expo: ExpoStub;
let svc: NotifyService;
let pushStore: PgPushTokenStore;
const killed = new Set<string>();
const sent: Array<{ to: string[]; template: string; key?: string }> = [];
let emailMode: "ok" | "unknown" | "unknown_once" = "ok";
const consentEvents: Array<Record<string, unknown>> = [];
let now = new Date("2026-10-26T16:45:00Z"); // 22:15 IST

const email: EmailPort = {
  descriptor: { port: "EMAIL", adapter: "fake-email", residency: "IN", maxDataClass: "INTERNAL" },
  health: async () => ({ status: "up", latency_ms: 0, checked_at: new Date().toISOString() }),
  async send(m: EmailMessage, call) {
    if (emailMode !== "ok") {
      if (emailMode === "unknown_once") emailMode = "ok";
      throw new PortError("IPB-PORT-002", "EMAIL", { adapter: "fake-email", detail: "timeout" });
    }
    sent.push({
      to: m.to,
      template: m.template,
      ...(call?.idempotencyKey ? { key: call.idempotencyKey } : {}),
    });
    return { messageId: `msg-${sent.length}` };
  },
  sendRaw: async () => ({ messageId: "raw" }),
  getStatus: async () => ({ status: "sent" }),
  verifyWebhook: async () => [],
  verifyDomain: async () => ({
    verified: true,
    dnsRecords: [
      { type: "TXT", name: "example.test", value: "v=spf1 include:amazonses.com ~all" },
      { type: "CNAME", name: "abc._domainkey.example.test", value: "abc.dkim.amazonses.com" },
    ],
  }),
  suppress: async () => undefined,
};
const smsSent: string[] = [];
const smsVars: string[][] = [];
const sms = {
  descriptor: { port: "SMS", adapter: "fake-sms", residency: "IN", maxDataClass: "INTERNAL" },
  health: email.health,
  send: async (m: { to: string; templateId: string; vars: string[] }) => {
    smsSent.push(m.templateId);
    smsVars.push(m.vars);
    return { messageId: `sms-${smsSent.length}` };
  },
  getStatus: async () => ({ status: "sent" }),
  registerTemplate: async () => undefined,
  verifyWebhook: async () => [],
} as unknown as SmsPort;

const contacts: Record<string, { email?: string; phone?: string }> = {
  usr_u: { email: "user.u@example.test", phone: "+919800000001" },
  usr_c: { email: "checker.c@example.test" },
  usr_m: { email: "marketing.m@example.test" },
  usr_b: { email: "bounce.b@example.test" },
};
const user = (id: string, tenantId = "tnt_a"): KernelContext =>
  withTenant(tenantId, ["ORG_MEMBER"], { principal: { id } });
const admin = withTenant("tnt_a", ["ORG_ADMIN"], { principal: { id: "usr_admin" } });
const req = (cls: string, to: string[], key: string, over: Record<string, unknown> = {}) => ({
  class: cls,
  to: to.map((ref) => ({ ref })),
  vars: { id: "x1" },
  deepLink: "/x/x1",
  idempotencyKey: key,
  ...over,
});
const states = async (id: string) =>
  Object.fromEntries(
    (await svc.deliveryStatus(admin, id)).map((d) => [`${d.recipient}:${d.channel}`, d.state]),
  );

const product = {
  catalogue: "test",
  version: 1,
  classes: [
    {
      id: "mkt.offers",
      category: "marketing",
      marketing_purpose: "MARKETING_EMAIL",
      urgent: true,
      resend: "hold",
      default_channels: ["email"],
      help_key: "ntf.mkt.offers",
      deep_link: "/offers",
      templates: { email: { key: "mkt.offers", locales: ["en"] } },
    },
    {
      id: "loan.collection_reminder",
      category: "regulatory",
      mandatory: true,
      urgent: true,
      resend: "hold",
      default_channels: ["sms", "email"],
      never_channels: ["whatsapp"],
      help_key: "ntf.loan.collection_reminder",
      deep_link: "/loans/{id}",
      templates: {
        email: { key: "loan.collection", locales: ["en"] },
        sms: { dlt_template_id: "1107161234567890123", header: "IBXLND" },
      },
    },
    {
      id: "security.sign_in_code",
      category: "security",
      mandatory: true,
      urgent: true,
      bypass_quiet_hours: true,
      resend: "hold",
      default_channels: ["sms"],
      help_key: "ntf.security.sign_in_code",
      deep_link: "/sign-in",
      templates: { sms: { dlt_template_id: "1107161234567890999", header: "IBXLND" } },
    },
  ],
};

beforeAll(async () => {
  db = await startPostgres();
  expo = await startExpoStub();
  await db.admin.query(
    "insert into tenancy.tenant (id, product, name) values ('tnt_a', 'LD', 'A'), ('tnt_b', 'LD', 'B'), ('tnt_platform', 'LD', 'P') on conflict do nothing",
  );
  const outbox = new PgOutbox();
  const fieldCrypto = new FieldCrypto({ kms: fakeKms(), keyIdFor: localTenantKeyId });
  const settings = new SettingsService({
    store: new PgSettingsStore(),
    kernel: db.kernel,
    audit: db.audit,
    product: "LD",
    outbox,
  });
  pushStore = new PgPushTokenStore({ kernel: db.kernel, audit: db.audit, fieldCrypto });
  svc = new NotifyService({
    kernel: db.kernel,
    audit: db.audit,
    product: "LD",
    outbox,
    catalogue: new Catalogue([
      ...readCatalogueFiles([PLATFORM_CATALOGUE_PATH]),
      { file: "test.yaml", doc: product },
    ]),
    contacts: {
      async resolve(r, ch) {
        const c = contacts[r.ref];
        const address = ch === "email" ? c?.email : c?.phone;
        return address ? { address } : null;
      },
    },
    channels: {
      email: { port: email, brand: "ld" },
      sms: { port: sms, senderId: "IBXLND", dltEntityId: "1101161234567890123" },
      push: {
        port: new ExpoPush({
          store: pushStore,
          dpaRef: "VAR-EXPO",
          baseUrl: expo.url,
          allowLoopbackHttp: true,
        }),
      },
    },
    flags: { isOn: async (k: string) => killed.has(k) },
    consentKey: new SecretKey("consent:test", "hmac-sha-256", new Uint8Array(32).fill(3)),
    settings,
    humanQueue: {
      raise: async (tx, item) => ({
        id: `ibx_${(await tx.query("select 1")).rowCount}${item.recordRef.slice(-4)}`,
      }),
    },
    onConsentChanged: async (_tx, d) => void consentEvents.push(d),
    now: () => now,
  });
});
afterAll(async () => {
  await expo?.close();
  await db?.end();
});

describe("@IPB-07-AT-22 digest-first and quiet hours", () => {
  it("a mention at 22:15 waits for the 08:30 digest; an approval request is sent at once", async () => {
    const m = await svc.send(admin, req("inbox.mention", ["usr_u"], "mention-0001"));
    expect(m.deliveries.map((d) => d.state)).toEqual(["digested", "digested"]);
    const due = await db.admin.query<{ send_after: Date }>(
      "select send_after from notify.delivery where notification_id = $1",
      [m.notificationId],
    );
    expect(due.rows.every((r) => r.send_after.toISOString() === "2026-10-27T03:00:00.000Z")).toBe(
      true,
    );
    const a = await svc.send(admin, req("approval.requested", ["usr_c"], "approval-0001"));
    expect(await states(a.notificationId)).toEqual({
      "usr_c:inapp": "delivered",
      "usr_c:email": "sent",
    });
    expect(sent.at(-1)).toMatchObject({
      to: ["checker.c@example.test"],
      template: "approval.requested",
    });
  });
  it("disabling every channel of a mandatory class is IPB-NTF-001", async () => {
    await expect(
      svc.setPreferences(user("usr_c"), "usr_c", {
        "approval.requested": { inapp: false, email: false },
      }),
    ).rejects.toMatchObject({ code: "IPB-NTF-001" });
    await svc.setPreferences(user("usr_u"), "usr_u", { "inbox.mention": { email: false } });
    const m = await svc.send(admin, req("inbox.mention", ["usr_u"], "mention-0002"));
    expect(m.deliveries.map((d) => d.channel)).toEqual(["inapp"]);
  });
  it("the dispatcher sends one digest per recipient and channel", async () => {
    now = new Date("2026-10-27T03:01:00Z");
    const r = await svc.dispatchDue();
    expect(r.digests).toBeGreaterThanOrEqual(2);
    const ev = await db.admin.query<{ type: string }>(
      "select type from notify.outbox where type like '%NotificationDigestSent%'",
    );
    expect(ev.rowCount).toBeGreaterThanOrEqual(2);
    const left = await db.admin.query(
      "select 1 from notify.delivery where state = 'digested' and send_after <= now()",
    );
    expect(left.rowCount).toBe(0);
    expect((await svc.inapp(user("usr_u"), "usr_u")).some((x) => x.deepLink === "/inbox")).toBe(
      true,
    );
    now = new Date("2026-10-26T16:45:00Z");
  });
});

describe("@IPB-02-AT-20 pattern: kill.msg.<channel> at NOTIFY", () => {
  it("a killed channel is refused before any I/O while the others still deliver", async () => {
    killed.add("kill.msg.email");
    const before = sent.length;
    const r = await svc.send(admin, req("security.login_alert", ["usr_u"], "login-0001"));
    expect(await states(r.notificationId)).toMatchObject({
      "usr_u:email": "killed",
      "usr_u:inapp": "delivered",
    });
    expect(sent.length).toBe(before);
    killed.delete("kill.msg.email");
  });
});

describe("@PL3-NTF-RESEND resend classes (owner, PL2-D-65)", () => {
  it("a safe class is resent once after an unknown outcome, on the same delivery row", async () => {
    emailMode = "unknown_once";
    const r = await svc.send(admin, req("security.mfa_changed", ["usr_u"], "mfa-0001"));
    const d = (await svc.deliveryStatus(admin, r.notificationId)).find(
      (x) => x.channel === "email",
    );
    expect(d).toMatchObject({ state: "sent", attempt: 2 });
    expect(sent.at(-1)?.key).toBe(`${d?.deliveryId}:2`);
  });
  it("a hold class is never resent automatically: held, an inbox task, then a person decides", async () => {
    emailMode = "unknown";
    const r = await svc.send(admin, req("breach.notice", ["usr_u"], "breach-0001"));
    const d = (await svc.deliveryStatus(admin, r.notificationId)).find(
      (x) => x.channel === "email",
    );
    expect(d).toMatchObject({ state: "held", attempt: 1 });
    const held = await db.admin.query<{ type: string }>(
      "select type from notify.outbox where type like '%NotificationHeld%'",
    );
    expect(held.rowCount).toBe(1);
    emailMode = "ok";
    expect(await svc.decideHeld(admin, d?.deliveryId as string, "resend")).toBe("sent");
    const ledger = await db.admin.query(
      "select 1 from audit.ledger where action = 'notify.delivery.resend' and actor_id = 'usr_admin'",
    );
    expect(ledger.rowCount).toBe(1);
  });
});

describe("@PL3-NTF-SUPPRESSION the platform suppression list (C-23)", () => {
  it("a hard bounce suppresses the address for every tenant; the list holds only keyed hashes", async () => {
    const first = await svc.send(admin, req("security.mfa_changed", ["usr_b"], "bounce-0001"));
    const msg = (await svc.deliveryStatus(admin, first.notificationId)).find(
      (x) => x.channel === "email",
    );
    const vendor = (
      await db.admin.query<{ vendor_ref: string }>(
        "select vendor_ref from notify.delivery where id = $1",
        [msg?.deliveryId],
      )
    ).rows[0]?.vendor_ref as string;
    await svc.handleEmailEvents(admin, "fake-email", [
      {
        vendorEventId: "e1",
        messageId: vendor,
        type: "bounced",
        recipient: "Bounce.B@example.test",
        at: new Date().toISOString(),
      },
    ]);
    expect(
      (await svc.deliveryStatus(admin, first.notificationId)).find((x) => x.channel === "email")
        ?.state,
    ).toBe("failed");
    for (const [ctx, key] of [
      [admin, "bounce-0002"],
      [withTenant("tnt_b", ["ORG_ADMIN"], { principal: { id: "usr_admin_b" } }), "bounce-0003"],
    ] as const) {
      const r = await svc.send(ctx, req("security.mfa_changed", ["usr_b"], key));
      expect(
        (await svc.deliveryStatus(ctx, r.notificationId)).find((x) => x.channel === "email")?.state,
      ).toBe("suppressed");
    }
    const rows = JSON.stringify((await db.admin.query("select * from notify.suppression")).rows);
    expect(rows).not.toMatch(/bounce\.b@/i);
    expect(rows).toContain("tnt_platform");
  });
  it("lifting a tenant entry is an R2 maker-checker request (A-08)", async () => {
    const { ApprovalsEngine } = await import("@infrabyx/tenancy");
    const engine = new ApprovalsEngine({ kernel: db.kernel, audit: db.audit, product: "LD" });
    svc.registerApprovals(engine);
    await svc.suppress(admin, {
      channel: "email",
      address: "user.u@example.test",
      reason: "manual",
      scope: "tenant",
      classScope: "all",
      source: "admin",
    });
    const [row] = (
      await db.admin.query<{ id: string }>(
        "select id from notify.suppression where tenant_id = 'tnt_a' and reason = 'manual'",
      )
    ).rows;
    const { approvalId } = await svc.requestLift(admin, engine, row?.id as string);
    const blocked = await svc.send(admin, req("security.mfa_changed", ["usr_u"], "lift-0001"));
    expect((await states(blocked.notificationId))["usr_u:email"]).toBe("suppressed");
    await engine.decide(
      withTenant("tnt_a", ["ORG_CHECKER"], { principal: { id: "usr_checker2" } }),
      approvalId,
      "approve",
    );
    const after = await svc.send(admin, req("security.mfa_changed", ["usr_u"], "lift-0002"));
    expect((await states(after.notificationId))["usr_u:email"]).toBe("sent");
  });
  it("only address facts are platform-wide", async () => {
    await expect(
      svc.suppress(admin, {
        channel: "email",
        address: "x@example.test",
        reason: "manual",
        scope: "platform",
        classScope: "all",
        source: "test",
      }),
    ).rejects.toMatchObject({ code: "IPB-UX-011" });
  });
});

describe("@PL3-NTF-CONSENT marketing consent (Ecosystem §6.39)", () => {
  beforeAll(() => void (now = new Date("2026-10-26T06:00:00Z")));
  it("default deny; a grant sends; one-click unsubscribe withdraws before the next send", async () => {
    const a = await svc.send(admin, req("mkt.offers", ["usr_m"], "offers-0001"));
    expect(await states(a.notificationId)).toEqual({ "usr_m:email": "suppressed" });
    await svc.setMarketingConsent(admin, {
      channel: "email",
      address: "marketing.m@example.test",
      purpose: "MARKETING_EMAIL",
      state: "GRANTED",
    });
    const b = await svc.send(admin, req("mkt.offers", ["usr_m"], "offers-0002"));
    expect(await states(b.notificationId)).toEqual({ "usr_m:email": "sent" });
    const token = await svc.issueUnsubscribeToken(admin, {
      recipientRef: "usr_m",
      channel: "email",
      purpose: "MARKETING_EMAIL",
    });
    const t0 = Date.now();
    await svc.unsubscribe(token);
    const c = await svc.send(admin, req("mkt.offers", ["usr_m"], "offers-0003"));
    expect(Date.now() - t0).toBeLessThan(60_000);
    expect(await states(c.notificationId)).toEqual({ "usr_m:email": "suppressed" });
    expect(consentEvents.at(-1)).toMatchObject({
      state: "WITHDRAWN",
      channel: "EMAIL_LINK",
      purpose: "MARKETING_EMAIL",
    });
    await expect(svc.unsubscribe(token)).rejects.toThrow(/not found/);
    expect(
      JSON.stringify((await db.admin.query("select * from notify.unsubscribe_token")).rows),
    ).not.toContain(token);
  });
});

describe("@PL3-NTF-NEVER-WHATSAPP collections and legal notices never use WhatsApp", () => {
  beforeAll(() => void (now = new Date("2026-10-26T06:00:00Z")));
  it("the lint refuses a collection class without whatsapp under never_channels", () => {
    const bad = { ...product, classes: [{ ...product.classes[1], never_channels: [] }] };
    expect(lintCatalogues([{ file: "bad.yaml", doc: bad }]).map((f) => f.message)).toContainEqual(
      expect.stringMatching(/never_channels/),
    );
    expect(lintCatalogues(readCatalogueFiles([PLATFORM_CATALOGUE_PATH]))).toEqual([]);
  });
  it("org routing cannot add WhatsApp to a collection reminder", async () => {
    await db.admin.query(
      `insert into config.setting_value (id, key, tier, scope_id, tenant_id, value, updated_by)
       values ('set_01M5XQT0PRXMKBEGFFSHNHTA61', 'ntf.org.routing', 'TENANT', 'tnt_a', 'tnt_a', '{"loan.collection_reminder": ["whatsapp", "sms"]}'::jsonb, 'usr_admin')`,
    );
    const r = await svc.send(admin, req("loan.collection_reminder", ["usr_u"], "collect-0001"));
    expect(r.deliveries.map((d) => d.channel)).toEqual(["sms"]);
    expect(smsSent.at(-1)).toBe("1107161234567890123");
  });
});

describe("push through NOTIFY with sealed device tokens", () => {
  it("registers a token sealed at rest and delivers title and deep link only", async () => {
    const push = new ExpoPush({
      store: pushStore,
      dpaRef: "VAR-EXPO",
      baseUrl: expo.url,
      allowLoopbackHttp: true,
    });
    const token = "ExponentPushToken[notifytest0123456789]";
    await notifyContext.run(user("usr_u"), () => push.register(token, "android", "usr_u"));
    const raw = JSON.stringify(
      (await db.admin.query("select token_enc::text, token_digest from notify.device_token")).rows,
    );
    expect(raw).not.toContain("notifytest0123456789");
    const r = await svc.send(admin, req("security.login_alert", ["usr_u"], "login-push-0001"));
    expect((await states(r.notificationId))["usr_u:push"]).toBe("sent");
    expect(expo.sent.at(-1)).toMatchObject({ to: token, data: { deep_link: "/x/x1" } });
  });
});

describe("idempotency, errors, reports and the approval notifier", () => {
  it("the same idempotency key returns the same notification and sends nothing again", async () => {
    const a = await svc.send(admin, req("approval.requested", ["usr_c"], "approval-0001"));
    expect(a.deliveries).toHaveLength(2);
    const n = await db.admin.query(
      "select 1 from notify.notification where idempotency_key = 'approval-0001'",
    );
    expect(n.rowCount).toBe(1);
  });
  it("an unknown class is IPB-NTF-002", async () => {
    await expect(
      svc.send(admin, req("no.such_class", ["usr_u"], "nope-0001")),
    ).rejects.toMatchObject({ code: "IPB-NTF-002" });
  });
  it("delivery reports move a delivery to delivered", async () => {
    const r = await svc.send(admin, req("security.mfa_changed", ["usr_c"], "mfa-0002"));
    const d = (await svc.deliveryStatus(admin, r.notificationId)).find(
      (x) => x.channel === "email",
    );
    const vendor = (
      await db.admin.query<{ vendor_ref: string }>(
        "select vendor_ref from notify.delivery where id = $1",
        [d?.deliveryId],
      )
    ).rows[0]?.vendor_ref as string;
    await svc.handleEmailEvents(admin, "fake-email", [
      { vendorEventId: "e2", messageId: vendor, type: "delivered", at: new Date().toISOString() },
    ]);
    expect(
      (await svc.deliveryStatus(admin, r.notificationId)).find((x) => x.channel === "email")?.state,
    ).toBe("delivered");
  });
  it("the approval notifier records reminders in the caller's transaction for the dispatcher", async () => {
    const notifier = notifyApprovalNotifier(svc, async () => ["usr_c", "usr_maker"]);
    await db.kernel.mutate(admin, (tx) =>
      notifier.reminder(
        tx,
        { id: "apr_01M5XQT0PRXMKBEGFFSHNHTA61", action: "loans.sanction", makerId: "usr_maker" },
        ["ORG_CHECKER"],
      ),
    );
    const n = await db.admin.query<{ id: string }>(
      "select id from notify.notification where idempotency_key = 'approval.reminder:apr_01M5XQT0PRXMKBEGFFSHNHTA61'",
    );
    const ds = await svc.deliveryStatus(admin, n.rows[0]?.id as string);
    expect(ds.map((d) => `${d.recipient}:${d.state}`).sort()).toEqual([
      "usr_c:queued",
      "usr_c:queued",
    ]);
    await svc.dispatchDue();
    expect(
      (await svc.deliveryStatus(admin, n.rows[0]?.id as string)).map((d) => d.state).sort(),
    ).toEqual(["delivered", "sent"]);
  });
  it("verifySenderDomain reads SPF, DKIM and DMARC from the EMAIL adapter", async () => {
    expect(await svc.verifySenderDomain("ld", "example.test")).toEqual({
      domain: "example.test",
      spf: true,
      dkim: true,
      dmarc: false,
    });
  });
  it("@NN-45 every write is ledgered and no address reaches the ledger", async () => {
    const ledger = JSON.stringify((await db.admin.query("select * from audit.ledger")).rows);
    for (const a of [
      "notify.notification.create",
      "notify.delivery.sent",
      "notify.delivery.held",
      "notify.suppression.add",
      "notify.consent.set",
      "notify.unsubscribe.use",
    ])
      expect(ledger, a).toContain(a);
    expect(ledger).not.toMatch(/@example\.test/);
    expect(ledger).not.toContain("+9198");
  });
});

describe("@IPB-02-23 one-time sign-in codes through NOTIFY (R1-D-19)", () => {
  const ctx = withTenant("tnt_a", ["SVC_IDENTITY"], { principal: { id: "svc_identity" } });
  const sender = () =>
    notifyOtpSender({ notify: svc, classes: { sms: "security.sign_in_code" }, context: () => ctx });
  const msg = (key: string, over: Record<string, unknown> = {}) => ({
    tenantId: "tnt_a",
    userId: "kc-user-1",
    channel: "sms" as const,
    to: "+919800000077",
    code: "493817",
    expiresAt: new Date(now.getTime() + 300_000),
    idempotencyKey: key,
    ...over,
  });

  it("sends the code at once, records the delivery, and stores neither the code nor the address", async () => {
    await sender().send(msg("otp-key-0001"));
    expect(smsVars.at(-1)).toEqual(["493817", "5"]);
    const rows = await db.admin.query<{ vars: unknown; recipient_ref: string; state: string }>(
      `select n.vars, d.recipient_ref, d.state from notify.notification n
         join notify.delivery d on d.notification_id = n.id where n.idempotency_key = 'otp-key-0001'`,
    );
    expect(rows.rows).toEqual([
      {
        vars: { code: "[redacted]", expires_minutes: 5 },
        recipient_ref: "cus:kc-user-1",
        state: "sent",
      },
    ]);
    const dump = JSON.stringify(
      (
        await db.admin.query(
          "select * from notify.notification n join notify.delivery d on d.notification_id = n.id",
        )
      ).rows,
    );
    expect(dump).not.toContain("493817");
    expect(dump).not.toContain("+919800000077");
    const ledger = JSON.stringify((await db.admin.query("select * from audit.ledger")).rows);
    expect(ledger).not.toContain("493817");
    // The same key is the same message: nothing is sent again.
    const before = smsVars.length;
    await sender().send(msg("otp-key-0001"));
    expect(smsVars.length).toBe(before);
  });

  it("refuses a channel without a class, a non-security class and a killed channel", async () => {
    await expect(sender().send(msg("otp-key-0002", { channel: "email" }))).rejects.toMatchObject({
      code: "IPB-NTF-003",
    });
    await expect(
      svc.sendOneTimeCode(ctx, {
        class: "loan.collection_reminder",
        recipientRef: "cus:x",
        channel: "sms",
        address: "+919800000077",
        code: "111111",
        expiresAt: now,
        idempotencyKey: "otp-key-0003",
      }),
    ).rejects.toMatchObject({ code: "IPB-NTF-003" });
    killed.add("kill.msg.sms");
    try {
      await expect(sender().send(msg("otp-key-0004"))).rejects.toMatchObject({
        code: "IPB-NTF-004",
      });
    } finally {
      killed.delete("kill.msg.sms");
    }
  });
});
