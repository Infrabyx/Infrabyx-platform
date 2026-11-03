// Named officer functions per legal entity (Finbyx PR-FBX-31; R1-D-46; tenancy/0013, 0014): a
// function under OFFICER_POLICY is held for one entity and one register row, by one person at a
// time (also a unique index), counts only in its entity, and ends only through an approved request.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuditEntryInput, AuditSink, KernelContext, Tx } from "@infrabyx/contracts/kernel";
import { newId } from "@infrabyx/crypto";
import { ApprovalsEngine } from "./approvals/engine.js";
import { FUNCTION_REVOKE_ACTION, OFFICER_POLICY, TenantFunctions } from "./functions.js";
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
let engine: ApprovalsEngine;
let fns: TenantFunctions;
const audit = new RecordingAudit();
const OWNER = newId("usr");
const ADMIN = newId("usr");
const ANA = newId("usr"); // member of ent_1
const BEN = newId("usr"); // member of ent_2 only
const user = (id: string, roles: string[], entityId?: string): KernelContext => ({
  tenantId: "tnt_a",
  ...(entityId ? { entityId } : {}),
  principal: { id, type: "user", roles },
});
const err = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { code?: string; message?: string }) => e.code ?? e.message,
  );
const owner = () => user(OWNER, ["ORG_OWNER"]);
const admin = () => user(ADMIN, ["ORG_ADMIN"]);

beforeAll(async () => {
  db = await freshDb();
  const kernel = new PgKernel({ pool: db.pool });
  await db.admin.query(
    "insert into tenancy.tenant (id, product, name) values ('tnt_a', 'FBX', 'A')",
  );
  const members: Array<[string, string[]]> = [
    [OWNER, []],
    [ADMIN, []],
    [ANA, ["ent_1"]],
    [BEN, ["ent_2"]],
  ];
  for (const [id, entities] of members) {
    await db.admin.query("insert into tenancy.user (id, idp_subject) values ($1, $1)", [id]);
    await db.admin.query(
      "insert into tenancy.membership (tenant_id, user_id, entity_ids) values ('tnt_a', $1, $2)",
      [id, entities],
    );
  }
  engine = new ApprovalsEngine({ kernel, audit, product: "FBX" });
  fns = new TenantFunctions({
    kernel,
    audit,
    approvals: engine,
    policies: { "FN:CCO": OFFICER_POLICY, "FN:COMPLIANCE_OFFICER": OFFICER_POLICY },
  }).register();
});
afterAll(async () => {
  await db?.end();
});

async function assign(userId: string, fn: string, entityRef: string, registerRef: string) {
  const r = await fns.requestAssign(owner(), {
    userId,
    function: fn,
    reason: "Board resolution 14/2026",
    entityRef,
    registerRef,
  });
  return engine.decide(admin(), r.requestId, "approve");
}

describe("officer functions per legal entity (PR-FBX-31)", () => {
  it("needs the entity and the register row, and only where the policy says so", async () => {
    const base = { userId: ANA, function: "FN:CCO", reason: "Board resolution 14/2026" };
    expect(await err(fns.requestAssign(owner(), base))).toMatch(/per legal entity/);
    expect(await err(fns.requestAssign(owner(), { ...base, entityRef: "ent_1" }))).toMatch(
      /officer-register row/,
    );
    expect(
      await err(fns.requestAssign(owner(), { ...base, function: "FN:CRO", entityRef: "ent_1" })),
    ).toMatch(/tenant-wide/);
    expect(
      await err(
        fns.requestAssign(owner(), {
          ...base,
          userId: BEN,
          entityRef: "ent_1",
          registerRef: "eo_1",
        }),
      ),
    ).toMatch(/not a member of that entity/);
    expect(() => new TenantFunctions({ ...fnsDeps(), policies: { "FN:CEO": {} } })).toThrow(
      /unknown function/,
    );
  });

  it("assigns one holder per entity, counted only in that entity", async () => {
    expect((await assign(ANA, "FN:CCO", "ent_1", "org.entity_officer/eo_1")).state).toBe(
      "executed",
    );
    const [a] = await fns.assignments(owner());
    expect(a).toEqual(
      expect.objectContaining({
        userId: ANA,
        function: "FN:CCO",
        entityRef: "ent_1",
        registerRef: "org.entity_officer/eo_1",
        singleHolder: true,
      }),
    );
    expect((await fns.withFunctions(user(ANA, ["ORG_CHECKER"], "ent_1"))).principal.roles).toEqual([
      "ORG_CHECKER",
      "FN:CCO",
    ]);
    expect((await fns.withFunctions(user(ANA, ["ORG_CHECKER"], "ent_2"))).principal.roles).toEqual([
      "ORG_CHECKER",
    ]);
    expect(await fns.authzAttributes(user(ANA, ["ORG_CHECKER"]))).toEqual({
      functions: { "FN:CCO": ["ent_1"] },
    });

    // A second CCO for ent_1 is refused, before the request and again at the database.
    await db.admin.query("update tenancy.membership set entity_ids = '{}' where user_id = $1", [
      BEN,
    ]);
    expect(
      await err(
        fns.requestAssign(owner(), {
          userId: BEN,
          function: "FN:CCO",
          reason: "Board resolution 15/2026",
          entityRef: "ent_1",
          registerRef: "eo_2",
        }),
      ),
    ).toMatch(/already has a holder for ent_1/);
    await expect(
      db.admin.query(
        `insert into tenancy.function_assignment
           (id, tenant_id, user_id, function, request_id, maker_id, approved_by, reason,
            entity_ref, single_holder)
         values ($1, 'tnt_a', $2, 'FN:CCO', 'apr_x', $3, $4, 'direct write', 'ent_1', true)`,
        [newId("fna"), BEN, OWNER, ADMIN],
      ),
    ).rejects.toThrow(/function_assignment_single_idx/);
    // Another entity has its own holder.
    expect((await assign(BEN, "FN:CCO", "ent_2", "eo_3")).state).toBe("executed");
    await expect(
      db.admin.query("update tenancy.function_assignment set entity_ref = 'ent_9' where id = $1", [
        a!.id,
      ]),
    ).rejects.toThrow(/only the revocation/);
  });

  it("ends only through an approved request", async () => {
    const [a] = (await fns.assignments(owner())).filter((x) => x.userId === ANA);
    expect(await err(fns.revoke(admin(), a!.id, "resigned 1 Nov"))).toBe("IPB-SEC-006");
    const r = await fns.requestRevoke(owner(), a!.id, "resigned 1 Nov");
    expect(await err(engine.decide(owner(), r.requestId, "approve"))).toBe("IPB-SEC-007");
    expect((await engine.decide(admin(), r.requestId, "approve")).state).toBe("executed");
    const row = await db.admin.query(
      "select revoked_by, revoke_request_id from tenancy.function_assignment where id = $1",
      [a!.id],
    );
    expect(row.rows[0]).toEqual({ revoked_by: ADMIN, revoke_request_id: r.requestId });
    expect((await fns.withFunctions(user(ANA, [], "ent_1"))).principal.roles).toEqual([]);
    // The entity's seat is free again.
    expect((await assign(ANA, "FN:CCO", "ent_1", "eo_4")).state).toBe("executed");
    expect(audit.entries.map((e) => e.action)).toContain("tenancy.function.revoke");
    expect(FUNCTION_REVOKE_ACTION).toBe("tenancy.function.revoke");
  });
});

function fnsDeps() {
  return { kernel: new PgKernel({ pool: db.pool }), audit, approvals: engine };
}
