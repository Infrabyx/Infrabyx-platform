// Tenant entitlements (Finbyx PR-FBX-43; OWNER-QUESTIONS #123; R1-D-107; tenancy/0020), with RLS
// on: a change is requested by a PLT_SUPER_ADMIN or PLT_FINANCE and approved by a different
// PLT_SUPER_ADMIN or PLT_SECURITY_OFFICER, never the requester, a tenant user, a support role or an
// impersonation; R3 outside production, R4 (delay) in production; the tenant is told of every
// grant, revocation and lapse and sees them; a lapsed or revoked licence refuses writes and keeps
// records readable.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuditEntryInput, AuditSink, KernelContext, Tx } from "@infrabyx/contracts/kernel";
import { newId } from "@infrabyx/crypto";
import { ApprovalsEngine } from "./approvals/engine.js";
import { TenantBootstrap } from "./bootstrap.js";
import { PLATFORM_TENANT_ID } from "./context.js";
import {
  ENTITLEMENT_CHANGE_ACTION,
  EntitlementRefusal,
  type EntitlementNotice,
  TenantEntitlements,
} from "./entitlements.js";
import { PgKernel } from "./kernel.js";
import { freshDb, type TestDb } from "./__tests__/pg.js";

class RecordingAudit implements AuditSink {
  readonly entries: Array<AuditEntryInput & { tenantId: string; principal: string }> = [];
  async record(tx: Tx, e: AuditEntryInput): Promise<{ id: string }> {
    this.entries.push({ ...e, tenantId: tx.ctx.tenantId, principal: tx.ctx.principal.id });
    tx.markAudited();
    return { id: "led_x" };
  }
}

let db: TestDb;
let kernel: PgKernel;
let ents: TenantEntitlements;
const audit = new RecordingAudit();
const told: EntitlementNotice[] = [];
const plt = (id: string, role: string, extra: Partial<KernelContext> = {}): KernelContext => ({
  tenantId: PLATFORM_TENANT_ID,
  scope: "platform",
  principal: { id, type: "user", roles: [role] },
  ...extra,
});
const superAdmin = plt("usr_sa", "PLT_SUPER_ADMIN");
const superAdmin2 = plt("usr_sa2", "PLT_SUPER_ADMIN");
const finance = plt("usr_fin", "PLT_FINANCE");
const officer = plt("usr_sec", "PLT_SECURITY_OFFICER");
const member = (tenantId: string, roles = ["ORG_OWNER"]): KernelContext => ({
  tenantId,
  principal: { id: "usr_owner", type: "user", roles },
});
const err = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { code?: string; message?: string }) => e.code ?? e.message,
  );
const day = (offset: number) =>
  new Date(Date.now() + 5.5 * 3_600_000 + offset * 86_400_000).toISOString().slice(0, 10);
const grant = (validFrom = day(-1), validUntil: string | null = null) => ({
  sku: "RECOVERY_CORE",
  kind: "GRANT",
  validFrom,
  validUntil,
  reason: "signed order for the recovery suite",
});
/** A write a product guards with the licence. */
const write = (tenantId: string) =>
  kernel.mutate(
    member(tenantId),
    async (tx) => {
      await ents.assertWritableIn(tx, "RECOVERY_CORE");
      await audit.record(tx, { action: "rec.case.open", resourceType: "case", resourceId: "c1" });
      return "written";
    },
    { action: "rec.case.open" },
  );
const status = (tenantId: string) =>
  kernel.read(member(tenantId), (tx) => ents.statusIn(tx, "RECOVERY_CORE"));

let tA: string;
let tB: string;

beforeAll(async () => {
  db = await freshDb();
  kernel = new PgKernel({ pool: db.pool, audit });
  ents = new TenantEntitlements({
    kernel,
    audit,
    approvals: new ApprovalsEngine({ kernel, audit, product: "FBX" }),
    appEnv: "local",
    onNotice: async (_tx, n) => {
      told.push(n);
    },
  });
  await db.admin.query(
    "insert into tenancy.tenant (id, product, name) values ('tnt_platform', 'PLATFORM', 'Infrabyx')",
  );
  const boot = new TenantBootstrap({ kernel, audit, appEnv: "local" });
  tA = newId("tnt");
  tB = newId("tnt");
  await boot.bootstrap(superAdmin, { tenantId: tA, product: "FBX", name: "A Co" });
  await boot.bootstrap(superAdmin, { tenantId: tB, product: "FBX", name: "B Co" });
});
afterAll(async () => db?.end());

describe("PR-FBX-43 tenant entitlements (#123)", () => {
  it("refuses a write with no licence and keeps reads", async () => {
    expect(await status(tA)).toBe("NONE");
    expect(await err(write(tA))).toBe("not_entitled");
    expect((await ents.forTenant(member(tA))).licences).toEqual([]);
  });

  it("is requested by PLT_SUPER_ADMIN or PLT_FINANCE only, in person, from the platform", async () => {
    for (const c of [
      officer,
      plt("usr_sup", "PLT_SUPPORT"),
      { ...member(tA), scope: "platform" as const },
      member(tA, ["ORG_OWNER", "PLT_SUPER_ADMIN"]),
      { ...finance, act: { sub: "usr_fin", sessionId: "s1" } },
      { ...finance, principal: { id: "svc_x", type: "service" as const, roles: ["PLT_FINANCE"] } },
    ])
      expect(await err(ents.request(c, tA, grant())), c.principal.id).toBe("IPB-SEC-005");
    await expect(ents.request(finance, tA, { ...grant(), reason: "short" })).rejects.toThrow();
    await expect(
      ents.request(finance, tA, { ...grant(), kind: "REVOKE", validUntil: day(9) }),
    ).rejects.toThrow(/no end date/);
  });

  it("is approved by a different PLT_SUPER_ADMIN or PLT_SECURITY_OFFICER, never the requester, then applied once", async () => {
    const { requestId } = await ents.request(finance, tA, grant());
    // Not the requester, not finance, not support, not the tenant, not an impersonation.
    expect(await err(ents.decide(finance, tA, requestId, "approve"))).toBe("IPB-SEC-005");
    expect(await err(ents.decide(plt("usr_sup", "PLT_SUPPORT"), tA, requestId, "approve"))).toBe(
      "IPB-SEC-005",
    );
    expect(
      await err(
        ents.decide(
          { ...officer, act: { sub: "usr_x", sessionId: "s" } },
          tA,
          requestId,
          "approve",
        ),
      ),
    ).toBe("IPB-SEC-005");
    expect(await err(ents.apply(superAdmin, tA, requestId))).toMatch(/pending/);
    await ents.decide(officer, tA, requestId, "approve", "matches the signed order");
    const v = await ents.apply(superAdmin, tA, requestId);
    expect(v).toMatchObject({
      sku: "RECOVERY_CORE",
      version: 1,
      kind: "GRANT",
      requestedBy: "usr_fin",
      approvedBy: "usr_sec",
    });
    expect(await err(ents.apply(superAdmin, tA, requestId))).toMatch(/executed/);
    expect(await status(tA)).toBe("ACTIVE");
    expect(await write(tA)).toBe("written");
    // The other tenant is untouched.
    expect(await status(tB)).toBe("NONE");
    // A PLT_SUPER_ADMIN requester is never its own approver either.
    const own = await ents.request(superAdmin, tB, grant());
    expect(await err(ents.decide(superAdmin, tB, own.requestId, "approve"))).toBe("IPB-SEC-007");
    await ents.decide(superAdmin2, tB, own.requestId, "approve");
    expect((await ents.apply(finance, tB, own.requestId)).approvedBy).toBe("usr_sa2");
    // Both steps are ledgered, in the tenant.
    const mine = audit.entries.filter(
      (e) => e.tenantId === tA && e.action.startsWith("tenancy.entitlement"),
    );
    expect(mine.map((e) => [e.action, e.principal])).toEqual([
      ["tenancy.entitlement.request", "usr_fin"],
      [ENTITLEMENT_CHANGE_ACTION, "usr_sa"],
    ]);
  });

  it("tells the tenant of a grant and a revocation; a revocation refuses writes and keeps records readable", async () => {
    expect(told.filter((n) => n.kind === "GRANT").length).toBe(2);
    const { requestId } = await ents.request(superAdmin, tA, {
      sku: "RECOVERY_CORE",
      kind: "REVOKE",
      validFrom: day(0),
      reason: "the order was cancelled by the customer",
    });
    await ents.decide(officer, tA, requestId, "approve");
    await ents.apply(superAdmin, tA, requestId);
    expect(await status(tA)).toBe("REVOKED");
    const refused = await write(tA).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(EntitlementRefusal);
    expect(refused).toMatchObject({
      status: 403,
      code: "not_entitled",
      entitlementStatus: "REVOKED",
    });
    const view = await ents.forTenant(member(tA));
    expect(view.licences).toEqual([
      expect.objectContaining({
        sku: "RECOVERY_CORE",
        version: 2,
        kind: "REVOKE",
        status: "REVOKED",
      }),
    ]);
    expect(view.notices.map((n) => n.kind).sort()).toEqual(["GRANT", "REVOKE"]);
    expect(told.at(-1)).toMatchObject({ kind: "REVOKE", sku: "RECOVERY_CORE", version: 2 });
    // The other tenant sees none of it.
    expect((await ents.forTenant(member(tB))).notices.every((n) => n.version === 1)).toBe(true);
  });

  it("records a lapse once, tells the tenant, and the lapsed licence refuses writes", async () => {
    const tC = newId("tnt");
    await new TenantBootstrap({ kernel, audit, appEnv: "local" }).bootstrap(superAdmin, {
      tenantId: tC,
      product: "FBX",
      name: "C Co",
    });
    const { requestId } = await ents.request(finance, tC, grant(day(-30), day(-1)));
    await ents.decide(officer, tC, requestId, "approve");
    await ents.apply(finance, tC, requestId);
    expect(await status(tC)).toBe("LAPSED");
    expect(await err(write(tC))).toBe("not_entitled");
    const sweep = plt("svc_entitlements", "PLT_SUPER_ADMIN");
    expect(await ents.recordLapses(sweep)).toBe(1);
    expect(await ents.recordLapses(sweep)).toBe(0);
    expect((await ents.forTenant(member(tC))).notices.map((n) => n.kind).sort()).toEqual([
      "GRANT",
      "LAPSE",
    ]);
    expect(told.at(-1)).toMatchObject({ kind: "LAPSE", validUntil: day(-1) });
  });

  it("is R4 in production: not applied before its delay", async () => {
    const prod = new TenantEntitlements({
      kernel,
      audit,
      approvals: new ApprovalsEngine({ kernel, audit, product: "FBX" }),
      appEnv: "prod",
    });
    const { requestId } = await prod.request(finance, tB, grant());
    const r = await prod.decide(officer, tB, requestId, "approve");
    expect(r.riskClass).toBe("R4");
    expect(r.delayMinutes).toBeGreaterThanOrEqual(60);
    expect(await err(prod.apply(superAdmin, tB, requestId))).toBe("IPB-SEC-008");
  });

  it("is written only by the platform's approved path, and only ever added to", async () => {
    // A tenant context, even with the action name, cannot write a version.
    await expect(
      kernel.mutate(
        member(tB),
        async (tx) => {
          await audit.record(tx, {
            action: ENTITLEMENT_CHANGE_ACTION,
            resourceType: "x",
            resourceId: "x",
          });
          await tx.query(
            `insert into tenancy.entitlement (id, tenant_id, sku, version, kind, valid_from, reason, requested_by, approved_by, approval_id)
             values ($1, $2, 'RECOVERY_CORE', 9, 'GRANT', current_date, 'self-granted licence', 'a', 'b', 'x')`,
            [newId("lic"), tB],
          );
        },
        { action: ENTITLEMENT_CHANGE_ACTION },
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      db.admin.query("update tenancy.entitlement set reason = 'edited reason here'"),
    ).rejects.toThrow(/insert-only/);
    await expect(db.admin.query("delete from tenancy.entitlement_notice")).rejects.toThrow(
      /insert-only/,
    );
  });
});
