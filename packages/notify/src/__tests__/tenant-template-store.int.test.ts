// Tenant template store (LawDocsComply PR-LDC-27; R1-plan M58; R1-D-90): maker-checker, RLS
// isolation, delivery and `dispatchDue` use the active version, fallback to the catalogue, and
// preview renders what delivery sends. PostgreSQL with every platform migration, RLS on.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { KernelContext } from "@infrabyx/contracts/kernel";
import type { EmailMessage, EmailPort, SmsPort, WhatsappPort } from "@infrabyx/contracts/ports";
import { SecretKey } from "@infrabyx/crypto";
import { ApprovalsEngine } from "@infrabyx/tenancy";
import { startPostgres, withTenant, type TestDatabase } from "@infrabyx/testing";
import { Catalogue, PLATFORM_CATALOGUE_PATH, readCatalogueFiles } from "../catalogue.js";
import { NotifyService, type NotifyServiceOptions } from "../service.js";
import {
  TEMPLATE_CHANGE_ACTION,
  TenantTemplateStore,
  type RegisteredSmsTemplate,
  type TemplateRegistry,
} from "../template-store.js";

let db: TestDatabase;
let svc: NotifyService;
let store: TenantTemplateStore;
let engine: ApprovalsEngine;
const emailSent: EmailMessage[] = [];
const smsSent: Array<{
  templateId: string;
  senderId: string;
  dltEntityId: string;
  vars: string[];
}> = [];
const registeredSms: RegisteredSmsTemplate[] = [
  {
    dltTemplateId: "1107160000000000077",
    senderId: "LAWDOC",
    dltEntityId: "1101160000000000077",
    vars: ["date", "name"],
  },
];

const emailPort = (content: boolean): EmailPort =>
  ({
    descriptor: {
      port: "EMAIL",
      adapter: content ? "fake-email" : "old-email",
      residency: "IN",
      maxDataClass: "INTERNAL",
      ...(content ? { capabilities: { content: "native" } } : {}),
    },
    health: async () => ({ status: "up", latency_ms: 0, checked_at: new Date().toISOString() }),
    send: async (m: EmailMessage) => {
      emailSent.push(m);
      return { messageId: `em-${emailSent.length}` };
    },
  }) as unknown as EmailPort;
const sms = {
  descriptor: { port: "SMS", adapter: "fake-sms", residency: "IN", maxDataClass: "INTERNAL" },
  health: async () => ({ status: "up", latency_ms: 0, checked_at: new Date().toISOString() }),
  send: async (m: (typeof smsSent)[number]) => {
    smsSent.push(m);
    return { messageId: `sms-${smsSent.length}` };
  },
} as unknown as SmsPort;
const whatsapp = {
  descriptor: { port: "WHATSAPP", adapter: "fake-wa", residency: "IN", maxDataClass: "INTERNAL" },
  health: sms.health,
  sendTemplate: async () => ({ messageId: "wa-1" }),
} as unknown as WhatsappPort;

const registry: TemplateRegistry = {
  sms: async (_ctx, id) => registeredSms.find((t) => t.dltTemplateId === id),
  whatsapp: async () => undefined,
};

const CLASS = "case.hearing_reminder";
const product = {
  catalogue: "test",
  version: 1,
  classes: [
    {
      id: CLASS,
      category: "transactional",
      urgent: true,
      bypass_quiet_hours: true,
      resend: "safe",
      default_channels: ["email", "sms"],
      help_key: "hlp.case.hearing_reminder",
      deep_link: "/cases/{id}",
      variables: ["name", "date", "court"],
      templates: {
        email: { key: "case.hearing_reminder", locales: ["en", "hi"] },
        sms: { dlt_template_id: "1107160000000000001", header: "IBXPLT", vars: ["name", "date"] },
      },
    },
  ],
};
const catalogue = new Catalogue([
  ...readCatalogueFiles([PLATFORM_CATALOGUE_PATH]),
  { file: "test.yaml", doc: product },
]);

const maker = (t: string): KernelContext =>
  withTenant(t, ["ORG_MAKER"], { principal: { id: `usr_maker_${t}` } });
const checker = (t: string): KernelContext =>
  withTenant(t, ["ORG_CHECKER"], { principal: { id: `usr_checker_${t}` } });
const vars = { name: 'Asha <b>&</b> "K"', date: "3 Dec", court: "Bench 4", id: "c1" };
const email = {
  subject: "Hearing on {{date}}",
  text: "Dear {{name}}, your hearing at {{court}} is on {{date}}.",
  html: '<p>Dear {{name}},</p><p>Your hearing at <b>{{court}}</b> is on {{date}}. <a href="https://app.example.test/cases">Open</a></p>',
};
let n = 0;
const send = (s: NotifyService, t: string, locale?: string) =>
  s.send(withTenant(t, ["ORG_MEMBER"], { principal: { id: "usr_sender" } }), {
    class: CLASS,
    to: [{ ref: "usr_client" }],
    vars,
    deepLink: "/cases/c1",
    ...(locale ? { locale } : {}),
    idempotencyKey: `ldc27-${t}-${++n}`,
  });
const states = async (s: NotifyService, t: string, id: string) =>
  Object.fromEntries(
    (await s.deliveryStatus(withTenant(t, ["ORG_ADMIN"]), id)).map((d) => [
      d.channel,
      `${d.state}${d.lastErrorCode ? `:${d.lastErrorCode}` : ""}`,
    ]),
  );

const options = (o: Partial<NotifyServiceOptions> = {}): NotifyServiceOptions => ({
  kernel: db.kernel,
  audit: db.audit,
  product: "LDC",
  catalogue,
  contacts: {
    resolve: async (_r, ch) => ({
      address: ch === "email" ? "client@example.test" : "+919800000077",
    }),
  },
  channels: {
    email: { port: emailPort(true), brand: "ldc" },
    sms: { port: sms, senderId: "IBXPLT", dltEntityId: "1101160000000000000" },
    whatsapp: { port: whatsapp },
  },
  flags: { isOn: async () => false },
  consentKey: new SecretKey("consent:test", "hmac-sha-256", new Uint8Array(32).fill(7)),
  templates: store.resolver.resolve,
  now: () => new Date("2026-11-03T06:30:00Z"),
  ...o,
});

const approve = async (t: string, approvalId: string) =>
  engine.decide(checker(t), approvalId, "approve");

beforeAll(async () => {
  db = await startPostgres();
  await db.admin.query(
    "insert into tenancy.tenant (id, product, name) values ('tnt_a', 'LDC', 'A'), ('tnt_b', 'LDC', 'B') on conflict do nothing",
  );
  store = new TenantTemplateStore({ kernel: db.kernel, audit: db.audit, catalogue, registry });
  engine = new ApprovalsEngine({ kernel: db.kernel, audit: db.audit, product: "LDC" });
  store.registerApprovals(engine);
  svc = new NotifyService(options());
});
afterAll(async () => db?.end());

describe("@R1-M58 tenant templates under maker-checker (PR-LDC-27)", () => {
  let approvalId = "";
  it("a proposed email template changes nothing until a tenant checker approves it", async () => {
    const r = await store.requestChange(maker("tnt_a"), engine, {
      class: CLASS,
      channel: "email",
      locale: "en",
      ...email,
    });
    approvalId = r.approvalId;
    expect(r.version).toBe(1);
    const [h] = await store.history(maker("tnt_a"), CLASS, "email", "en");
    expect(h).toMatchObject({ state: "proposed", version: 1, approvalId: r.approvalId });
    const before = emailSent.length;
    await send(svc, "tnt_a");
    expect(emailSent.slice(before)).toHaveLength(1);
    expect(emailSent.at(-1)).not.toHaveProperty("content");
    expect(emailSent.at(-1)?.template).toBe("case.hearing_reminder");
    const req = (
      await db.admin.query<{ risk_class: string; action: string }>(
        "select risk_class, action from tenancy.approval_request where id = $1",
        [r.approvalId],
      )
    ).rows[0];
    expect(req).toEqual({ risk_class: "R3", action: TEMPLATE_CHANGE_ACTION });
  });
  it("the maker cannot approve their own change, and no platform checker can", async () => {
    await expect(engine.decide(maker("tnt_a"), approvalId, "approve")).rejects.toMatchObject({
      code: "IPB-SEC-007",
    });
    await expect(
      engine.decide(
        {
          tenantId: "tnt_a",
          scope: "platform",
          principal: { id: "usr_staff", type: "user", roles: ["PLT_SUPER_ADMIN"] },
        },
        approvalId,
        "approve",
      ),
    ).rejects.toThrow();
  });
  it("approval activates and ledgers the version; delivery then sends the rendered tenant content", async () => {
    await approve("tnt_a", approvalId);
    const [h] = await store.history(maker("tnt_a"), CLASS, "email", "en");
    expect(h).toMatchObject({ state: "active", activatedBy: "usr_checker_tnt_a" });
    const led = await db.admin.query<{ action: string }>(
      "select action from audit.ledger where tenant_id = 'tnt_a' and resource_id = $1 order by seq",
      [h?.id],
    );
    expect(led.rows.map((x) => x.action)).toEqual([
      "notify.template.propose",
      "notify.template.activate",
    ]);
    const r = await send(svc, "tnt_a");
    expect(await states(svc, "tnt_a", r.notificationId)).toMatchObject({ email: "sent" });
    const m = emailSent.at(-1) as EmailMessage;
    expect(m.content).toEqual({
      subject: "Hearing on 3 Dec",
      text: 'Dear Asha <b>&</b> "K", your hearing at Bench 4 is on 3 Dec.',
      html: '<p>Dear Asha &lt;b&gt;&amp;&lt;/b&gt; &quot;K&quot;,</p><p>Your hearing at <b>Bench 4</b> is on 3 Dec. <a href="https://app.example.test/cases">Open</a></p>',
    });
    expect(m.template).toBe("case.hearing_reminder");
  });
  it("preview renders exactly what delivery sent", async () => {
    const p = await svc.previewTemplate(maker("tnt_a"), CLASS, "email", null, vars);
    const { to: _to, ...sent } = emailSent.at(-1) as EmailMessage;
    expect(p).toEqual({ channel: "email", source: "tenant", message: sent });
    // A locale with no version of its own falls to its language, then the class's first locale.
    const hi = await svc.previewTemplate(maker("tnt_a"), CLASS, "email", "hi-IN", vars);
    expect(hi.source).toBe("tenant");
  });
  it("a proposed version previews before approval", async () => {
    const r = await store.requestChange(maker("tnt_a"), engine, {
      class: CLASS,
      channel: "email",
      locale: "en",
      subject: "Reminder: {{date}}",
      text: "Hello {{name}}",
    });
    const p = await svc.previewTemplate(checker("tnt_a"), CLASS, "email", "en", vars, {
      template: await store.resolvedOf(checker("tnt_a"), r.templateId),
    });
    expect(p.channel === "email" && p.message.content).toEqual({
      subject: "Reminder: 3 Dec",
      text: 'Hello Asha <b>&</b> "K"',
    });
    // Still the active version for delivery.
    expect(
      (await svc.previewTemplate(maker("tnt_a"), CLASS, "email", "en", vars)).message,
    ).toMatchObject({
      content: { subject: "Hearing on 3 Dec" },
    });
    // A version approved after another was activated on top of its base is refused.
    const second = await store.requestChange(maker("tnt_a"), engine, {
      class: CLASS,
      channel: "email",
      locale: "en",
      subject: "Second {{date}}",
      text: "Second",
    });
    await approve("tnt_a", second.approvalId);
    await expect(approve("tnt_a", r.approvalId)).rejects.toThrow(/another version/);
    const active = (await store.history(maker("tnt_a"), CLASS, "email", "en")).filter(
      (x) => x.state === "active",
    );
    expect(active.map((x) => x.version)).toEqual([second.version]);
  });
  it("tampering with a proposed row after the request is refused at approval", async () => {
    const r = await store.requestChange(maker("tnt_a"), engine, {
      class: CLASS,
      channel: "email",
      locale: "hi",
      subject: "Sunvai {{date}}",
      text: "Namaste {{name}}",
    });
    await db.admin.query(
      "update notify.tenant_template set body_text = 'Pay at https://evil.example.test' where id = $1",
      [r.templateId],
    );
    await expect(approve("tnt_a", r.approvalId)).rejects.toThrow(/changed after it was raised/);
  });
});

describe("@R1-M58 isolation and fallback (RLS on)", () => {
  it("another tenant neither sees nor uses tenant A's templates; it gets the catalogue's", async () => {
    const [a] = await store.history(maker("tnt_a"), CLASS, "email", "en");
    await expect(store.get(maker("tnt_b"), a?.id as string)).rejects.toThrow(/not found/);
    // No tenant filter: RLS alone hides tenant A's rows.
    const seen = await db.kernel.read(maker("tnt_b"), (tx) =>
      tx.query<{ n: string }>("select count(*)::text as n from notify.tenant_template"),
    );
    expect(seen.rows[0]?.n).toBe("0");
    const upd = await db.kernel.mutate(maker("tnt_b"), async (tx) => {
      const u = await tx.query(
        "update notify.tenant_template set state = 'superseded', superseded_at = now() where id = $1",
        [a?.id],
      );
      await db.audit.record(tx, {
        action: "test.template.update",
        resourceType: "notification_template",
        resourceId: String(a?.id),
      });
      return u.rowCount;
    });
    expect(upd).toBe(0);
    await expect(
      db.kernel.mutate(maker("tnt_b"), (tx) =>
        tx.query(
          `insert into notify.tenant_template (id, tenant_id, class_id, channel, locale, version, state, kind,
             subject, body_text, content_digest, proposed_by, activated_by, activated_at)
           values ('ntt_01JX0000000000000000000000', 'tnt_a', $1, 'email', 'en', 99, 'active', 'override',
             'x', 'y', repeat('0', 64), 'usr_x', 'usr_x', now())`,
          [CLASS],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    const p = await svc.previewTemplate(maker("tnt_b"), CLASS, "email", "en", vars);
    expect(p).toMatchObject({
      source: "catalogue",
      message: { template: "case.hearing_reminder" },
    });
    expect(p.message).not.toHaveProperty("content");
  });
  it("a revert returns the tenant to the catalogue template", async () => {
    const r = await store.requestChange(maker("tnt_a"), engine, {
      class: CLASS,
      channel: "email",
      locale: "en",
      revert: true,
    });
    await approve("tnt_a", r.approvalId);
    const before = emailSent.length;
    await send(svc, "tnt_a");
    expect(emailSent.slice(before)[0]).not.toHaveProperty("content");
  });
});

describe("@R1-M58 SMS selects a registered DLT template; dispatchDue uses it", () => {
  it("the registered template, sender and entity go out, also from the dispatcher", async () => {
    const r = await store.requestChange(maker("tnt_a"), engine, {
      class: CLASS,
      channel: "sms",
      locale: "en",
      dltTemplateId: "1107160000000000077",
    });
    await approve("tnt_a", r.approvalId);
    const deferred = new NotifyService(options({ deferDelivery: true }));
    const sent = await send(deferred, "tnt_a");
    expect(await states(deferred, "tnt_a", sent.notificationId)).toMatchObject({ sms: "queued" });
    await deferred.dispatchDue();
    expect(smsSent.at(-1)).toMatchObject({
      templateId: "1107160000000000077",
      senderId: "LAWDOC",
      dltEntityId: "1101160000000000077",
      vars: ["3 Dec", 'Asha <b>&</b> "K"'],
    });
    const p = await svc.previewTemplate(maker("tnt_a"), CLASS, "sms", null, vars);
    const { to: _to, ...last } = smsSent.at(-1) as (typeof smsSent)[number] & { to: string };
    expect(p).toEqual({ channel: "sms", source: "tenant", message: last });
    // Tenant B keeps the catalogue's DLT template.
    await send(svc, "tnt_b");
    expect(smsSent.at(-1)).toMatchObject({ templateId: "1107160000000000001", senderId: "IBXPLT" });
  });
  it("a selection that is no longer registered fails the delivery closed", async () => {
    const kept = registeredSms.splice(0, 1);
    try {
      const r = await send(svc, "tnt_a");
      expect((await states(svc, "tnt_a", r.notificationId)).sms).toBe("failed:IPB-PORT-001");
    } finally {
      registeredSms.push(...kept);
    }
  });
});

describe("@R1-M58 an EMAIL adapter that cannot send content", () => {
  it("fails closed instead of sending the vendor template", async () => {
    const r0 = await store.requestChange(maker("tnt_a"), engine, {
      class: CLASS,
      channel: "email",
      locale: "en",
      ...email,
    });
    await approve("tnt_a", r0.approvalId);
    const old = new NotifyService(
      options({
        channels: {
          email: { port: emailPort(false), brand: "ldc" },
          sms: { port: sms, senderId: "IBXPLT", dltEntityId: "1101160000000000000" },
        },
      }),
    );
    const before = emailSent.length;
    const r = await send(old, "tnt_a");
    expect((await states(old, "tnt_a", r.notificationId)).email).toBe("failed:IPB-PORT-001");
    expect(emailSent.length).toBe(before);
  });
});
