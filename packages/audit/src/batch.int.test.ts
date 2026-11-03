// Kernel units and one ledger entry per job step (Finbyx PR-FBX-30; R1-D-41; audit/0005): a batch
// shares one transaction, a failed item rolls back alone with its ledger entries, the commit still
// needs a surviving entry, and the batch entry's members match the digest it carries.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { KernelContext } from "@infrabyx/contracts/kernel";
import { PgKernel } from "@infrabyx/tenancy";
import { verifyChain } from "./chain.js";
import { AuditService } from "./service.js";
import { PgAuditSink } from "./sink.js";
import { freshDb } from "./__tests__/db.js";

let db: Awaited<ReturnType<typeof freshDb>>;
let kernel: PgKernel;
const sink = new PgAuditSink();
const job: KernelContext = {
  tenantId: "tnt_cob",
  principal: { id: "svc_cob", type: "service", roles: ["SVC_FBX_COB"] },
};

beforeAll(async () => {
  db = await freshDb();
  kernel = new PgKernel({ pool: db.pool });
  await db.admin.query(`
    create schema cob;
    grant usage on schema cob to app_rw;
    create table cob.loan (tenant_id text not null, id text primary key, balance numeric not null check (balance >= 0));
    alter table cob.loan enable row level security;
    alter table cob.loan force row level security;
    create policy loan_tenant on cob.loan for all using (tenant_id = current_setting('app.tenant_id', true));
    grant select, insert, update on cob.loan to app_rw;
    insert into cob.loan values ('tnt_cob', 'ln_1', 100), ('tnt_cob', 'ln_2', 5), ('tnt_cob', 'ln_3', 100);
  `);
});
afterAll(async () => db?.end());

describe("kernel units and batch ledger entries (PR-FBX-30)", () => {
  it("rolls back a failed item alone; one entry lists the items that succeeded", async () => {
    const result = await kernel.mutate(
      job,
      async (tx) => {
        const done: string[] = [];
        const failed: string[] = [];
        for (const id of ["ln_1", "ln_2", "ln_3"]) {
          const o = await tx.unit!(async (u) => {
            await u.query("update cob.loan set balance = balance - 10 where id = $1", [id]);
            await sink.record(u, {
              action: "cob.loan.accrue",
              resourceType: "loan",
              resourceId: id,
            });
          });
          (o.ok ? done : failed).push(id);
        }
        const entry = await sink.recordBatch(tx, {
          action: "cob.step.accrue",
          run: "cobrun_2026-11-02",
          step: "pass_a",
          resourceType: "loan",
          resourceIds: done,
        });
        return { done, failed, entry };
      },
      { action: "cob.step.accrue" },
    );
    expect(result.done).toEqual(["ln_1", "ln_3"]);
    expect(result.failed).toEqual(["ln_2"]);
    const balances = await db.admin.query("select id, balance::int as b from cob.loan order by id");
    expect(balances.rows).toEqual([
      { id: "ln_1", b: 90 },
      { id: "ln_2", b: 5 },
      { id: "ln_3", b: 90 },
    ]);
    const entries = await db.admin.query(
      "select action, resource_id from audit.ledger where tenant_id = 'tnt_cob' order by seq",
    );
    expect(entries.rows).toEqual([
      { action: "cob.loan.accrue", resource_id: "ln_1" },
      { action: "cob.loan.accrue", resource_id: "ln_3" },
      { action: "cob.step.accrue", resource_id: "cobrun_2026-11-02/pass_a/loan" },
    ]);
    const chain = await new AuditService({ kernel, sink, product: "FBX" } as never).query(job);
    expect(chain.map((r) => r.seq)).toEqual([1, 2, 3]);
    expect(verifyChain(chain).ok).toBe(true);
    expect(await kernel.read(job, (tx) => sink.verifyBatch(tx, result.entry.id))).toBe(true);
    await expect(
      db.admin.query("update audit.batch_member set resource_id = 'ln_2' where ledger_id = $1", [
        result.entry.id,
      ]),
    ).rejects.toThrow();
  });

  it("does not let a rolled-back unit's ledger entry satisfy the commit check", async () => {
    await expect(
      kernel.mutate(
        job,
        async (tx) => {
          await tx.unit!(async (u) => {
            await sink.record(u, {
              action: "cob.loan.accrue",
              resourceType: "loan",
              resourceId: "ln_1",
            });
            throw new Error("item failed");
          });
          await tx.query("update cob.loan set balance = 0 where id = 'ln_1'");
        },
        { action: "cob.step.accrue" },
      ),
    ).rejects.toMatchObject({ code: "IPB-MOD-003" });
    expect(
      (await db.admin.query("select balance::int as b from cob.loan where id = 'ln_1'")).rows[0].b,
    ).toBe(90);
  });

  it("keeps savepoints the kernel's: callers still cannot issue them, and reads have no units", async () => {
    await expect(
      kernel.mutate(job, (tx) => tx.query("savepoint mine"), { action: "cob.step.accrue" }),
    ).rejects.toThrow(/transaction control belongs to the kernel/);
    await expect(kernel.read(job, (tx) => tx.unit!(async () => 1))).rejects.toThrow(/mutations/);
  });

  it("refuses a batch entry with no members, a bad id or a member of another tenant's entry", async () => {
    await expect(
      kernel.mutate(job, (tx) =>
        sink.recordBatch(tx, {
          action: "cob.step.accrue",
          run: "r1",
          step: "s",
          resourceType: "loan",
          resourceIds: [],
        }),
      ),
    ).rejects.toThrow(/1 to/);
    await expect(
      kernel.mutate(job, (tx) =>
        sink.recordBatch(tx, {
          action: "cob.step.accrue",
          run: "r/1",
          step: "s",
          resourceType: "loan",
          resourceIds: ["a"],
        }),
      ),
    ).rejects.toThrow(/run and step/);
    const other: KernelContext = { ...job, tenantId: "tnt_other" };
    const { id } = await kernel.mutate(other, (tx) =>
      sink.recordBatch(tx, {
        action: "cob.step.accrue",
        run: "r1",
        step: "s",
        resourceType: "loan",
        resourceIds: ["a"],
      }),
    );
    await expect(
      kernel.mutate(job, async (tx) => {
        await sink.record(tx, { action: "cob.loan.accrue", resourceType: "loan", resourceId: "x" });
        await tx.query(
          "insert into audit.batch_member (tenant_id, ledger_id, ordinal, resource_id) values ('tnt_cob', $1, 9, 'x')",
          [id],
        );
      }),
    ).rejects.toThrow(/same tenant/);
  });
});
