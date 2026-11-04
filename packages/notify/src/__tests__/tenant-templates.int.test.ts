// Per-tenant templates (Finbyx PR-FBX-33) and delivery reports routed by vendor reference
// (LawDocsComply PR-LDC-15): R1-plan M39; R1-D-69. PostgreSQL 18 with every platform migration.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { KernelContext } from "@infrabyx/contracts/kernel";
import type {
  ResolvedTemplate,
  SmsPort,
  TemplateResolver,
  WhatsappPort,
} from "@infrabyx/contracts/ports";
import { SecretKey } from "@infrabyx/crypto";
import { startPostgres, withTenant, type TestDatabase } from "@infrabyx/testing";
import { Catalogue, PLATFORM_CATALOGUE_PATH, readCatalogueFiles } from "../catalogue.js";
import { NotifyService } from "../service.js";

let db: TestDatabase;
let svc: NotifyService;
const smsSent: Array<{
  templateId: string;
  senderId: string;
  dltEntityId: string;
  vars: string[];
}> = [];
const waSent: Array<{ templateName: string; lang: string }> = [];
const own = new Map<string, ResolvedTemplate | null>();
const resolverCalls: string[] = [];

const sms = {
  descriptor: { port: "SMS", adapter: "fake-sms", residency: "IN", maxDataClass: "INTERNAL" },
  health: async () => ({ status: "up", latency_ms: 0, checked_at: new Date().toISOString() }),
  send: async (m: {
    templateId: string;
    senderId: string;
    dltEntityId: string;
    vars: string[];
  }) => {
    smsSent.push(m);
    return { messageId: `sms-${smsSent.length}` };
  },
} as unknown as SmsPort;
const whatsapp = {
  descriptor: { port: "WHATSAPP", adapter: "fake-wa", residency: "IN", maxDataClass: "INTERNAL" },
  health: sms.health,
  sendTemplate: async (m: { templateName: string; lang: string }) => {
    waSent.push(m);
    return { messageId: `wa-${waSent.length}` };
  },
} as unknown as WhatsappPort;

const templates: TemplateResolver = async (ctx, cls, channel) => {
  resolverCalls.push(`${ctx.tenantId}:${cls.id}:${channel}`);
  const k = `${ctx.tenantId}:${channel}`;
  return own.has(k) ? own.get(k) : undefined;
};

const product = {
  catalogue: "test",
  version: 1,
  classes: [
    {
      id: "acct.statement_ready",
      category: "transactional",
      urgent: true,
      bypass_quiet_hours: true,
      resend: "safe",
      default_channels: ["sms", "whatsapp"],
      help_key: "ntf.acct.statement_ready",
      deep_link: "/statements/{id}",
      templates: {
        sms: { dlt_template_id: "1107160000000000001", header: "IBXPLT", vars: ["id", "name"] },
        whatsapp: { name: "statement_ready", category: "utility", lang: ["en"], vars: ["id"] },
      },
    },
  ],
};
const contact = { address: "+919800000001" };
const ctx = (t: string): KernelContext =>
  withTenant(t, ["ORG_MEMBER"], { principal: { id: "usr_u" } });
let n = 0;
const send = (t: string) =>
  svc.send(ctx(t), {
    class: "acct.statement_ready",
    to: [{ ref: "usr_u" }],
    vars: { id: "s1", name: "Asha" },
    deepLink: "/statements/s1",
    idempotencyKey: `tmpl-${t}-${++n}`,
  });
const states = async (t: string, id: string) =>
  Object.fromEntries(
    (await svc.deliveryStatus(withTenant(t, ["ORG_ADMIN"]), id)).map((d) => [d.channel, d.state]),
  );

beforeAll(async () => {
  db = await startPostgres();
  await db.admin.query(
    "insert into tenancy.tenant (id, product, name) values ('tnt_a', 'FBX', 'A'), ('tnt_b', 'FBX', 'B') on conflict do nothing",
  );
  svc = new NotifyService({
    kernel: db.kernel,
    audit: db.audit,
    product: "FBX",
    catalogue: new Catalogue([
      ...readCatalogueFiles([PLATFORM_CATALOGUE_PATH]),
      { file: "test.yaml", doc: product },
    ]),
    contacts: { resolve: async () => contact },
    channels: {
      sms: { port: sms, senderId: "IBXPLT", dltEntityId: "1101160000000000000" },
      whatsapp: { port: whatsapp },
    },
    flags: { isOn: async () => false },
    consentKey: new SecretKey("consent:test", "hmac-sha-256", new Uint8Array(32).fill(5)),
    templates,
    // 12:00 IST, in the past of the database clock so deliveries are due at once.
    now: () => new Date("2026-11-03T06:30:00Z"),
  });
});
afterAll(async () => db?.end());

describe("R1-D-69 per-tenant templates (PR-FBX-33)", () => {
  it("uses the tenant's own SMS and WhatsApp templates, and the catalogue when it defers", async () => {
    own.set("tnt_a:sms", {
      channel: "sms",
      dltTemplateId: "1107169999999999999",
      senderId: "TENANT",
      dltEntityId: "1101169999999999999",
      vars: ["name", "id"],
    });
    own.set("tnt_a:whatsapp", { channel: "whatsapp", name: "tenant_statement", lang: "hi" });
    await send("tnt_a");
    expect(smsSent.at(-1)).toEqual({
      to: contact.address,
      templateId: "1107169999999999999",
      senderId: "TENANT",
      dltEntityId: "1101169999999999999",
      vars: ["Asha", "s1"],
    });
    expect(waSent.at(-1)).toMatchObject({ templateName: "tenant_statement", lang: "hi" });
    await send("tnt_b");
    expect(smsSent.at(-1)).toMatchObject({
      templateId: "1107160000000000001",
      senderId: "IBXPLT",
      vars: ["s1", "Asha"],
    });
    expect(waSent.at(-1)).toMatchObject({ templateName: "statement_ready", lang: "en" });
    expect(resolverCalls).toContain("tnt_b:acct.statement_ready:sms");
  });

  it("fails closed on null: nothing is sent on that channel", async () => {
    own.set("tnt_b:whatsapp", null);
    const before = waSent.length;
    const r = await send("tnt_b");
    expect(waSent.length).toBe(before);
    expect(await states("tnt_b", r.notificationId)).toMatchObject({
      sms: "sent",
      whatsapp: "failed",
    });
    own.delete("tnt_b:whatsapp");
  });
});

describe("R1-D-69 delivery reports routed by vendor reference (PR-LDC-15)", () => {
  it("finds each report's tenant, applies it there, and drops unknown references", async () => {
    const a = await send("tnt_a");
    const b = await send("tnt_b");
    const ref = async (t: string, id: string) =>
      (
        await db.admin.query(
          "select vendor_ref from notify.delivery where tenant_id = $1 and notification_id = $2 and channel = 'sms'",
          [t, id],
        )
      ).rows[0].vendor_ref as string;
    const out = await svc.routeSmsReports("fake-sms", [
      { messageId: await ref("tnt_a", a.notificationId), status: "delivered" },
      { messageId: await ref("tnt_b", b.notificationId), status: "failed" },
      { messageId: "sms-unknown", status: "delivered" },
    ] as never);
    expect(out).toEqual({ routed: 2, unknown: 1, ambiguous: 0 });
    expect((await states("tnt_a", a.notificationId)).sms).toBe("delivered");
    expect((await states("tnt_b", b.notificationId)).sms).toBe("failed");
    // Another adapter's reference with the same value is not this adapter's delivery.
    expect(
      await svc.routeSmsReports("other-sms", [
        { messageId: await ref("tnt_a", a.notificationId), status: "failed" },
      ] as never),
    ).toEqual({ routed: 0, unknown: 1, ambiguous: 0 });
    // The dispatcher's read is ledgered in each tenant it read.
    const reads = await db.admin.query(
      "select distinct tenant_id from audit.ledger where action = 'platform.service_read' and tenant_id in ('tnt_a', 'tnt_b')",
    );
    expect(reads.rows.map((r) => r.tenant_id).sort()).toEqual(["tnt_a", "tnt_b"]);
  });

  it("drops a reference found in two tenants instead of guessing", async () => {
    const a = await send("tnt_a");
    const b = await send("tnt_b");
    await db.admin.query(
      "update notify.delivery set vendor_ref = 'sms-dup' where channel = 'sms' and notification_id in ($1, $2)",
      [a.notificationId, b.notificationId],
    );
    expect(
      await svc.routeSmsReports("fake-sms", [
        { messageId: "sms-dup", status: "delivered" },
      ] as never),
    ).toEqual({ routed: 0, unknown: 0, ambiguous: 1 });
    expect((await states("tnt_a", a.notificationId)).sms).toBe("sent");
  });
});
