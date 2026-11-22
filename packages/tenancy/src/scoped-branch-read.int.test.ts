// Contract tests for Finbyx PR-FBX-54 (R1-D-273): inside a mutation, an approval executor (or a
// capability named when the kernel is built) runs a read-only unit under a derived context whose
// branch scope is exactly the named branches, each granted to the caller (closed ones through
// `branchGrants`). The owner's four: a named branch is read, an unnamed one is not, a write is
// refused, the ledger row exists. The test ledger mirrors `audit.ledger`'s insert policy: a row
// names the tenant and actor of the settings it is written under.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AuditEntryInput, AuditSink, KernelContext, Tx } from "@infrabyx/contracts/kernel";
import { LocalKms, localTenantKeyId } from "@infrabyx/crypto";
import { ApprovalsEngine, type ApprovalExecutorKernel } from "./approvals/index.js";
import { KernelGuardError } from "./errors.js";
import { FieldCrypto } from "./field-crypto.js";
import {
  PgKernel,
  SCOPED_BRANCH_READ_ACTION,
  SCOPED_BRANCH_READ_REFUSED_ACTION,
  type ScopedBranchReadCapability,
  type ScopedBranchReadOptions,
} from "./kernel.js";
import { freshDb, type TestDb } from "./__tests__/pg.js";

/** Writes `t.ledger` as `PgAuditSink` writes `audit.ledger`: tenant and actor from `tx.ctx`. */
class TableAudit implements AuditSink {
  async record(tx: Tx, e: AuditEntryInput): Promise<{ id: string }> {
    await tx.query(
      `insert into t.ledger (tenant_id, actor_id, action, resource_type, resource_id, after, business_ids)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
      [
        tx.ctx.tenantId,
        tx.ctx.principal.id,
        e.action,
        e.resourceType,
        e.resourceId,
        e.after === undefined ? null : JSON.stringify(e.after),
        e.businessIds ?? null,
      ],
    );
    tx.markAudited();
    return { id: "led_x" };
  }
}

interface LedgerRow {
  actor_id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  after: Record<string, unknown> | null;
  business_ids: string[] | null;
}

let db: TestDb;
let kernel: PgKernel;
let engine: ApprovalsEngine;
let reconcile: ScopedBranchReadCapability;
const audit = new TableAudit();
const ACTION = "fbx.month.lock";
/** What the month-lock executor does in the current test. */
let onExecute: (tx: Tx, k: ApprovalExecutorKernel) => Promise<void> = async () => undefined;

const user = (id: string, roles: string[], over: Partial<KernelContext> = {}): KernelContext => ({
  tenantId: "tnt_a",
  principal: { id, type: "user", roles },
  ...over,
});
const MAKER = user("usr_maker", ["ORG_MAKER"], { branchId: "br_north", branchIds: ["br_north"] });
/** Granted br_north and the closed br_closed (t.branch_grant); his context lists br_north only. */
const CHECKER = user("usr_checker", ["ORG_CHECKER"], {
  branchId: "br_north",
  branchIds: ["br_north"],
});

const ids = (tx: Tx) =>
  tx
    .query<{ id: string }>("select id from loans.account order by id")
    .then((r) => r.rows.map((x) => x.id));
const reasonFor = "month-lock reconciliation 2026-10";

/** Raise a month-lock request and approve it: the executor runs in the checker's mutation. */
async function lockMonth(): Promise<{ id: string; state: string }> {
  const { id } = await kernel.mutate(
    MAKER,
    (tx) => engine.request(tx, { action: ACTION, riskClass: "R2", payload: { month: "2026-10" } }),
    { action: "fbx.month.request" },
  );
  try {
    const r = await engine.decide(CHECKER, id, "approve");
    return { id, state: r.state };
  } catch (e) {
    Object.assign(e as object, { requestId: id });
    throw e;
  }
}

const ledger = async (resourceId: string, action?: string): Promise<LedgerRow[]> =>
  (
    await db.admin.query<LedgerRow>(
      `select actor_id, action, resource_type, resource_id, after, business_ids from t.ledger
        where resource_id = $1 and action <> 'approvals.request.create'
          ${action ? "and action = $2" : ""} order by id`,
      action ? [resourceId, action] : [resourceId],
    )
  ).rows;

const failure = (p: Promise<unknown>) =>
  p.then(
    () => {
      throw new Error("expected a rejection");
    },
    (e: Error & { code?: string; meta?: { refusal?: string }; requestId?: string }) => e,
  );

beforeAll(async () => {
  db = await freshDb();
  kernel = new PgKernel({
    pool: db.pool,
    audit,
    readRole: "app_ro",
    // Every branch the principal holds a grant on, open or closed (the product's table).
    branchGrants: async (tx) =>
      (
        await tx.query<{ branch_id: string }>(
          "select branch_id from t.branch_grant where user_id = $1",
          [tx.ctx.principal.id],
        )
      ).rows.map((r) => r.branch_id),
    scopedBranchReadCapabilities: ["fbx.reconcile", "fbx.spare"],
  });
  reconcile = kernel.scopedBranchReadCapability("fbx.reconcile");
  engine = new ApprovalsEngine({
    kernel,
    audit,
    product: "FBX",
    fieldCrypto: new FieldCrypto({ kms: new LocalKms(), keyIdFor: localTenantKeyId }),
  });
  engine.register(ACTION, {
    checkerRoles: ["ORG_CHECKER"],
    execute: async (tx, _payload, _request, k) => onExecute(tx, k),
  });
  await db.admin.query(`
    insert into tenancy.tenant (id, product, name) values ('tnt_a', 'FBX', 'A'), ('tnt_b', 'FBX', 'B');
    create schema loans;
    grant usage on schema loans to app_rw, app_ro;
    create table loans.account (id text primary key, tenant_id text not null, branch_id text);
    alter table loans.account enable row level security;
    alter table loans.account force row level security;
    create policy account_tenant_branch on loans.account for all
      using (tenant_id = current_setting('app.tenant_id', true) and tenancy.branch_allowed(branch_id))
      with check (tenant_id = current_setting('app.tenant_id', true) and tenancy.branch_allowed(branch_id));
    grant select, insert, update, delete on loans.account to app_rw;
    grant select on loans.account to app_ro;
    insert into loans.account values ('a1', 'tnt_a', 'br_north'), ('a2', 'tnt_a', 'br_south'),
      ('a3', 'tnt_a', 'br_closed'), ('a4', 'tnt_a', null), ('b1', 'tnt_b', 'br_closed');
    create schema t;
    grant usage on schema t to app_rw, app_ro;
    create table t.ledger (id serial primary key, tenant_id text not null, actor_id text not null,
      action text not null, resource_type text not null, resource_id text not null, after jsonb,
      business_ids text[]);
    alter table t.ledger enable row level security;
    alter table t.ledger force row level security;
    create policy ledger_settings on t.ledger for all
      using (tenant_id = current_setting('app.tenant_id', true))
      with check (tenant_id = current_setting('app.tenant_id', true)
                  and actor_id = current_setting('app.actor_id', true));
    grant select, insert on t.ledger to app_rw;
    grant usage on sequence t.ledger_id_seq to app_rw;
    create table t.branch_grant (tenant_id text not null, user_id text not null, branch_id text not null);
    alter table t.branch_grant enable row level security;
    alter table t.branch_grant force row level security;
    create policy grant_tenant on t.branch_grant for all
      using (tenant_id = current_setting('app.tenant_id', true));
    grant select on t.branch_grant to app_rw, app_ro;
    insert into t.branch_grant values ('tnt_a', 'usr_checker', 'br_north'),
      ('tnt_a', 'usr_checker', 'br_closed'), ('tnt_b', 'usr_checker', 'br_south');
  `);
});
afterAll(async () => db?.end());
beforeEach(() => {
  onExecute = async () => undefined;
});

describe("@IPB-02-12 PR-FBX-54 the owner's contract tests (R1-D-273)", () => {
  it("a named branch is read and an unnamed one is not, under kernel-set settings that end with the read", async () => {
    const seen: string[][] = [];
    let inside: Record<string, string> = {};
    let after: Record<string, string> = {};
    const settings = (tx: Tx) =>
      tx
        .query<Record<string, string>>(
          `select current_setting('app.branch_scope') as scope, current_setting('app.branch_ids') as ids,
                  current_setting('app.branch_id') as branch, current_setting('app.actor_id') as actor,
                  current_user as role, current_setting('transaction_read_only') as ro`,
        )
        .then((r) => r.rows[0]!);
    onExecute = async (tx, k) => {
      // Widened to the closed branch and narrowed away from the checker's own br_north.
      seen.push(
        await k.scopedBranchRead({ branchIds: ["br_closed"], reason: reasonFor }, async (r) => {
          inside = await settings(r);
          return ids(r);
        }),
      );
      seen.push(
        await k.scopedBranchRead({ branchIds: ["br_north", "br_closed"], reason: reasonFor }, ids),
      );
      after = await settings(tx);
      seen.push(await ids(tx));
    };
    const { state } = await lockMonth();
    expect(state).toBe("executed");
    // br_closed only, then both named; never br_south, a branchless row or another tenant's row.
    expect(seen).toEqual([["a3"], ["a1", "a3"], ["a1"]]);
    expect(inside).toEqual({
      scope: "listed",
      ids: "br_closed",
      branch: "",
      actor: "usr_checker",
      role: "app_ro",
      ro: "on",
    });
    expect(after).toEqual({
      scope: "listed",
      ids: "br_north",
      branch: "br_north",
      actor: "usr_checker",
      role: "app_rw",
      ro: "off",
    });
  });

  it("the ledger row exists, in the mutation's transaction, naming the request, the branches and the reason", async () => {
    onExecute = async (_tx, k) =>
      void (await k.scopedBranchRead({ branchIds: ["br_closed"], reason: reasonFor }, ids));
    const { id } = await lockMonth();
    const rows = await ledger(id);
    expect(rows.map((r) => r.action)).toEqual([
      "approvals.request.approve",
      SCOPED_BRANCH_READ_ACTION,
      "approvals.request.execute",
    ]);
    expect(rows[1]).toEqual({
      actor_id: "usr_checker",
      action: SCOPED_BRANCH_READ_ACTION,
      resource_type: "approval_request",
      resource_id: id,
      after: {
        reason: reasonFor,
        branch_ids: ["br_closed"],
        tenant_id: "tnt_a",
        approval_request_id: id,
        approval_action: ACTION,
      },
      business_ids: [id],
    });
  });

  it("the ledger row is gone when the mutation rolls back", async () => {
    onExecute = async (_tx, k) => {
      await k.scopedBranchRead({ branchIds: ["br_closed"], reason: reasonFor }, ids);
      throw new Error("the month cannot be locked");
    };
    const e = await failure(lockMonth());
    expect(e.message).toBe("the month cannot be locked");
    expect(await ledger(e.requestId!, SCOPED_BRANCH_READ_ACTION)).toEqual([]);
    const state = await db.admin.query<{ state: string }>(
      "select state from tenancy.approval_request where id = $1",
      [e.requestId],
    );
    expect(state.rows[0]!.state).toBe("pending");
  });

  it("a write inside is refused and undone; the executor may carry on, and the mutation commits", async () => {
    const errors: Array<{ code?: string; message: string }> = [];
    onExecute = async (_tx, k) => {
      for (const sql of [
        "insert into loans.account values ('x1', 'tnt_a', 'br_closed')",
        "update loans.account set branch_id = 'br_north' where id = 'a3'",
        "delete from loans.account where id = 'a3'",
        "create table loans.evil (id int)",
        "set local transaction_read_only = off",
      ])
        errors.push(
          await failure(
            k.scopedBranchRead({ branchIds: ["br_closed"], reason: reasonFor }, (r) =>
              r.query(sql),
            ),
          ),
        );
    };
    const { id, state } = await lockMonth();
    expect(state).toBe("executed");
    expect(errors.slice(0, 4).map((e) => e.code)).toEqual(["25006", "25006", "25006", "25006"]);
    expect(errors[4]!.message).toMatch(/read-write mode inside a read-only transaction/);
    const rows = await db.admin.query<{ id: string; branch_id: string }>(
      "select id, branch_id from loans.account where id in ('x1', 'a3')",
    );
    expect(rows.rows).toEqual([{ id: "a3", branch_id: "br_closed" }]);
    expect(await ledger(id, SCOPED_BRANCH_READ_ACTION)).toHaveLength(5);
  });

  it("an uncaught write refusal fails the whole mutation", async () => {
    onExecute = async (_tx, k) =>
      void (await k.scopedBranchRead({ branchIds: ["br_closed"], reason: reasonFor }, (r) =>
        r.query("insert into loans.account values ('x2', 'tnt_a', 'br_closed')"),
      ));
    const e = await failure(lockMonth());
    expect(e.code).toBe("25006");
    expect(await ledger(e.requestId!, SCOPED_BRANCH_READ_ACTION)).toEqual([]);
  });
});

describe("@IPB-02-12 PR-FBX-54 grants and refusals (R1-D-273)", () => {
  it("an ungranted branch refuses the whole call (IPB-SEC-005), ledgered after the transaction although it rolled back", async () => {
    onExecute = async (_tx, k) =>
      void (await k.scopedBranchRead(
        { branchIds: ["br_north", "br_south"], reason: reasonFor },
        ids,
      ));
    const e = await failure(lockMonth());
    expect(e.code).toBe("IPB-SEC-005");
    expect(e.meta).toEqual({ refusal: "ungranted" });
    const rows = await ledger(e.requestId!);
    expect(rows.map((r) => r.action)).toEqual([SCOPED_BRANCH_READ_REFUSED_ACTION]);
    expect(rows[0]).toMatchObject({
      actor_id: "usr_checker",
      resource_type: "approval_request",
      after: {
        refusal: "ungranted",
        branch_ids: ["br_north", "br_south"],
        ungranted: ["br_south"],
        approval_request_id: e.requestId,
      },
      business_ids: [e.requestId],
    });
  });

  it("a refusal the executor catches is ledgered too, and the mutation commits", async () => {
    let caught: { code?: string } | undefined;
    onExecute = async (_tx, k) => {
      caught = await failure(
        k.scopedBranchRead({ branchIds: ["br_south"], reason: reasonFor }, ids),
      );
    };
    const { id, state } = await lockMonth();
    expect(state).toBe("executed");
    expect(caught?.code).toBe("IPB-SEC-005");
    expect((await ledger(id)).map((r) => r.action)).toEqual([
      "approvals.request.approve",
      "approvals.request.execute",
      SCOPED_BRANCH_READ_REFUSED_ACTION,
    ]);
  });

  it("malformed, duplicate, empty and over-long lists, and a missing or bad reason, are refused with a fixed label", async () => {
    const refusals: Array<string | undefined> = [];
    const bad: Array<{ branchIds: unknown; reason: unknown }> = [
      { branchIds: [], reason: reasonFor },
      { branchIds: Array.from({ length: 1001 }, (_, i) => `br_${i}`), reason: reasonFor },
      { branchIds: ["br_north,br_south"], reason: reasonFor },
      { branchIds: ["br_closed", "br_closed"], reason: reasonFor },
      { branchIds: "br_closed", reason: reasonFor },
      { branchIds: [7], reason: reasonFor },
      { branchIds: ["br_closed"], reason: "" },
      { branchIds: ["br_closed"], reason: "   " },
      { branchIds: ["br_closed"], reason: "x".repeat(501) },
      { branchIds: ["br_closed"], reason: "two\nlines" },
      { branchIds: ["br_closed"], reason: undefined },
    ];
    onExecute = async (_tx, k) => {
      for (const b of bad)
        refusals.push(
          (await failure(k.scopedBranchRead(b as unknown as ScopedBranchReadOptions, ids))).meta
            ?.refusal,
        );
      // At the bounds: 1000 granted-or-not ids are checked against the grants, 500 characters pass.
      refusals.push(
        (
          await failure(
            k.scopedBranchRead(
              { branchIds: Array.from({ length: 1000 }, (_, i) => `br_${i}`), reason: reasonFor },
              ids,
            ),
          )
        ).meta?.refusal,
      );
      await k.scopedBranchRead({ branchIds: ["br_closed"], reason: "y".repeat(500) }, ids);
    };
    const { id, state } = await lockMonth();
    expect(state).toBe("executed");
    expect(refusals).toEqual([
      ...Array(6).fill("branch_ids"),
      ...Array(5).fill("reason"),
      "ungranted",
    ]);
    const rows = await ledger(id);
    expect(rows.filter((r) => r.action === SCOPED_BRANCH_READ_REFUSED_ACTION)).toHaveLength(12);
    expect(rows.filter((r) => r.action === SCOPED_BRANCH_READ_ACTION)).toHaveLength(1);
  });

  it("a closed branch is readable only through the grant source; without one, the context's own branches are the grants", async () => {
    const plain = new PgKernel({
      pool: db.pool,
      audit,
      readRole: "app_ro",
      scopedBranchReadCapabilities: ["fbx.reconcile"],
    });
    const cap = plain.scopedBranchReadCapability("fbx.reconcile");
    const run = (ctx: KernelContext, branchIds: string[]) =>
      plain.mutate(
        ctx,
        async (tx) => {
          const r = await cap.scopedBranchRead(tx, { branchIds, reason: reasonFor }, ids);
          await audit.record(tx, { action: "fbx.check", resourceType: "check", resourceId: "c1" });
          return r;
        },
        { action: "fbx.check" },
      );
    // The checker's context lists br_north only: the closed branch is not his grant here.
    expect((await failure(run(CHECKER, ["br_closed"]))).meta).toEqual({ refusal: "ungranted" });
    expect(
      await run(user("usr_c2", ["ORG_USER"], { branchIds: ["br_north", "br_closed"] }), [
        "br_closed",
      ]),
    ).toEqual(["a3"]);
    expect(await run(user("usr_c3", ["ORG_USER"], { allBranches: true }), ["br_south"])).toEqual([
      "a2",
    ]);
  });

  it("an agent is refused: agents are makers only", async () => {
    const run = (ctx: KernelContext) =>
      kernel.mutate(
        ctx,
        async (tx) => {
          const e = await failure(
            reconcile.scopedBranchRead(tx, { branchIds: ["br_closed"], reason: reasonFor }, ids),
          );
          await audit.record(tx, { action: "fbx.check", resourceType: "check", resourceId: "c2" });
          return e;
        },
        { action: "fbx.check" },
      );
    const agent = await run({
      tenantId: "tnt_a",
      principal: { id: "agt_vidhi", type: "agent", roles: ["AGT_VIDHI"] },
      allBranches: true,
    });
    expect(agent.code).toBe("IPB-SEC-005");
    expect(agent.meta).toEqual({ refusal: "principal" });
  });

  it("a grant source answering something else fails closed", async () => {
    const odd = new PgKernel({
      pool: db.pool,
      audit,
      branchGrants: async () => ({ br_closed: true }) as unknown as string[],
      scopedBranchReadCapabilities: ["fbx.reconcile"],
    });
    const cap = odd.scopedBranchReadCapability("fbx.reconcile");
    const e = await failure(
      odd.mutate(CHECKER, (tx) =>
        cap.scopedBranchRead(tx, { branchIds: ["br_closed"], reason: reasonFor }, ids),
      ),
    );
    expect(e.meta).toEqual({ refusal: "grants" });
  });
});

describe("@IPB-02-12 PR-FBX-54 only an approval executor or a named capability (R1-D-273)", () => {
  it("an ordinary request's transaction has no way in", async () => {
    await kernel.mutate(
      CHECKER,
      async (tx) => {
        expect("scopedBranchRead" in tx).toBe(false);
        await audit.record(tx, { action: "fbx.check", resourceType: "check", resourceId: "c3" });
      },
      { action: "fbx.check" },
    );
    // The kernel's implementation is not a reachable member; only the capability factory is.
    expect((kernel as unknown as Record<string, unknown>).scopedBranchRead).toBeUndefined();
    expect(Object.getOwnPropertyNames(PgKernel.prototype).filter((n) => /scoped/i.test(n))).toEqual(
      ["scopedBranchReadCapability"],
    );
  });

  it("a capability runs only in a mutation its kernel opened, still open", async () => {
    const guard = /runs only inside a mutation this kernel opened/;
    // A read's transaction.
    await expect(
      kernel.read(CHECKER, (tx) =>
        reconcile.scopedBranchRead(tx, { branchIds: ["br_closed"], reason: reasonFor }, ids),
      ),
    ).rejects.toThrow(guard);
    // A forged handle.
    const forged: Tx = {
      ctx: CHECKER,
      query: () => Promise.resolve({ rows: [], rowCount: 0 }),
      markAudited: () => undefined,
      audited: false,
    };
    await expect(
      reconcile.scopedBranchRead(forged, { branchIds: ["br_closed"], reason: reasonFor }, ids),
    ).rejects.toThrow(guard);
    // Another kernel's mutation.
    const other = new PgKernel({ pool: db.pool, audit });
    await expect(
      other.mutate(CHECKER, (tx) =>
        reconcile.scopedBranchRead(tx, { branchIds: ["br_closed"], reason: reasonFor }, ids),
      ),
    ).rejects.toThrow(guard);
    // A mutation that has ended.
    let kept: Tx | undefined;
    await kernel.mutate(
      CHECKER,
      async (tx) => {
        kept = tx;
        await audit.record(tx, { action: "fbx.check", resourceType: "check", resourceId: "c4" });
      },
      { action: "fbx.check" },
    );
    await expect(
      reconcile.scopedBranchRead(kept!, { branchIds: ["br_closed"], reason: reasonFor }, ids),
    ).rejects.toThrow(guard);
  });

  it("the executor's access ends when the executor returns", async () => {
    let saved: ApprovalExecutorKernel | undefined;
    let savedTx: Tx | undefined;
    onExecute = async (tx, k) => {
      saved = k;
      savedTx = tx;
    };
    await lockMonth();
    expect(Object.isFrozen(saved)).toBe(true);
    const e = await failure(
      saved!.scopedBranchRead({ branchIds: ["br_closed"], reason: reasonFor }, ids),
    );
    expect(e).toBeInstanceOf(KernelGuardError);
    expect(e.message).toMatch(/executor has returned/);
    // Nor through the executing transaction with the capability of a later call.
    await expect(
      reconcile.scopedBranchRead(savedTx!, { branchIds: ["br_closed"], reason: reasonFor }, ids),
    ).rejects.toThrow(/runs only inside a mutation/);
  });

  it("a capability is declared when the kernel is built and issued once", () => {
    expect(() => kernel.scopedBranchReadCapability("fbx.reconcile")).toThrow(/already issued/);
    expect(() => kernel.scopedBranchReadCapability("fbx.other")).toThrow(/was declared/);
    expect(kernel.scopedBranchReadCapability("fbx.spare").name).toBe("fbx.spare");
    for (const bad of ["approvals.executor", "reconcile", "Fbx.reconcile", "fbx..x", "a.b.c.d.e"])
      expect(() => new PgKernel({ pool: db.pool, scopedBranchReadCapabilities: [bad] })).toThrow(
        RangeError,
      );
    expect(
      () => new PgKernel({ pool: db.pool, scopedBranchReadCapabilities: ["fbx.a", "fbx.a"] }),
    ).toThrow(/distinct/);
  });

  it("the read's ledger row does not satisfy the mutation's own ledger check", async () => {
    const reads = () => ledger("fbx.reconcile", SCOPED_BRANCH_READ_ACTION);
    const before = (await reads()).length;
    await expect(
      kernel.mutate(
        CHECKER,
        (tx) =>
          reconcile.scopedBranchRead(tx, { branchIds: ["br_closed"], reason: reasonFor }, ids),
        { action: "fbx.check" },
      ),
    ).rejects.toMatchObject({ code: "IPB-MOD-003" });
    expect(await reads()).toHaveLength(before);
    const got = await kernel.mutate(
      CHECKER,
      async (tx) => {
        const r = await reconcile.scopedBranchRead(
          tx,
          { branchIds: ["br_closed"], reason: reasonFor },
          ids,
        );
        await audit.record(tx, { action: "fbx.check", resourceType: "check", resourceId: "c5" });
        return r;
      },
      { action: "fbx.check" },
    );
    expect(got).toEqual(["a3"]);
    const after = await reads();
    expect(after).toHaveLength(before + 1);
    expect(after.at(-1)).toEqual({
      actor_id: "usr_checker",
      action: SCOPED_BRANCH_READ_ACTION,
      resource_type: "kernel_capability",
      resource_id: "fbx.reconcile",
      after: {
        reason: reasonFor,
        branch_ids: ["br_closed"],
        tenant_id: "tnt_a",
        capability: "fbx.reconcile",
      },
      business_ids: null,
    });
  });
});

describe("@IPB-02-12 PR-FBX-54 inside the unit (R1-D-273)", () => {
  it("no units, no nesting, no other statement on the mutation, and product code still cannot set app.*", async () => {
    const out: Record<string, string> = {};
    onExecute = async (tx, k) =>
      void (await k.scopedBranchRead({ branchIds: ["br_closed"], reason: reasonFor }, async (r) => {
        const msg = async (p: Promise<unknown>) => (await failure(p)).message;
        out.unit = await msg(r.unit!(async () => undefined));
        out.nested = await msg(
          k.scopedBranchRead({ branchIds: ["br_north"], reason: reasonFor }, ids),
        );
        out.outer = await msg(tx.query("select 1"));
        out.setConfig = await msg(r.query("select set_config('app.branch_scope', 'all', true)"));
        out.setLocal = await msg(r.query("set local app.branch_ids = 'br_south'"));
        out.role = await msg(r.query("set local role app_rw"));
        out.savepoint = await msg(r.query("savepoint x"));
        return ids(r);
      }));
    expect((await lockMonth()).state).toBe("executed");
    expect(out.unit).toMatch(/units are for mutations/);
    expect(out.nested).toMatch(/scoped branch read is open/);
    expect(out.outer).toMatch(/scoped branch read is open/);
    expect(out.setConfig).toMatch(/app\.\* settings are set by the kernel/);
    expect(out.setLocal).toMatch(/app\.\* settings are set by the kernel/);
    expect(out.role).toMatch(/role switch/);
    expect(out.savepoint).toMatch(/transaction control/);
  });

  it("a statement sent on the mutation while the read is open is refused, and one the callback leaves behind never runs", async () => {
    let late: Promise<string> | undefined;
    const [read, parallel] = await kernel.mutate(
      CHECKER,
      async (tx) => {
        const r = await Promise.allSettled([
          reconcile.scopedBranchRead(
            tx,
            { branchIds: ["br_closed"], reason: reasonFor },
            async (rt) => {
              await rt.query("select pg_sleep(0.1)");
              late = new Promise((res) => setTimeout(res, 20))
                .then(() => rt.query("select 1"))
                .then(
                  () => "ran",
                  (e: Error) => e.message,
                );
              return ids(rt);
            },
          ),
          new Promise((res) => setTimeout(res, 30)).then(() => tx.query("select 1")),
        ]);
        await audit.record(tx, { action: "fbx.check", resourceType: "check", resourceId: "c6" });
        return r;
      },
      { action: "fbx.check" },
    );
    expect(read).toEqual({ status: "fulfilled", value: ["a3"] });
    expect(parallel.status).toBe("rejected");
    expect(String((parallel as PromiseRejectedResult).reason)).toMatch(
      /scoped branch read is open/,
    );
    expect(await late).toMatch(/transaction has ended/);
  });

  it("works in an ambient mutation: the executor of a joined decide reads, and a queued call waits its turn", async () => {
    const { id } = await kernel.mutate(
      MAKER,
      (tx) =>
        engine.request(tx, { action: ACTION, riskClass: "R2", payload: { month: "2026-11" } }),
      { action: "fbx.month.request" },
    );
    let seen: string[] = [];
    onExecute = async (_tx, k) => {
      seen = await k.scopedBranchRead({ branchIds: ["br_closed"], reason: reasonFor }, ids);
    };
    const queued = await kernel.ambient(
      CHECKER,
      async (tx) => {
        const r = await engine.decide(CHECKER, id, "approve");
        expect(r.state).toBe("executed");
        // A capability call on the ambient transaction, with a joined mutation started beside it.
        const [read, joined] = await Promise.all([
          reconcile.scopedBranchRead(
            tx,
            { branchIds: ["br_closed"], reason: reasonFor },
            async (rt) => {
              await rt.query("select pg_sleep(0.05)");
              return ids(rt);
            },
          ),
          kernel.mutate(
            CHECKER,
            async (jtx) => {
              const rows = await ids(jtx);
              await audit.record(jtx, {
                action: "fbx.check",
                resourceType: "check",
                resourceId: "c7",
              });
              return rows;
            },
            { action: "fbx.check" },
          ),
        ]);
        await audit.record(tx, { action: "api.lock", resourceType: "x", resourceId: "x" });
        return { read, joined };
      },
      { action: "api.lock" },
    );
    expect(seen).toEqual(["a3"]);
    expect(queued).toEqual({ read: ["a3"], joined: ["a1"] });
    expect((await ledger(id)).map((r) => r.action)).toEqual([
      "approvals.request.approve",
      SCOPED_BRANCH_READ_ACTION,
      "approvals.request.execute",
    ]);
  });
});
