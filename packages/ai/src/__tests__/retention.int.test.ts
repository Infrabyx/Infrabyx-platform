// AI run retention (owner approval OWNER-QUESTIONS #30, PL4-D-05) on PostgreSQL with every platform
// migration applied: routine runs go after 180 days with each deletion ledgered; held runs stay.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId } from "@infrabyx/crypto";
import { startPostgres, withTenant, type TestDatabase } from "@infrabyx/testing";
import { RunRetention, runSweepContext } from "../retention.js";

let db: TestDatabase;
const a = withTenant("tnt_ret_a", ["ORG_MEMBER"], { principal: { id: "usr_a" } });
const b = withTenant("tnt_ret_b", ["ORG_MEMBER"], { principal: { id: "usr_b" } });

async function run(tenant: string, ageDays: number): Promise<string> {
  const id = newId("run");
  await db.admin.query(
    `insert into ai.run (id, tenant_id, feature_key, principal_id, principal_type, operation,
                         data_class, band, outcome, route_reason, duration_ms, created_at)
     values ($1, $2, 'ref.summarise', 'usr_x', 'user', 'chat', 'INTERNAL', 'open', 'ok',
             'default', 5, now() - make_interval(days => $3))`,
    [id, tenant, ageDays],
  );
  return id;
}
const exists = async (id: string) =>
  (await db.admin.query("select 1 from ai.run where id = $1", [id])).rowCount === 1;

beforeAll(async () => {
  db = await startPostgres();
});
afterAll(async () => {
  await db?.end();
});

describe("AI run retention (PL4-D-05)", () => {
  it("deletes routine runs after 180 days, keeps held and recent ones, and ledgers each deletion", async () => {
    const retention = new RunRetention({
      kernel: db.kernel,
      audit: db.audit,
      // A value below the owner's floor is ignored: 180 days still applies.
      settings: { get: async () => 30 },
    });
    expect(await retention.retentionDays()).toBe(180);
    const routine = await run("tnt_ret_a", 200);
    const held = await run("tnt_ret_a", 400);
    const released = await run("tnt_ret_a", 365);
    const recent = await run("tnt_ret_a", 90);
    const other = await run("tnt_ret_b", 181);
    await retention.hold(a, held, { kind: "approval", ref: "apr_kept" });
    await retention.hold(a, released, { kind: "statutory_output", ref: "kfs_1" });
    await retention.release(a, released, { kind: "statutory_output", ref: "kfs_1" });

    expect(await retention.sweep({ batch: 1 })).toEqual({ deleted: 3 });
    expect(await exists(routine)).toBe(false);
    expect(await exists(released)).toBe(false);
    expect(await exists(other)).toBe(false);
    expect(await exists(held)).toBe(true);
    expect(await exists(recent)).toBe(true);

    const purges = await db.admin.query<{ tenant_id: string; resource_id: string }>(
      "select tenant_id, resource_id from audit.ledger where action = 'ai.run.purge' order by seq",
    );
    expect(purges.rows.map((r) => r.resource_id).sort()).toEqual([routine, released, other].sort());
    expect(new Set(purges.rows.map((r) => r.tenant_id))).toEqual(
      new Set(["tnt_ret_a", "tnt_ret_b"]),
    );
    const reads = await db.admin.query(
      "select tenant_id from audit.ledger where action = 'platform.service_read' and actor_id = 'svc_ai_run_sweep' and resource_id = 'ai.run'",
    );
    expect(reads.rowCount).toBeGreaterThanOrEqual(2);
    // A second sweep finds nothing more to delete.
    expect(await retention.sweep()).toEqual({ deleted: 0 });
  });

  it("PostgreSQL refuses to delete a held or recent run, whoever asks", async () => {
    const retention = new RunRetention({ kernel: db.kernel, audit: db.audit });
    const held = await run("tnt_ret_b", 300);
    const recent = await run("tnt_ret_b", 179);
    await retention.hold(b, held, { kind: "maker_checker", ref: "apr_mc" });
    const n = await db.kernel.mutate(
      runSweepContext("tnt_ret_b"),
      async (tx) => {
        const r = await tx.query("delete from ai.run where id = any($1)", [[held, recent]]);
        await db.audit.record(tx, {
          action: "ai.run.purge",
          resourceType: "ai_run",
          resourceId: held,
          after: { attempted: 2 },
        });
        return r.rowCount;
      },
      { action: "ai.run.purge" },
    );
    expect(n).toBe(0);
    expect(await exists(held)).toBe(true);
    expect(await exists(recent)).toBe(true);
  });

  it("a hold is released once; a hold on another tenant's run is not found", async () => {
    const retention = new RunRetention({ kernel: db.kernel, audit: db.audit });
    const id = await run("tnt_ret_a", 10);
    await retention.hold(a, id, { kind: "approval", ref: "apr_once" });
    await retention.hold(a, id, { kind: "approval", ref: "apr_once" });
    await retention.release(a, id, { kind: "approval", ref: "apr_once" });
    await expect(retention.release(a, id, { kind: "approval", ref: "apr_once" })).rejects.toThrow();
    await expect(retention.hold(b, id, { kind: "approval", ref: "apr_x" })).rejects.toThrow();
    await expect(retention.hold(a, id, { kind: "export" as never, ref: "x" })).rejects.toThrow(
      /kind/,
    );
  });
});
