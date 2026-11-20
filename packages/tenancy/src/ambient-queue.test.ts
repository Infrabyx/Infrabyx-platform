// Contract tests for Udofin PR-UDF-062 (R1-D-237) without a database: the statements an ambient
// mutation sends for concurrent joined calls by other principals, in order (one savepoint at a time,
// each call's settings, then the ambient call's back), and what happens when a joined call's
// settings cannot be restored (nothing more is sent and the transaction rolls back).
import type pg from "pg";
import { describe, expect, it } from "vitest";
import type { KernelContext, Tx } from "@infrabyx/contracts/kernel";
import { PgKernel } from "./kernel.js";

const user = (id: string): KernelContext => ({
  tenantId: "tnt_a",
  principal: { id, type: "user", roles: ["ORG_USER"] },
});

/** A pool of one recording client; the `failAt`-th settings statement fails. */
function fakePool(failAt?: number) {
  const sent: string[] = [];
  let settings = 0;
  const client = {
    query(text: string, params?: unknown[]) {
      const t = text.replace(/\s+/g, " ").trim();
      if (t.includes("set_config('app.tenant_id'")) {
        settings++;
        sent.push(`settings ${String(params?.[2])} ${String(params?.[6])}`);
        if (settings === failAt) return Promise.reject(new Error("connection lost"));
      } else sent.push(t);
      return Promise.resolve({ rows: [{ sandbox: false }], rowCount: 1 });
    },
    release() {},
  };
  return { sent, pool: { connect: async () => client as unknown as pg.PoolClient } };
}

const joined = (kernel: PgKernel, who: string, wait = 0) =>
  kernel.mutate(
    user(who),
    async (tx: Tx) => {
      if (wait) await new Promise((r) => setTimeout(r, wait));
      await tx.query(`select '${who}'`);
      tx.markAudited();
      return who;
    },
    { action: `x.${who}.run` },
  );

describe("@IPB-02-12 PR-UDF-062 ambient queue (statement order)", () => {
  it("runs concurrent joined calls one savepoint at a time and restores the ambient settings after each", async () => {
    const { sent, pool } = fakePool();
    const kernel = new PgKernel({ pool });
    const out = await kernel.ambient(
      user("usr_a"),
      async (tx) => {
        const r = await Promise.all([joined(kernel, "usr_b", 20), joined(kernel, "usr_c")]);
        await tx.query("select 'ambient'");
        tx.markAudited();
        return r;
      },
      { action: "api.x" },
    );
    expect(out).toEqual(["usr_b", "usr_c"]);
    expect(sent).toEqual([
      "begin",
      'set local role "app_rw"',
      "settings usr_a api.x",
      "select tenancy.tenant_sandbox() as sandbox",
      "savepoint ipb_unit_0",
      "settings usr_b x.usr_b.run",
      "select 'usr_b'",
      "release savepoint ipb_unit_0",
      "settings usr_a api.x",
      "savepoint ipb_unit_0",
      "settings usr_c x.usr_c.run",
      "select 'usr_c'",
      "release savepoint ipb_unit_0",
      "settings usr_a api.x",
      "select 'ambient'",
      "commit",
    ]);
  });

  it("sends nothing more and rolls back when a joined call's settings cannot be restored", async () => {
    // Settings statements: the ambient call's (1), the joined call's (2), the restore (3).
    const { sent, pool } = fakePool(3);
    const kernel = new PgKernel({ pool });
    let joinedError = "";
    let laterError = "";
    let queuedError = "";
    await expect(
      kernel.ambient(
        user("usr_a"),
        async (tx) => {
          const [first, queued] = await Promise.allSettled([
            joined(kernel, "usr_b"),
            joined(kernel, "usr_c"),
          ]);
          joinedError = (first as PromiseRejectedResult).reason.message;
          queuedError = (queued as PromiseRejectedResult).reason.message;
          laterError = await tx.query("select 'later'").then(
            () => "",
            (e: Error) => e.message,
          );
          tx.markAudited();
        },
        { action: "api.x" },
      ),
    ).rejects.toThrow(/could not be restored/);
    expect(joinedError).toMatch(/could not be restored/);
    expect(queuedError).toMatch(/could not be restored/);
    expect(laterError).toMatch(/could not be restored/);
    expect(sent).not.toContain("select 'later'");
    expect(sent).not.toContain("select 'usr_c'");
    expect(sent).not.toContain("commit");
    expect(sent.at(-1)).toBe("rollback");
  });
});
