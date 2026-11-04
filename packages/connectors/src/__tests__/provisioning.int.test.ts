// The Operations Hub provisioning adapter (LawDocsComply PR-LDC-11; R1-plan M38; R1-D-68) on
// PostgreSQL 18 with every platform migration: the signed `TenantProvisioned` verified, stored
// in the product's inbox and turned into a tenant once per provisioning request, with the
// product's hook in the creation transaction and the real hash-chained ledger.
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
import { EcosystemInbox, PLATFORM_TENANT_ID, TenantBootstrap } from "@infrabyx/tenancy";
import { startPostgres, type TestDatabase } from "@infrabyx/testing";
import {
  OperationsHubProvisioning,
  provisionedTenantId,
  type ProvisionedTenant,
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
let failHook = 0;
let adapter: OperationsHubProvisioning;
const make = (over: Partial<ConstructorParameters<typeof OperationsHubProvisioning>[0]> = {}) =>
  new OperationsHubProvisioning({
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
    ...over,
  });
const code = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { code?: string; meta?: { reason?: string } }) => `${e.code}:${e.meta?.reason ?? ""}`,
  );

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "ldcprov-"));
  writeFileSync(
    join(dir, "0001_ldcprov.sql"),
    `create schema ldcprov;\ngrant usage on schema ldcprov to app_rw, app_ro;\nselect tenancy.create_ecosystem_inbox('ldcprov');\n`,
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
