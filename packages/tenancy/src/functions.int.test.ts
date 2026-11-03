// Named tenant functions (Finbyx PR-FBX-20; R1-D-39; tenancy/0011): assigned only through an
// approved request, never approved by the assignee, revoked at once, carried in the session's
// roles, and required of a checker by an action's policy or the tenant's `mc.checker_roles`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuditEntryInput, AuditSink, KernelContext, Tx } from "@infrabyx/contracts/kernel";
import { newId } from "@infrabyx/crypto";
import { ApprovalsEngine } from "./approvals/engine.js";
import { FUNCTION_ASSIGN_ACTION, TenantFunctions } from "./functions.js";
import { PgKernel } from "./kernel.js";
import { freshDb, type TestDb } from "./__tests__/pg.js";

class RecordingAudit implements AuditSink {
  readonly entries: AuditEntryInput[] = [];
  async record(tx: Tx, e: AuditEntryInput): Promise<{ id: string }> {
    this.entries.push(e);
    tx.markAudited();
    return { id: "led_x" };
  }
}

let db: TestDb;
let kernel: PgKernel;
let engine: ApprovalsEngine;
let fns: TenantFunctions;
const audit = new RecordingAudit();
const OWNER = newId("usr");
const ADMIN = newId("usr");
const CRO = newId("usr");
const MAKER = newId("usr");
let tenantRoles: string[] | null = null;
const user = (id: string, roles: string[], tenantId = "tnt_a"): KernelContext => ({
  tenantId,
  principal: { id, type: "user", roles },
});
const err = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { code?: string; message?: string }) => e.code ?? e.message,
  );

beforeAll(async () => {
  db = await freshDb();
  kernel = new PgKernel({ pool: db.pool });
  await db.admin.query(
    "insert into tenancy.tenant (id, product, name) values ('tnt_a', 'FBX', 'A'), ('tnt_b', 'FBX', 'B')",
  );
  for (const id of [OWNER, ADMIN, CRO, MAKER]) {
    await db.admin.query("insert into tenancy.user (id, idp_subject) values ($1, $1)", [id]);
    await db.admin.query(
      "insert into tenancy.membership (tenant_id, user_id) values ('tnt_a', $1)",
      [id],
    );
  }
  engine = new ApprovalsEngine({
    kernel,
    audit,
    product: "FBX",
    tenantPolicy: async () => ({ checkerRoles: tenantRoles }),
  });
  fns = new TenantFunctions({
    kernel,
    audit,
    approvals: engine,
    functions: ["FN:PRINCIPAL_OFFICER"],
  }).register();
  engine.register("fbx.product.vet", {
    checkerRoles: ["ORG_CHECKER", "ORG_ADMIN"],
    checkerFunctions: ["FN:CRO"],
    execute: async () => undefined,
  });
  engine.register("fbx.product.approve", { execute: async () => undefined });
});
afterAll(async () => {
  await db?.end();
});

describe("named tenant functions (PR-FBX-20)", () => {
  it("assigns only after a different manager approves, and never by the assignee's own approval", async () => {
    expect(fns.list()).toEqual([
      "FN:CRO",
      "FN:CCO",
      "FN:COMPLIANCE_OFFICER",
      "FN:PRINCIPAL_OFFICER",
    ]);
    expect(
      await err(
        fns.requestAssign(user(MAKER, ["ORG_MAKER"]), {
          userId: CRO,
          function: "FN:CRO",
          reason: "board",
        }),
      ),
    ).toBe("IPB-UX-011");
    expect(
      await err(
        fns.requestAssign(user(OWNER, ["ORG_OWNER"]), {
          userId: CRO,
          function: "FN:CEO",
          reason: "board",
        }),
      ),
    ).toMatch(/unknown function/);
    // The assignee is an ORG_ADMIN and tries to approve their own assignment.
    const own = await fns.requestAssign(user(OWNER, ["ORG_OWNER"]), {
      userId: ADMIN,
      function: "FN:CCO",
      reason: "Board resolution 12/2026",
    });
    expect(await err(engine.decide(user(ADMIN, ["ORG_ADMIN"]), own.requestId, "approve"))).toBe(
      "IPB-SEC-006",
    );
    expect(await err(engine.decide(user(OWNER, ["ORG_OWNER"]), own.requestId, "approve"))).toBe(
      "IPB-SEC-007",
    );
    expect(await fns.assignments(user(OWNER, ["ORG_OWNER"]))).toHaveLength(0);

    const r = await fns.requestAssign(user(OWNER, ["ORG_OWNER"]), {
      userId: CRO,
      function: "FN:CRO",
      reason: "Board resolution 12/2026",
    });
    expect(await err(engine.decide(user(MAKER, ["ORG_CHECKER"]), r.requestId, "approve"))).toBe(
      "IPB-UX-011",
    );
    const done = await engine.decide(user(ADMIN, ["ORG_ADMIN"]), r.requestId, "approve");
    expect(done.state).toBe("executed");
    const list = await fns.assignments(user(OWNER, ["ORG_OWNER"]));
    expect(list).toEqual([
      expect.objectContaining({
        userId: CRO,
        function: "FN:CRO",
        makerId: OWNER,
        approvedBy: ADMIN,
      }),
    ]);
    expect(await fns.assignments(user(OWNER, ["ORG_OWNER"], "tnt_b"))).toHaveLength(0);
    expect(
      await err(
        fns.requestAssign(user(OWNER, ["ORG_OWNER"]), {
          userId: CRO,
          function: "FN:CRO",
          reason: "again",
        }),
      ),
    ).toMatch(/already holds/);
    expect(audit.entries.map((e) => e.action)).toContain("tenancy.function.assign");
    await expect(
      db.admin.query("delete from tenancy.function_assignment where id = $1", [list[0]!.id]),
    ).rejects.toThrow(/revoke it instead/);
    await expect(
      db.admin.query("update tenancy.function_assignment set function = 'FN:CCO' where id = $1", [
        list[0]!.id,
      ]),
    ).rejects.toThrow(/only the revocation/);
  });

  it("carries the function in the session, never one the token claimed", async () => {
    const ctx = await fns.withFunctions(user(CRO, ["ORG_CHECKER", "FN:CCO"]));
    expect(ctx.principal.roles).toEqual(["ORG_CHECKER", "FN:CRO"]);
    expect(
      (await fns.withFunctions(user(MAKER, ["ORG_CHECKER", "FN:CRO"]))).principal.roles,
    ).toEqual(["ORG_CHECKER"]);
  });

  it("requires the function of a checker: by the action's policy, or by the tenant's FN: entries", async () => {
    const vet = await kernel.mutate(user(MAKER, ["ORG_MAKER"]), (tx) =>
      engine.request(tx, { action: "fbx.product.vet", riskClass: "R2", payload: { p: 1 } }),
    );
    expect(await err(engine.decide(user(ADMIN, ["ORG_ADMIN"]), vet.id, "approve"))).toBe(
      "IPB-UX-011",
    );
    const cro = await fns.withFunctions(user(CRO, ["ORG_CHECKER"]));
    expect((await engine.decide(cro, vet.id, "approve")).state).toBe("executed");

    tenantRoles = ["ORG_CHECKER", "ORG_ADMIN", "FN:CCO"];
    expect(await engine.checkerRolesFor(user(MAKER, ["ORG_MAKER"]), "fbx.product.approve")).toEqual(
      ["ORG_CHECKER", "ORG_ADMIN"],
    );
    expect(
      await engine.checkerFunctionsFor(user(MAKER, ["ORG_MAKER"]), "fbx.product.approve"),
    ).toEqual(["FN:CCO"]);
    // The tenant may only narrow an action's own functions, never swap them.
    expect(await engine.checkerFunctionsFor(user(MAKER, ["ORG_MAKER"]), "fbx.product.vet")).toEqual(
      ["FN:CRO"],
    );
    const appr = await kernel.mutate(user(MAKER, ["ORG_MAKER"]), (tx) =>
      engine.request(tx, { action: "fbx.product.approve", riskClass: "R2", payload: { p: 2 } }),
    );
    expect(await err(engine.decide(cro, appr.id, "approve"))).toBe("IPB-UX-011");
    tenantRoles = null;
  });

  it("revokes at once, and the function leaves the session", async () => {
    const [a] = await fns.assignments(user(OWNER, ["ORG_OWNER"]));
    expect(await err(fns.revoke(user(MAKER, ["ORG_MAKER"]), a!.id, "left the company"))).toBe(
      "IPB-UX-011",
    );
    await fns.revoke(user(ADMIN, ["ORG_ADMIN"]), a!.id, "left the company");
    expect(await err(fns.revoke(user(ADMIN, ["ORG_ADMIN"]), a!.id, "left the company"))).toMatch(
      /not found|active function/i,
    );
    expect((await fns.withFunctions(user(CRO, ["ORG_CHECKER"]))).principal.roles).toEqual([
      "ORG_CHECKER",
    ]);
    expect(await fns.assignments(user(OWNER, ["ORG_OWNER"]), { all: true })).toHaveLength(1);
    expect(FUNCTION_ASSIGN_ACTION).toBe("tenancy.function.assign");
  });
});
