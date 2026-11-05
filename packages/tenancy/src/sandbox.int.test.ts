// Sandbox tenants (LawDocsComply PR-LDC-29; R1-plan M60; R1-D-87; tenancy/0018), with RLS on: the
// flag is set at creation, the kernel reads it into `tx.ctx.sandbox` in every transaction over
// whatever the caller passed, and only the platform's ledgered path changes it.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuditEntryInput, AuditSink, KernelContext, Tx } from "@infrabyx/contracts/kernel";
import { isSandboxed } from "@infrabyx/contracts/kernel";
import { newId } from "@infrabyx/crypto";
import { TenantBootstrap } from "./bootstrap.js";
import { PLATFORM_TENANT_ID } from "./context.js";
import { ApprovalsEngine } from "./approvals/engine.js";
import { PgKernel } from "./kernel.js";
import { TENANT_SANDBOX_SET_ACTION, TenantSandbox } from "./sandbox.js";
import { freshDb, type TestDb } from "./__tests__/pg.js";

class RecordingAudit implements AuditSink {
  readonly entries: Array<AuditEntryInput & { tenantId: string }> = [];
  async record(tx: Tx, e: AuditEntryInput): Promise<{ id: string }> {
    this.entries.push({ ...e, tenantId: tx.ctx.tenantId });
    tx.markAudited();
    return { id: "led_x" };
  }
}

let db: TestDb;
let kernel: PgKernel;
let sandboxes: TenantSandbox;
const audit = new RecordingAudit();
const admin: KernelContext = {
  tenantId: PLATFORM_TENANT_ID,
  scope: "platform",
  principal: { id: "usr_admin", type: "user", roles: ["PLT_SUPER_ADMIN"] },
};
const admin2: KernelContext = {
  tenantId: PLATFORM_TENANT_ID,
  scope: "platform",
  principal: { id: "usr_admin2", type: "user", roles: ["PLT_SUPER_ADMIN"] },
};
const officer: KernelContext = {
  tenantId: PLATFORM_TENANT_ID,
  scope: "platform",
  principal: { id: "usr_officer", type: "user", roles: ["PLT_SECURITY_OFFICER"] },
};
const member = (tenantId: string, extra: Partial<KernelContext> = {}): KernelContext => ({
  tenantId,
  principal: { id: "usr_member", type: "user", roles: ["ORG_OWNER"] },
  ...extra,
});
const err = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { code?: string; message?: string }) => e.code ?? e.message,
  );
const seen = (ctx: KernelContext) => kernel.read(ctx, async (tx) => tx.ctx.sandbox);
const seenMutating = (ctx: KernelContext) =>
  kernel.mutate(
    ctx,
    async (tx) => {
      await audit.record(tx, { action: "test.touch", resourceType: "t", resourceId: "x" });
      return tx.ctx.sandbox;
    },
    { action: "test.touch" },
  );

let sandboxId: string;
let liveId: string;

beforeAll(async () => {
  db = await freshDb();
  kernel = new PgKernel({ pool: db.pool, audit });
  sandboxes = new TenantSandbox({
    kernel,
    audit,
    approvals: new ApprovalsEngine({ kernel, audit, product: "LDC" }),
    appEnv: "local",
  });
  const boot = new TenantBootstrap({ kernel, audit, appEnv: "local" });
  sandboxId = newId("tnt");
  liveId = newId("tnt");
  await boot.bootstrap(admin, {
    tenantId: sandboxId,
    product: "LDC",
    name: "Try Co",
    sandbox: true,
  });
  await boot.bootstrap(admin, { tenantId: liveId, product: "LDC", name: "Live Co" });
});
afterAll(async () => {
  await db?.end();
});

describe("R1-D-87 sandbox tenants (PR-LDC-29)", () => {
  it("is set when the tenant is created, false by default, and part of the request", async () => {
    const r = await db.admin.query<{ id: string; sandbox: boolean }>(
      "select id, sandbox from tenancy.tenant where id = any($1::text[])",
      [[sandboxId, liveId]],
    );
    expect(Object.fromEntries(r.rows.map((x) => [x.id, x.sandbox]))).toEqual({
      [sandboxId]: true,
      [liveId]: false,
    });
    const boot = new TenantBootstrap({ kernel, audit, appEnv: "local" });
    // The same request again is a replay; another value under the id is another request.
    expect(
      await boot.bootstrap(admin, {
        tenantId: sandboxId,
        product: "LDC",
        name: "Try Co",
        sandbox: true,
      }),
    ).toEqual({ tenantId: sandboxId, created: false });
    expect(
      await err(boot.bootstrap(admin, { tenantId: sandboxId, product: "LDC", name: "Try Co" })),
    ).toMatch(/already exists/);
  });

  it("is read by the kernel into tx.ctx in reads and mutations, over what the caller passed", async () => {
    expect(await seen(member(sandboxId))).toBe(true);
    expect(await seen(member(sandboxId, { sandbox: false }))).toBe(true);
    expect(await seenMutating(member(sandboxId, { sandbox: false }))).toBe(true);
    expect(await seen(member(liveId))).toBe(false);
    expect(await seen(member(liveId, { sandbox: true }))).toBe(false);
    expect(await seenMutating(member(liveId, { sandbox: true }))).toBe(false);
    expect(await kernel.read(member(liveId), async (tx) => isSandboxed(tx.ctx))).toBe(false);
    // A platform context in a tenant sees that tenant's flag.
    expect(await seen({ ...admin, tenantId: sandboxId, sandbox: false })).toBe(true);
    // No tenant row: never flagged, so not a sandbox, whatever the caller claims.
    const none = await kernel.read(member("tnt_missing", { sandbox: true }), async (tx) => tx.ctx);
    expect(none.sandbox).toBe(false);
    expect(isSandboxed(none)).toBe(false);
    // A context the kernel never read carries no flag, and the ports treat it as a sandbox.
    expect(isSandboxed({ ...member(liveId) })).toBe(true);
  });

  it("keeps the ambient transaction's flag in a joined mutation", async () => {
    const inner = await kernel.ambient(
      member(sandboxId),
      async () => seenMutating(member(sandboxId, { sandbox: false })),
      { action: "test.ambient" },
    );
    expect(inner).toBe(true);
  });

  it("cannot be changed by the tenant, nor by the platform outside the ledgered path", async () => {
    // RLS lets a tenant update its own row; the trigger refuses the flag.
    expect(
      await err(
        kernel.mutate(
          member(sandboxId),
          async (tx) => {
            await tx.query("update tenancy.tenant set sandbox = false where id = $1", [sandboxId]);
            await audit.record(tx, { action: "test.flip", resourceType: "t", resourceId: "x" });
          },
          { action: TENANT_SANDBOX_SET_ACTION },
        ),
      ),
    ).toBe("42501");
    // A platform context with another action is refused as well.
    expect(
      await err(
        kernel.mutate(
          { ...admin, tenantId: sandboxId },
          async (tx) => {
            await tx.query("update tenancy.tenant set sandbox = false where id = $1", [sandboxId]);
            await audit.record(tx, { action: "test.flip", resourceType: "t", resourceId: "x" });
          },
          { action: "tenancy.tenant.update" },
        ),
      ),
    ).toBe("42501");
    // Other columns of its own row are unaffected by the guard.
    await db.admin.query("update tenancy.tenant set plan_ref = 'pln_x' where id = $1", [sandboxId]);
    // The service: a direct set is refused (#115); a tenant context and a platform role other
    // than PLT_SUPER_ADMIN cannot raise a change; a reason is required.
    expect(await err(sandboxes.set(admin, sandboxId, false, "go live after the trial"))).toBe(
      "IPB-SEC-005",
    );
    expect(
      await err(sandboxes.request(member(sandboxId), sandboxId, false, "go live after the trial")),
    ).toBe("IPB-SEC-005");
    expect(await err(sandboxes.request(officer, sandboxId, false, "go live after the trial"))).toBe(
      "IPB-SEC-005",
    );
    expect(await err(sandboxes.request(admin, sandboxId, false, "short"))).toMatch(/reason/);
    expect(await seen(member(sandboxId))).toBe(true);
  });

  it("changes under maker-checker: a PLT_SUPER_ADMIN maker, a different approver, applied once (#115)", async () => {
    const before = audit.entries.length;
    const { requestId } = await sandboxes.request(
      admin,
      sandboxId,
      false,
      "go live after the trial",
    );
    // Nothing changes until it is approved and applied.
    expect(await seen(member(sandboxId))).toBe(true);
    expect(await err(sandboxes.apply(admin, sandboxId, requestId))).toMatch(/pending/);
    // The maker cannot approve; neither can the tenant, in its own context.
    expect(await err(sandboxes.decide(admin, sandboxId, requestId, "approve"))).toBe("IPB-SEC-007");
    expect(await err(sandboxes.decide(member(sandboxId), sandboxId, requestId, "approve"))).toBe(
      "IPB-SEC-005",
    );
    expect(
      await sandboxes.decide(officer, sandboxId, requestId, "approve", "trial ended"),
    ).toMatchObject({
      state: "approved",
    });
    // An approver alone cannot apply; the maker (or another PLT_SUPER_ADMIN) applies it once.
    expect(await err(sandboxes.apply(officer, sandboxId, requestId))).toBe("IPB-SEC-005");
    expect(await err(sandboxes.apply(admin, liveId, requestId))).toMatch(/not found/i);
    expect(await sandboxes.apply(admin2, sandboxId, requestId)).toEqual({ changed: true });
    expect(await err(sandboxes.apply(admin, sandboxId, requestId))).toMatch(/executed/);
    expect(await seen(member(sandboxId))).toBe(false);
    expect(await sandboxes.get(admin, sandboxId)).toBe(false);
    const set = audit.entries.slice(before).filter((e) => e.action === TENANT_SANDBOX_SET_ACTION);
    expect(set).toHaveLength(1);
    expect(set[0]).toMatchObject({
      tenantId: sandboxId,
      before: { sandbox: true },
      after: {
        sandbox: false,
        changed: true,
        reason: "go live after the trial",
        approval_request_id: requestId,
      },
    });
    expect(audit.entries.slice(before).map((e) => e.action)).toEqual(
      expect.arrayContaining([
        "approvals.request.create",
        "approvals.request.approve",
        "approvals.request.consume",
        "approvals.request.execute",
      ]),
    );
    // A rejected request can never be applied.
    const back = await sandboxes.request(
      admin,
      sandboxId,
      true,
      "back to the sandbox for a rehearsal",
    );
    await sandboxes.decide(officer, sandboxId, back.requestId, "reject", "not now");
    expect(await err(sandboxes.apply(admin, sandboxId, back.requestId))).toMatch(/rejected/);
    expect(await seen(member(sandboxId))).toBe(false);
    expect(
      await err(sandboxes.request(admin, "tnt_missing", true, "a tenant that is not there")),
    ).toMatch(/not found|tenant/i);
  });
});

describe("#118 the risk class of a sandbox change", () => {
  it("is R4 (a 60-minute delay) in a production deployment or when unknown, R3 elsewhere", async () => {
    const { sandboxChangeRisk } = await import("./sandbox.js");
    expect(sandboxChangeRisk("prod")).toBe("R4");
    expect(sandboxChangeRisk("dr")).toBe("R4");
    expect(sandboxChangeRisk("pre-prod")).toBe("R4");
    expect(sandboxChangeRisk(undefined)).toBe("R4");
    expect(sandboxChangeRisk("staging")).toBe("R3");
    expect(sandboxChangeRisk("local")).toBe("R3");
  });

  it("cannot be applied in production before its delay has passed", async () => {
    const prod = new TenantSandbox({
      kernel,
      audit,
      approvals: new ApprovalsEngine({ kernel, audit, product: "LDC" }),
      appEnv: "prod",
    });
    const { requestId } = await prod.request(admin, liveId, true, "rehearse in a sandbox copy");
    await prod.decide(officer, liveId, requestId, "approve", "ok");
    expect(await err(prod.apply(admin, liveId, requestId))).toBe("IPB-SEC-008");
    expect(await seen(member(liveId))).toBe(false);
  });
});
