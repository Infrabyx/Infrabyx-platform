// Staff and RE-administrator notifications by role on PostgreSQL 18 (Udofin PR-UDF-052; R1-D-222;
// plan docs/phases/R1-udofin-staff-notify-plan.md §E): role holders found at send time in the
// context's tenant only (forced RLS), agents, disabled people and other tenants never; functions
// by `FN:`; `no_recipients` recorded, ledgered and replayed; idempotency; the per-recipient
// receipt; preferences for optional and mandatory staff classes (IPB-07-25); staff classes only
// through the staff door; personal data refused before anything is recorded.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { KernelContext } from "@infrabyx/contracts/kernel";
import type { EmailMessage, EmailPort } from "@infrabyx/contracts/ports";
import { PgSettingsStore, SettingsService } from "@infrabyx/config/settings";
import { SecretKey, canonicalDigest } from "@infrabyx/crypto";
import { PgOutbox } from "@infrabyx/tenancy";
import { startPostgres, withTenant, type TestDatabase } from "@infrabyx/testing";
import { Catalogue, PLATFORM_CATALOGUE_PATH, readCatalogueFiles } from "../catalogue.js";
import { NotifyService } from "../service.js";

let db: TestDatabase;
let svc: NotifyService;
const emails: string[] = [];

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

const U = (s: string) => `usr_${s.padStart(26, "0")}`;
const A1 = U("A1"); // ORG_ADMIN, tenant A
const A2 = U("A2"); // ORG_ADMIN, tenant A, no email address on file
const D1 = U("D1"); // ORG_ADMIN, tenant A, disabled
const E1 = U("E1"); // ORG_ADMIN, tenant A, an agent identity
const M1 = U("M1"); // ORG_MEMBER, tenant A
const C1 = U("C1"); // FN:CCO, tenant A
const C2 = U("C2"); // FN:CCO revoked, tenant A
const B1 = U("B1"); // ORG_ADMIN, tenant B
const P1 = U("P1"); // OPS_SUPPORT, the operator's tenant

const contacts: Record<string, string> = {
  [A1]: "admin.a1@example.test",
  [D1]: "disabled.d1@example.test",
  [E1]: "agent.e1@example.test",
  [M1]: "member.m1@example.test",
  [C1]: "cco.c1@example.test",
  [C2]: "cco.c2@example.test",
  [B1]: "admin.b1@example.test",
  [P1]: "ops.p1@example.test",
};

const product = {
  catalogue: "udofin-staff",
  version: 1,
  classes: [
    {
      id: "ops.re_admin.alert",
      category: "transactional",
      audience: "staff",
      urgent: true,
      resend: "safe",
      default_channels: ["inapp", "email"],
      help_key: "hlp.notify.ops.re_admin.alert",
      deep_link: "/ops/alerts/{id}",
      variables: ["id", "count", "note"],
      subject_variables: ["id"],
      templates: {
        email: { key: "ops.re_admin.alert", locales: ["en"] },
        inapp: { title_key: "ntf.ops.re_admin.alert.title" },
      },
    },
    {
      id: "ops.re_admin.key_rotation",
      category: "security",
      audience: "staff",
      mandatory: true,
      urgent: true,
      resend: "safe",
      default_channels: ["inapp", "email"],
      help_key: "hlp.notify.ops.re_admin.key_rotation",
      deep_link: "/settings/keys",
      variables: ["id"],
      templates: {
        email: { key: "ops.re_admin.key_rotation", locales: ["en"] },
        inapp: { title_key: "ntf.ops.re_admin.key_rotation.title" },
      },
    },
  ],
};

const caller = (tenantId: string): KernelContext =>
  withTenant(tenantId, ["ORG_MEMBER"], { principal: { id: "usr_caller" } });
const alert = (key: string, over: Record<string, unknown> = {}) => ({
  class: "ops.re_admin.alert",
  roles: ["ORG_ADMIN"],
  vars: { id: "alr_01", count: 3 },
  deepLink: "/ops/alerts/alr_01",
  idempotencyKey: key,
  ...over,
});
const count = async (sql: string, params: unknown[] = []) =>
  (await db.admin.query(sql, params)).rowCount;

beforeAll(async () => {
  db = await startPostgres();
  await db.admin.query(
    "insert into tenancy.tenant (id, product, name) values ('tnt_a', 'UDF', 'RE A'), ('tnt_b', 'UDF', 'RE B'), ('tnt_ops', 'UDF', 'Operator')",
  );
  const people: Array<[string, string, string, string, string[]]> = [
    [A1, "tnt_a", "active", "user", ["ORG_ADMIN"]],
    [A2, "tnt_a", "active", "user", ["ORG_ADMIN", "ORG_CHECKER"]],
    [D1, "tnt_a", "disabled", "user", ["ORG_ADMIN"]],
    [E1, "tnt_a", "active", "agent", ["ORG_ADMIN"]],
    [M1, "tnt_a", "active", "user", ["ORG_MEMBER"]],
    [C1, "tnt_a", "active", "user", ["ORG_MEMBER"]],
    [C2, "tnt_a", "active", "user", ["ORG_MEMBER"]],
    [B1, "tnt_b", "active", "user", ["ORG_ADMIN", "OPS_SUPPORT"]],
    [P1, "tnt_ops", "active", "user", ["OPS_SUPPORT"]],
  ];
  for (const [id, tenant, status, type, roles] of people) {
    await db.admin.query(
      "insert into tenancy.user (id, idp_subject, status, type) values ($1, $1, $2, $3)",
      [id, status, type],
    );
    await db.admin.query(
      "insert into tenancy.membership (tenant_id, user_id, roles) values ($1, $2, $3)",
      [tenant, id, roles],
    );
  }
  const fna = (s: string) => `fna_0${s.padStart(25, "0")}`;
  await db.admin.query(
    `insert into tenancy.function_assignment (id, tenant_id, user_id, function, request_id, maker_id, approved_by, reason, revoked_at, revoked_by, revoke_reason)
     values ($1, 'tnt_a', $2, 'FN:CCO', 'apr_1', $4, $5, 'named by the board', null, null, null),
            ($3, 'tnt_a', $6, 'FN:CCO', 'apr_2', $4, $5, 'named by the board', now(), $4, 'stepped down')`,
    [fna("1"), C1, fna("2"), A1, A2, C2],
  );
  const outbox = new PgOutbox();
  const settings = new SettingsService({
    store: new PgSettingsStore(),
    kernel: db.kernel,
    audit: db.audit,
    product: "UDF",
    outbox,
  });
  svc = new NotifyService({
    kernel: db.kernel,
    audit: db.audit,
    product: "UDF",
    outbox,
    catalogue: new Catalogue([
      ...readCatalogueFiles([PLATFORM_CATALOGUE_PATH]),
      { file: "udofin-staff.yaml", doc: product },
    ]),
    contacts: {
      async resolve(r) {
        const address = contacts[r.ref];
        return address ? { address } : null;
      },
    },
    channels: { email: { port: email, brand: "udf" } },
    flags: { isOn: async () => false },
    consentKey: new SecretKey("consent:test", "hmac-sha-256", new Uint8Array(32).fill(3)),
    settings,
    messages: {
      "ntf.ops.re_admin.alert.title": { en: "Alert {id}" },
      "ntf.ops.re_admin.key_rotation.title": { en: "Rotate your keys" },
    },
    now: () => new Date("2026-10-27T06:00:00Z"), // 11:30 IST
  });
});
afterAll(async () => {
  await db?.end();
});

describe("role resolution in the context's tenant (PR-UDF-052; IPB-02 §02.4)", () => {
  it("reaches every active person holding the role, by in-app and email, and no one else", async () => {
    const before = emails.length;
    const r = await svc.notifyStaff(caller("tnt_a"), alert("staff-alert-0001"));
    expect(r.outcome).toBe("targeted");
    expect(r.recipients).toEqual([A1, A2]);
    const states = Object.fromEntries(
      r.deliveries.map((d) => [`${d.recipient}:${d.channel}`, d.state]),
    );
    expect(states).toEqual({
      [`${A1}:inapp`]: "delivered",
      [`${A1}:email`]: "sent",
      [`${A2}:inapp`]: "delivered",
      [`${A2}:email`]: "failed",
    });
    expect(emails.slice(before)).toEqual(["admin.a1@example.test"]);
    expect((await svc.inapp(caller("tnt_a"), A1))[0]).toMatchObject({
      title: "Alert alr_01",
      deepLink: "/ops/alerts/alr_01",
    });
    for (const never of [D1, E1, M1, B1])
      expect(await count("select 1 from notify.delivery where recipient_ref = $1", [never])).toBe(
        0,
      );
  });
  it("drops the excluded actor and finds a function's current holder only", async () => {
    const r = await svc.notifyStaff(
      caller("tnt_a"),
      alert("staff-alert-0002", { exclude: [{ ref: A2 }] }),
    );
    expect(r.recipients).toEqual([A1]);
    const f = await svc.notifyStaff(
      caller("tnt_a"),
      alert("staff-alert-0003", { roles: ["FN:CCO"] }),
    );
    expect(f.recipients).toEqual([C1]);
  });
  it("never reaches a holder of the same role in another tenant (cross-tenant isolation)", async () => {
    expect(await svc.inapp(caller("tnt_b"), B1)).toEqual([]);
    const b = await svc.notifyStaff(caller("tnt_b"), alert("staff-alert-0004"));
    expect(b.recipients).toEqual([B1]);
    expect(await svc.inapp(caller("tnt_a"), B1)).toEqual([]);
    // The operator's team: OPS_SUPPORT holders in the operator's own tenant only (#160).
    const ops = await svc.notifyStaff(
      caller("tnt_ops"),
      alert("staff-alert-0005", { roles: ["OPS_SUPPORT"] }),
    );
    expect(ops.recipients).toEqual([P1]);
    expect(
      await count(
        "select 1 from notify.delivery where tenant_id = 'tnt_ops' and recipient_ref <> $1",
        [P1],
      ),
    ).toBe(0);
  });
});

describe("outcomes, idempotency and the receipt (PR-UDF-052)", () => {
  it("records nobody holding the roles as no_recipients, ledgered, and replays it", async () => {
    const r = await svc.notifyStaff(
      caller("tnt_a"),
      alert("staff-alert-0006", { roles: ["ORG_AUDITOR_RO"] }),
    );
    expect(r).toMatchObject({ outcome: "no_recipients", deliveries: [], recipients: [] });
    const led = await db.admin.query<{ after_digest: string }>(
      "select after_digest from audit.ledger where action = 'notify.notification.create' and resource_id = $1",
      [r.notificationId],
    );
    expect(led.rows[0]?.after_digest).toBe(
      canonicalDigest({
        class: "ops.re_admin.alert",
        recipients: 0,
        deliveries: {},
        outcome: "no_recipients",
        audience: "staff",
        roles: ["ORG_AUDITOR_RO"],
        targeted: [],
      }),
    );
    const again = await svc.notifyStaff(
      caller("tnt_a"),
      alert("staff-alert-0006", { roles: ["ORG_AUDITOR_RO"] }),
    );
    expect(again).toMatchObject({ notificationId: r.notificationId, outcome: "no_recipients" });
    expect(await svc.deliveryReceipt(caller("tnt_a"), r.notificationId)).toMatchObject({
      outcome: "no_recipients",
      recipients: [],
    });
  });
  it("ledgers the roles and the people targeted with the notification", async () => {
    const r = await svc.notifyStaff(caller("tnt_a"), alert("staff-alert-0007"));
    const led = await db.admin.query<{ after_digest: string }>(
      "select after_digest from audit.ledger where action = 'notify.notification.create' and resource_id = $1",
      [r.notificationId],
    );
    expect(led.rows[0]?.after_digest).toBe(
      canonicalDigest({
        class: "ops.re_admin.alert",
        recipients: 2,
        deliveries: { queued: 4 },
        outcome: "targeted",
        audience: "staff",
        roles: ["ORG_ADMIN"],
        targeted: [A1, A2],
      }),
    );
  });
  it("sends once per idempotency key", async () => {
    const first = await svc.notifyStaff(caller("tnt_a"), alert("staff-alert-0008"));
    const sent = emails.length;
    const again = await svc.notifyStaff(caller("tnt_a"), alert("staff-alert-0008"));
    expect(again.notificationId).toBe(first.notificationId);
    expect(again.recipients).toEqual([A1, A2]);
    expect(emails.length).toBe(sent);
    expect(
      await count("select 1 from notify.notification where idempotency_key = 'staff-alert-0008'"),
    ).toBe(1);
  });
  it("gives each recipient's deliveries and whether they were reached", async () => {
    const r = await svc.notifyStaff(caller("tnt_a"), alert("staff-alert-0009"));
    const rc = await svc.deliveryReceipt(caller("tnt_a"), r.notificationId);
    expect(rc?.classId).toBe("ops.re_admin.alert");
    expect(rc?.outcome).toBe("targeted");
    expect(rc?.recipients.map((x) => [x.recipient, x.reached])).toEqual([
      [A1, true],
      [A2, true],
    ]);
    const a2 = rc?.recipients.find((x) => x.recipient === A2);
    expect(a2?.deliveries.find((d) => d.channel === "email")).toMatchObject({
      state: "failed",
      lastErrorCode: "no_address",
    });
    // Another tenant cannot read it (forced RLS), and an unknown id is null.
    expect(await svc.deliveryReceipt(caller("tnt_b"), r.notificationId)).toBeNull();
    expect(await svc.deliveryReceipt(caller("tnt_a"), "ntf_unknown")).toBeNull();
  });
});

describe("refusals (PR-UDF-052; IPB-NTF-007)", () => {
  it("keeps staff classes to the staff door and the staff door to staff classes", async () => {
    await expect(
      svc.send(caller("tnt_a"), {
        class: "ops.re_admin.alert",
        to: [{ ref: M1 }],
        vars: { id: "alr_01" },
        deepLink: "/ops/alerts/alr_01",
        idempotencyKey: "staff-send-0001",
      }),
    ).rejects.toMatchObject({ code: "IPB-NTF-007", meta: { reason: "staff_class" } });
    await expect(
      svc.notifyStaff(caller("tnt_a"), alert("staff-alert-0010", { class: "export.ready" })),
    ).rejects.toMatchObject({ code: "IPB-NTF-007", meta: { reason: "not_staff_class" } });
  });
  it("refuses personal data and unknown variables before anything is recorded", async () => {
    for (const [key, vars, reason] of [
      ["staff-alert-0011", { id: "alr_01", note: "borrower asha@example.test" }, "personal_data"],
      ["staff-alert-0012", { id: "Asha Rao" }, "not_a_reference"],
      ["staff-alert-0013", { id: "alr_01", name: "Asha" }, "unknown_variable"],
    ] as const)
      await expect(svc.notifyStaff(caller("tnt_a"), alert(key, { vars }))).rejects.toMatchObject({
        code: "IPB-NTF-007",
        meta: { reason },
      });
    expect(
      await count(
        "select 1 from notify.notification where idempotency_key in ('staff-alert-0011', 'staff-alert-0012', 'staff-alert-0013')",
      ),
    ).toBe(0);
  });
  it("refuses platform, service and agent roles", async () => {
    for (const role of ["PLT_SUPPORT", "SVC_NOTIFY", "AGT_VIDHI"])
      await expect(
        svc.notifyStaff(caller("tnt_a"), alert("staff-alert-0014", { roles: [role] })),
      ).rejects.toThrow();
  });
});

describe("preferences on staff classes (IPB-07-25)", () => {
  it("honours an optional class's preference and keeps a mandatory class's channels", async () => {
    const self = withTenant("tnt_a", ["ORG_ADMIN"], { principal: { id: A1 } });
    await svc.setPreferences(self, A1, {
      "ops.re_admin.alert": { inapp: false, email: false },
    });
    await expect(
      svc.setPreferences(self, A1, {
        "ops.re_admin.key_rotation": { inapp: false, email: false },
      }),
    ).rejects.toMatchObject({ code: "IPB-NTF-001" });
    const r = await svc.notifyStaff(caller("tnt_a"), alert("staff-alert-0015"));
    expect(r.recipients).toEqual([A1, A2]);
    expect(r.deliveries.some((d) => d.recipient === A1)).toBe(false);
    const k = await svc.notifyStaff(caller("tnt_a"), {
      class: "ops.re_admin.key_rotation",
      roles: ["ORG_ADMIN"],
      vars: { id: "key_01" },
      deepLink: "/settings/keys",
      idempotencyKey: "staff-key-0001",
    });
    expect(k.deliveries.filter((d) => d.recipient === A1).map((d) => d.channel)).toEqual([
      "inapp",
      "email",
    ]);
  });
});
