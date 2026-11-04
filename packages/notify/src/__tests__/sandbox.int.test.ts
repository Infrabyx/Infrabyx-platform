// NOTIFY in a sandbox tenant (LawDocsComply PR-LDC-29; R1-plan M60; R1-D-87): every delivery that
// would leave the platform is recorded and ledgered as `sandboxed` and never handed to an adapter,
// for immediate sends, `dispatchDue`, digests and one-time codes alike, whatever the caller's
// context says; a tenant whose flag cannot be read sends nothing; a normal tenant is unchanged.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { KernelContext } from "@infrabyx/contracts/kernel";
import type { EmailMessage, EmailPort, SmsPort } from "@infrabyx/contracts/ports";
import { PgSettingsStore, SettingsService } from "@infrabyx/config/settings";
import { SecretKey } from "@infrabyx/crypto";
import { PgOutbox } from "@infrabyx/tenancy";
import { startPostgres, withTenant, type TestDatabase } from "@infrabyx/testing";
import { Catalogue, PLATFORM_CATALOGUE_PATH, readCatalogueFiles } from "../catalogue.js";
import { notifyOtpSender } from "../otp-sender.js";
import { NotifyService, type NotifyServiceOptions } from "../service.js";

let db: TestDatabase;
let now = new Date("2026-10-26T16:45:00Z"); // 22:15 IST
const emails: string[] = [];
const texts: string[] = [];

const email: EmailPort = {
  descriptor: { port: "EMAIL", adapter: "fake-email", residency: "IN", maxDataClass: "INTERNAL" },
  health: async () => ({ status: "up", latency_ms: 0, checked_at: new Date().toISOString() }),
  async send(m: EmailMessage) {
    emails.push(m.to[0] as string);
    return { messageId: `msg-${emails.length}` };
  },
  sendRaw: async () => ({ messageId: "raw" }),
  getStatus: async () => ({ status: "sent" }),
  verifyWebhook: async () => [],
  verifyDomain: async () => ({ verified: true, dnsRecords: [] }),
  suppress: async () => undefined,
};
const sms = {
  descriptor: { port: "SMS", adapter: "fake-sms", residency: "IN", maxDataClass: "INTERNAL" },
  health: email.health,
  send: async (m: { to: string }) => {
    texts.push(m.to);
    return { messageId: `sms-${texts.length}` };
  },
  getStatus: async () => ({ status: "sent" }),
  registerTemplate: async () => undefined,
  verifyWebhook: async () => [],
} as unknown as SmsPort;

const product = {
  catalogue: "test",
  version: 1,
  classes: [
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

const SANDBOX = "tnt_sbx";
const LIVE = "tnt_live";
const admin = (tenantId: string, extra: Partial<KernelContext> = {}): KernelContext => ({
  ...withTenant(tenantId, ["ORG_ADMIN"], { principal: { id: "usr_admin" } }),
  ...extra,
});
const req = (cls: string, to: string, key: string) => ({
  class: cls,
  to: [{ ref: to }],
  vars: { id: "x1" },
  deepLink: "/x/x1",
  idempotencyKey: key,
});

let base: NotifyServiceOptions;
let svc: NotifyService;
const states = async (tenantId: string, id: string) =>
  Object.fromEntries(
    (await svc.deliveryStatus(admin(tenantId), id)).map((d) => [d.channel, d.state]),
  );

beforeAll(async () => {
  db = await startPostgres();
  await db.admin.query(
    `insert into tenancy.tenant (id, product, name, sandbox) values
       ('tnt_sbx', 'LDC', 'Sandbox Co', true), ('tnt_live', 'LDC', 'Live Co', false),
       ('tnt_platform', 'LDC', 'P', false)
     on conflict (id) do update set sandbox = excluded.sandbox`,
  );
  const outbox = new PgOutbox();
  base = {
    kernel: db.kernel,
    audit: db.audit,
    product: "LDC",
    outbox,
    catalogue: new Catalogue([
      ...readCatalogueFiles([PLATFORM_CATALOGUE_PATH]),
      { file: "test.yaml", doc: product },
    ]),
    contacts: {
      async resolve(r, ch) {
        return { address: ch === "email" ? `${r.ref}@example.test` : "+919800000001" };
      },
    },
    channels: {
      email: { port: email, brand: "ldc" },
      sms: { port: sms, senderId: "IBXLND", dltEntityId: "1101161234567890123" },
    },
    flags: { isOn: async () => false },
    consentKey: new SecretKey("consent:test", "hmac-sha-256", new Uint8Array(32).fill(3)),
    settings: new SettingsService({
      store: new PgSettingsStore(),
      kernel: db.kernel,
      audit: db.audit,
      product: "LDC",
      outbox,
    }),
    now: () => now,
  };
  svc = new NotifyService(base);
});
afterAll(async () => {
  await db?.end();
});

describe("R1-D-87 NOTIFY in a sandbox tenant (PR-LDC-29)", () => {
  it("records an immediate send as sandboxed and never calls the adapter; in-app is written", async () => {
    const before = emails.length;
    // The caller's context claims a live tenant; the kernel's flag wins.
    const r = await svc.send(
      admin(SANDBOX, { sandbox: false }),
      req("approval.requested", "usr_c", "sbx-approval-1"),
    );
    expect(await states(SANDBOX, r.notificationId)).toEqual({
      inapp: "delivered",
      email: "sandboxed",
    });
    expect(emails.length).toBe(before);
    const led = await db.admin.query(
      "select 1 from audit.ledger where action = 'notify.delivery.sandboxed' and tenant_id = $1",
      [SANDBOX],
    );
    expect(led.rowCount).toBe(1);
  });

  it("a normal tenant is unchanged, even when the caller claims a sandbox", async () => {
    const before = emails.length;
    const r = await svc.send(
      admin(LIVE, { sandbox: true }),
      req("approval.requested", "usr_c", "live-approval-1"),
    );
    expect(await states(LIVE, r.notificationId)).toEqual({ inapp: "delivered", email: "sent" });
    expect(emails.length).toBe(before + 1);
  });

  it("dispatchDue and digests send nothing for a sandbox tenant", async () => {
    const deferred = new NotifyService({ ...base, deferDelivery: true });
    const a = await deferred.send(admin(SANDBOX), req("approval.requested", "usr_d", "sbx-def-1"));
    const m = await deferred.send(admin(SANDBOX), req("inbox.mention", "usr_d", "sbx-mention-1"));
    const l = await deferred.send(admin(LIVE), req("inbox.mention", "usr_d", "live-mention-1"));
    const before = emails.length;
    now = new Date("2026-10-27T03:01:00Z");
    await deferred.dispatchDue();
    now = new Date("2026-10-26T16:45:00Z");
    expect(await states(SANDBOX, a.notificationId)).toEqual({
      inapp: "delivered",
      email: "sandboxed",
    });
    expect(await states(SANDBOX, m.notificationId)).toEqual({ inapp: "sent", email: "sandboxed" });
    expect(await states(LIVE, l.notificationId)).toEqual({ inapp: "sent", email: "sent" });
    // Only the live tenant's digest went out by email.
    expect(emails.length).toBe(before + 1);
    const digests = await db.admin.query<{ tenant_id: string; channel: string; state: string }>(
      `select d.tenant_id, d.channel, d.state from notify.delivery d
         join notify.notification n on n.id = d.notification_id
        where n.class_id = 'digest.daily' order by d.tenant_id, d.channel`,
    );
    expect(digests.rows).toEqual([
      { tenant_id: LIVE, channel: "email", state: "sent" },
      { tenant_id: LIVE, channel: "inapp", state: "delivered" },
      { tenant_id: SANDBOX, channel: "email", state: "sandboxed" },
      { tenant_id: SANDBOX, channel: "inapp", state: "delivered" },
    ]);
    // No "digest sent" event for the sandbox tenant's email digest; its in-app digest has one.
    const sentEvents = await db.admin.query<{ tenant_id: string }>(
      "select tenant_id from notify.outbox where type like '%NotificationDigestSent%' order by tenant_id",
    );
    expect(sentEvents.rows.map((x) => x.tenant_id)).toEqual([LIVE, LIVE, SANDBOX]);
  });

  it("a one-time code is recorded and not sent; the sign-in sender refuses it", async () => {
    const before = texts.length;
    const state = await svc.sendOneTimeCode(admin(SANDBOX), {
      class: "security.sign_in_code",
      recipientRef: "cus:idp_1",
      channel: "sms",
      address: "+919800000001",
      code: "123456",
      expiresAt: new Date(now.getTime() + 5 * 60_000),
      idempotencyKey: "sbx-otp-0001",
    });
    expect(state).toBe("sandboxed");
    const sender = notifyOtpSender({
      notify: svc,
      classes: { sms: "security.sign_in_code" },
      context: (tenantId) => admin(tenantId),
    });
    await expect(
      sender.send({
        tenantId: SANDBOX,
        userId: "idp_2",
        channel: "sms",
        to: "+919800000002",
        code: "654321",
        expiresAt: new Date(now.getTime() + 5 * 60_000),
        idempotencyKey: "sbx-otp-0002",
      } as never),
    ).rejects.toMatchObject({ code: "IPB-NTF-003" });
    expect(texts.length).toBe(before);
  });

  it("fails closed: a tenant whose flag cannot be read sends nothing", async () => {
    const before = emails.length;
    const r = await svc.send(
      admin("tnt_ghost", { sandbox: false }),
      req("approval.requested", "usr_c", "ghost-approval-1"),
    );
    expect(await states("tnt_ghost", r.notificationId)).toEqual({
      inapp: "delivered",
      email: "sandboxed",
    });
    expect(emails.length).toBe(before);
  });
});
