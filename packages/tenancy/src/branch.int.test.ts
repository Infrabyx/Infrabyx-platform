// The branch context (Finbyx PR-FBX-10 item 1; R1-D-26; tenancy/0007): the kernel sets the branch,
// the visible branches and the scope for each transaction, and `tenancy.branch_allowed()` lets a
// product's policy scope rows by branch as well as tenant, denying by default.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuditEntryInput, AuditSink, KernelContext, Tx } from "@infrabyx/contracts/kernel";
import { PgKernel } from "./kernel.js";
import { freshDb, type TestDb } from "./__tests__/pg.js";

class RecordingAudit implements AuditSink {
  async record(tx: Tx, _e: AuditEntryInput): Promise<{ id: string }> {
    tx.markAudited();
    return { id: "led_x" };
  }
}

let db: TestDb;
let kernel: PgKernel;
const audit = new RecordingAudit();
const user = (over: Partial<KernelContext> = {}): KernelContext => ({
  tenantId: "tnt_a",
  principal: { id: "usr_a", type: "user", roles: ["ORG_USER"] },
  ...over,
});

beforeAll(async () => {
  db = await freshDb();
  kernel = new PgKernel({ pool: db.pool });
  await db.admin.query(`
    insert into tenancy.tenant (id, product, name) values ('tnt_a', 'FBX', 'A');
    create schema loans;
    grant usage on schema loans to app_rw, app_ro;
    create table loans.account (id text primary key, tenant_id text not null, branch_id text);
    alter table loans.account enable row level security;
    alter table loans.account force row level security;
    create policy account_tenant_branch on loans.account for all
      using (tenant_id = current_setting('app.tenant_id', true) and tenancy.branch_allowed(branch_id))
      with check (tenant_id = current_setting('app.tenant_id', true) and tenancy.branch_allowed(branch_id));
    grant select, insert, update on loans.account to app_rw;
    grant select on loans.account to app_ro;
    insert into loans.account values ('a1', 'tnt_a', 'br_north'), ('a2', 'tnt_a', 'br_south'),
      ('a3', 'tnt_a', null);
  `);
});
afterAll(async () => db?.end());

const visible = (c: KernelContext) =>
  kernel.read(c, async (tx) =>
    (await tx.query<{ id: string }>("select id from loans.account order by id")).rows.map(
      (r) => r.id,
    ),
  );

describe("@IPB-02-12 branch-level RLS (R1-D-26)", () => {
  it("rows of the listed branches only; every branch with allBranches; none without a branch context", async () => {
    expect(await visible(user({ branchIds: ["br_north"] }))).toEqual(["a1"]);
    expect(await visible(user({ branchIds: ["br_north", "br_south"] }))).toEqual(["a1", "a2"]);
    expect(await visible(user({ allBranches: true }))).toEqual(["a1", "a2", "a3"]);
    expect(await visible(user())).toEqual([]);
  });

  it("writes are checked the same way, and the kernel sets the current branch", async () => {
    const c = user({ branchId: "br_north", branchIds: ["br_north"] });
    const got = await kernel.mutate(c, async (tx) => {
      await tx.query("insert into loans.account values ('a4', 'tnt_a', 'br_north')");
      await audit.record(tx, {
        action: "loans.account.open",
        resourceType: "account",
        resourceId: "a4",
      });
      return (await tx.query<{ b: string }>("select current_setting('app.branch_id') as b"))
        .rows[0]!.b;
    });
    expect(got).toBe("br_north");
    await expect(
      kernel.mutate(c, async (tx) => {
        await tx.query("insert into loans.account values ('a5', 'tnt_a', 'br_south')");
        await audit.record(tx, {
          action: "loans.account.open",
          resourceType: "account",
          resourceId: "a5",
        });
      }),
    ).rejects.toThrow(/row-level security/);
  });

  it("a crafted branch list cannot widen the scope; a malformed branch or one outside the list is refused", async () => {
    // A comma inside an id would split into two branches: ids are refused before the transaction.
    await expect(visible(user({ branchIds: ["br_north,br_south"] }))).rejects.toThrow(RangeError);
    await expect(
      visible(user({ branchId: "br_south", branchIds: ["br_north"] })),
    ).rejects.toMatchObject({
      code: "IPB-SEC-005",
    });
    // The kernel refuses a callback that tries to set the branch scope itself.
    await expect(
      kernel.read(user({ branchIds: ["br_north"] }), (tx) =>
        tx.query("select set_config('app.branch_scope', 'all', true)"),
      ),
    ).rejects.toThrow(/app\.\* settings/);
    expect(
      await kernel.read(
        user({ branchIds: ["br_north"] }),
        async (tx) =>
          (await tx.query<{ ok: boolean }>("select tenancy.branch_allowed('br_south') as ok"))
            .rows[0]!.ok,
      ),
    ).toBe(false);
  });
});
