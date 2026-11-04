// The Operations Hub provisioning adapter (LawDocsComply PR-LDC-11; R1-plan M38; R1-D-68, R1-D-70)
// on PostgreSQL 18 with every platform migration: the signed `TenantProvisioned` verified, stored
// in the product's inbox and turned into a tenant once per provisioning request, with the
// product's hook in the creation transaction and the real hash-chained ledger; and (Ecosystem
// Spec v1.3, PR-040, #105) `ProvisioningRequested` written to the product's outbox and signed at
// delivery, and `ProvisioningFailed` handed to the product's failure hook with the purge deadline.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { KernelContext } from "@infrabyx/contracts/kernel";
import {
  LocalKms,
  MemoryReplayStore,
  RegulatedKeyRing,
  randomBytes,
  signRegulatedMessage,
  toHex,
} from "@infrabyx/crypto";
import { EcosystemInbox, PgOutbox, PLATFORM_TENANT_ID, TenantBootstrap } from "@infrabyx/tenancy";
import { startPostgres, type TestDatabase } from "@infrabyx/testing";
import {
  carriesPersonalData,
  OperationsHubProvisioning,
  provisionedTenantId,
  type ProvisionedTenant,
  type ProvisioningFailure,
} from "../provisioning/index.js";

function uuidv7(ms = Date.now()): string {
  const b = randomBytes(16);
  const t = BigInt(ms);
  for (let i = 0; i < 6; i++) b[i] = Number((t >> BigInt(8 * (5 - i))) & 0xffn);
  b[6] = (b[6]! & 0x0f) | 0x70;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = toHex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const kms = new LocalKms();
const HUB_KID = "local:sign:oh-provisioning";
const LDC_KID = "local:sign:ldc-ecosystem";
const OTHER_KID = "local:sign:someone-else";
let keys: RegulatedKeyRing;

const event = (data: Record<string, unknown>, over: Record<string, unknown> = {}) => {
  const req = (data.provisioning_request_id as string) ?? uuidv7();
  return {
    specversion: "1.0",
    id: uuidv7(),
    source: "urn:infrabyx:oh:le_infrabyx",
    type: "in.infrabyx.ops.TenantProvisioned.v1",
    subject: req,
    time: "2026-11-04T10:00:00+05:30",
    datacontenttype: "application/json",
    dataschema: "https://registry.infrabyx.example/schemas/ops/TenantProvisioned/1.0.0.json",
    tenantid: "le_infrabyx",
    reid: "none",
    productfamily: "na",
    legalbasis: "CONTRACT_PERFORMANCE_VENDOR",
    dataclass: "INTERNAL",
    schemaver: "1.0.0",
    seq: 1,
    data: {
      provisioning_request_id: req,
      org_id: "org_acme",
      product: "LAWDOCSCOMPLY",
      environment: "UAT",
      legal_entities: [{ name: "Acme Advisory LLP" }],
      plan_ref: "pln_trial",
      first_admin_email: "admin@acme.example",
      ...data,
    },
    ...over,
  };
};
/** Signed with the Hub's key; `as` signs with another key under the Hub's `kid` (a forgery). */
const signed = async <E extends Record<string, unknown>>(e: E, as = HUB_KID) => ({
  e,
  jws: await signRegulatedMessage({
    event: e,
    kid: HUB_KID,
    sign: (m) => kms.sign(as, m, "ecdsa-p256-sha256"),
  }),
});

let db: TestDatabase;
const platform: KernelContext = {
  tenantId: PLATFORM_TENANT_ID,
  scope: "platform",
  principal: { id: "svc_ldc_provisioning", type: "service", roles: ["PLT_SUPER_ADMIN"] },
};
const proofs = new Map<string, string>();
const hooked: ProvisionedTenant[] = [];
const failures: ProvisioningFailure[] = [];
let failHook = 0;
let adapter: OperationsHubProvisioning;
type Options = ConstructorParameters<typeof OperationsHubProvisioning>[0];
const make = (over: Partial<Options> = {}, drop: ReadonlyArray<keyof Options> = []) => {
  const o: Options = {
    inbox: new EcosystemInbox({
      kernel: db.kernel,
      audit: db.audit,
      schema: "ldcprov",
      environment: "live",
    }),
    tenants: new TenantBootstrap({ kernel: db.kernel, audit: db.audit, appEnv: "prod" }),
    platformCtx: platform,
    product: "LDC",
    environment: "UAT",
    keys,
    replay: new MemoryReplayStore(),
    proofs: { save: async (id, jws) => void proofs.set(id, jws) },
    onProvisioned: async (tx, t) => {
      if (failHook > 0) {
        failHook--;
        throw new Error("product hook failed");
      }
      await tx.query("select 1 from tenancy.tenant where id = $1", [t.tenantId]);
      hooked.push(t);
    },
    onFailed: async (tx, f) => {
      await tx.query("select 1");
      failures.push(f);
    },
    outbox: { writer: new PgOutbox(), schema: "ldcprov" },
    signer: { kid: LDC_KID, sign: (m) => kms.sign(LDC_KID, m, "ecdsa-p256-sha256") },
    ...over,
  };
  for (const k of drop) delete o[k];
  return new OperationsHubProvisioning(o);
};
const code = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { code?: string; meta?: { reason?: string } }) => `${e.code}:${e.meta?.reason ?? ""}`,
  );

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "ldcprov-"));
  writeFileSync(
    join(dir, "0001_ldcprov.sql"),
    [
      "create schema ldcprov;",
      "grant usage on schema ldcprov to app_rw, app_ro;",
      "select tenancy.create_ecosystem_inbox('ldcprov');",
      "create table ldcprov.outbox (id text primary key, tenant_id text not null, type text not null,",
      "  envelope jsonb not null, created_at timestamptz not null default now(),",
      "  dispatched_at timestamptz, attempts integer not null default 0);",
      "comment on column ldcprov.outbox.id is 'dataclass:INTERNAL';",
      "comment on column ldcprov.outbox.tenant_id is 'dataclass:INTERNAL';",
      "comment on column ldcprov.outbox.type is 'dataclass:INTERNAL';",
      "comment on column ldcprov.outbox.envelope is 'dataclass:INTERNAL';",
      "comment on column ldcprov.outbox.created_at is 'dataclass:INTERNAL';",
      "comment on column ldcprov.outbox.dispatched_at is 'dataclass:INTERNAL';",
      "comment on column ldcprov.outbox.attempts is 'dataclass:INTERNAL';",
      "alter table ldcprov.outbox enable row level security;",
      "alter table ldcprov.outbox force row level security;",
      "create policy outbox_tenant on ldcprov.outbox for all",
      "  using (tenant_id = current_setting('app.tenant_id', true))",
      "  with check (tenant_id = current_setting('app.tenant_id', true));",
      "grant select, insert, update on ldcprov.outbox to app_rw;",
      "",
    ].join("\n"),
  );
  keys = new RegulatedKeyRing([{ kid: HUB_KID, key: await kms.getPublicKey(HUB_KID) }]);
  db = await startPostgres({ migrations: [{ name: "ldcprov", dir }] });
  adapter = make();
});
afterAll(async () => db?.end());

describe("R1-D-68 the Operations Hub provisioning adapter (PR-LDC-11)", () => {
  it("creates the tenant once per provisioning request, with the hook in its transaction", async () => {
    const { e, jws } = await signed(event({}));
    expect((await adapter.receive(e, jws)).outcome).toBe("accepted");
    expect(proofs.get(e.id)).toBe(jws);
    // The Hub sends the same request again as a new event: acknowledged, never processed.
    const again = await signed(event({ provisioning_request_id: e.subject }));
    expect((await adapter.receive(again.e, again.jws)).outcome).toBe("business_duplicate");
    expect(await adapter.drain()).toMatchObject({ processed: 1, failed: 0 });
    const tenantId = provisionedTenantId(e.data as never);
    expect(hooked.filter((h) => h.provisioningRequestId === e.subject)).toEqual([
      expect.objectContaining({ tenantId, eventId: e.id }),
    ]);
    const t = await db.admin.query(
      "select product, name, org_id, plan_ref from tenancy.tenant where id = $1",
      [tenantId],
    );
    expect(t.rows[0]).toEqual({
      product: "LDC",
      name: "Acme Advisory LLP",
      org_id: "org_acme",
      plan_ref: "pln_trial",
    });
    const led = await db.admin.query(
      "select action, tenant_id from audit.ledger where tenant_id = $1 order by seq",
      [tenantId],
    );
    expect(led.rows.map((r) => r.action)).toContain("tenancy.tenant.bootstrap");
    expect(await adapter.drain()).toMatchObject({ processed: 0 });
  });

  it("binds PR-040's provisional tenant id when the event carries it, in prod", async () => {
    const provisional = "tnt_01JBQ0000000000000000000PV";
    const { e, jws } = await signed(event({ provisional_tenant_id: provisional }));
    await adapter.receive(e, jws);
    await adapter.drain();
    expect(
      (await db.admin.query("select 1 from tenancy.tenant where id = $1", [provisional])).rowCount,
    ).toBe(1);
  });

  it("retries a failed hook, and nothing of the tenant survives the failed attempt", async () => {
    const { e, jws } = await signed(event({}));
    await adapter.receive(e, jws);
    failHook = 1;
    expect(await adapter.drain()).toMatchObject({ failed: 1 });
    const tenantId = provisionedTenantId(e.data as never);
    expect(
      (await db.admin.query("select 1 from tenancy.tenant where id = $1", [tenantId])).rowCount,
    ).toBe(0);
    expect(await adapter.drain()).toMatchObject({ processed: 1 });
    expect(hooked.filter((h) => h.tenantId === tenantId)).toHaveLength(1);
  });

  it("refuses a forged, replayed or misdirected event before it is stored", async () => {
    const forged = await signed(event({}), OTHER_KID);
    expect(await code(adapter.receive(forged.e, forged.jws))).toBe("IPB-API-018:signature");
    const ok = await signed(event({}));
    await adapter.receive(ok.e, ok.jws);
    expect(await code(adapter.receive(ok.e, ok.jws))).toBe("IPB-API-018:replay");
    for (const [data, over, reason] of [
      [{ product: "FINBYX" }, {}, "product"],
      [{ environment: "PRODUCTION" }, {}, "environment"],
      [{}, { source: "urn:infrabyx:finbyx:tnt_x" }, "source"],
      [{}, { type: "in.infrabyx.ops.TenantSuspended.v1" }, "type"],
      [{}, { legalbasis: undefined, consentref: "cns_1" }, "legalbasis"],
    ] as const) {
      const s = await signed(event(data, over));
      expect(await code(adapter.receive(s.e, s.jws))).toBe(`IPB-API-005:${reason}`);
    }
    const prod = make({ environment: "PRODUCTION" });
    const p = await signed(event({ environment: "PRODUCTION" }));
    expect(await code(prod.receive(p.e, p.jws))).toBe("IPB-API-005:regulatory-guard");
  });
});

describe("R1-D-70 the request half and the failure path (Ecosystem Spec v1.3, PR-040, #105)", () => {
  const provisional = "tnt_01JBQ0000000000000000000RQ";
  const owner: KernelContext = {
    tenantId: provisional,
    principal: { id: "svc_ldc_trial", type: "service", roles: ["ORG_OWNER"] },
  };
  const raise = (over: Record<string, unknown> = {}, id?: string) =>
    db.kernel.mutate(owner, async (tx) => {
      const r = await adapter.request(tx, {
        ...(id ? { provisioningRequestId: id } : {}),
        provisionalTenantId: provisional,
        planId: "pln_trial",
        modules: ["grc"],
        homeCell: "in-mum-1",
        orgName: "Acme Advisory LLP",
        consentRef: "cns_terms_1",
        firstAdminEmail: "admin@acme.example",
        ...over,
      });
      await db.audit.record(tx, {
        action: "ldc.trial.provisioning_requested",
        resourceType: "provisioning_request",
        resourceId: r.provisioningRequestId,
      });
      return r;
    });
  const failure = (req: string, data: Record<string, unknown> = {}, over = {}) => ({
    ...event(
      { provisioning_request_id: req },
      {
        type: "in.infrabyx.ops.ProvisioningFailed.v1",
        dataschema: "https://registry.infrabyx.example/schemas/ops/ProvisioningFailed/1.0.0.json",
        tenantid: provisional,
        legalbasis: undefined,
        ...over,
      },
    ),
    data: {
      provisioning_request_id: req,
      provisional_tenant_id: provisional,
      product: "LAWDOCSCOMPLY",
      environment: "UAT",
      reason_code: "KYB_FAILED",
      retryable: false,
      failed_at: "2026-11-05T10:00:00+05:30",
      ...data,
    },
  });

  it("writes ProvisioningRequested once per request id, and refuses the id with another payload", async () => {
    const first = await raise();
    expect(first.created).toBe(true);
    expect(await raise({}, first.provisioningRequestId)).toEqual({ ...first, created: false });
    expect(await code(raise({ planId: "pln_enterprise" }, first.provisioningRequestId))).toBe(
      "IPB-PORT-004:idempotency-conflict",
    );
    const rows = await db.admin.query(
      "select tenant_id, type, envelope from ldcprov.outbox where envelope->>'subject' = $1",
      [first.provisioningRequestId],
    );
    expect(rows.rows).toHaveLength(1);
    const e = rows.rows[0].envelope;
    expect(e).toMatchObject({
      type: "in.infrabyx.ops.ProvisioningRequested.v1",
      source: `urn:infrabyx:ldc:${provisional}`,
      tenantid: provisional,
      legalbasis: "CONTRACT_PERFORMANCE_VENDOR",
      reid: "none",
      productfamily: "na",
      data: { product: "LAWDOCSCOMPLY", environment: "UAT", provisional_tenant_id: provisional },
    });
    // The relay signs at delivery; the Hub verifies against the product's pinned key.
    const jws = await adapter.signForDelivery(e);
    const hub = new RegulatedKeyRing([{ kid: LDC_KID, key: await kms.getPublicKey(LDC_KID) }]);
    const { verifyRegulatedMessage } = await import("@infrabyx/crypto");
    expect(
      await verifyRegulatedMessage(e, jws, { keys: hub, replay: new MemoryReplayStore() }),
    ).toMatchObject({ ok: true });
    // Without a first-admin email no legal basis is claimed.
    const bare = await raise({ firstAdminEmail: undefined });
    const b = await db.admin.query("select envelope from ldcprov.outbox where id = $1", [
      bare.eventId,
    ]);
    expect(b.rows[0].envelope.legalbasis).toBeUndefined();
  });

  it("hands ProvisioningFailed to the product's hook once, with the 30-day purge deadline", async () => {
    const { provisioningRequestId: req } = await raise();
    const { e, jws } = await signed(failure(req));
    expect((await adapter.receive(e, jws)).outcome).toBe("accepted");
    expect(proofs.get(e.id)).toBe(jws);
    // One request, one outcome: a later TenantProvisioned for the same request is ignored.
    const late = await signed(
      event({ provisioning_request_id: req, provisional_tenant_id: provisional }),
    );
    expect((await adapter.receive(late.e, late.jws)).outcome).toBe("business_duplicate");
    expect(await adapter.drain()).toMatchObject({ failed: 0 });
    expect(failures.filter((f) => f.provisioningRequestId === req)).toEqual([
      expect.objectContaining({
        provisionalTenantId: provisional,
        reasonCode: "KYB_FAILED",
        retryable: false,
        failedAt: new Date("2026-11-05T04:30:00Z"),
        purgeBy: new Date("2026-12-05T04:30:00Z"),
        eventId: e.id,
      }),
    ]);
  });

  it("ignores a ProvisioningFailed after the request's TenantProvisioned", async () => {
    const { provisioningRequestId: req } = await raise();
    const ok = await signed(
      event({ provisioning_request_id: req, provisional_tenant_id: provisional }),
    );
    expect((await adapter.receive(ok.e, ok.jws)).outcome).toBe("accepted");
    const f = await signed(failure(req));
    expect((await adapter.receive(f.e, f.jws)).outcome).toBe("business_duplicate");
    await adapter.drain();
    expect(failures.some((x) => x.provisioningRequestId === req)).toBe(false);
  });

  it("refuses a ProvisioningFailed with personal data, a wrong retryable, or no failure hook", async () => {
    const req = (await raise()).provisioningRequestId;
    for (const [data, over, reason] of [
      [{ detail: "KYB failed for admin@acme.example" }, {}, "personal-data"],
      [{ detail: "call 98765 43210" }, {}, "personal-data"],
      [{ detail: "PAN ABCDE1234F did not match" }, {}, "personal-data"],
      [{ retryable: true }, {}, "payload"],
      [{ reason_code: "LOST" }, {}, "payload"],
      [{}, { tenantid: "le_infrabyx" }, "tenantid"],
      [{ product: "FINBYX" }, {}, "product"],
    ] as const) {
      const s = await signed(failure(req, data, over));
      expect(await code(adapter.receive(s.e, s.jws))).toBe(`IPB-API-005:${reason}`);
    }
    const forged = await signed(failure(req), OTHER_KID);
    expect(await code(adapter.receive(forged.e, forged.jws))).toBe("IPB-API-018:signature");
    const noHook = make({}, ["onFailed"]);
    const s = await signed(failure(req));
    expect(await code(noHook.receive(s.e, s.jws))).toBe("IPB-API-005:type");
    expect(carriesPersonalData("the plan is not offered in this cell")).toBe(false);
  });
});
