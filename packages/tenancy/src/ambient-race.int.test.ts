// A joined call must never run on a connection after its transaction has ended (security patch,
// R1-D-92): with one pooled connection, a sibling still running when the ambient mutation ended
// would otherwise reach the next transaction on that connection, which here is another tenant's.
import pg from "pg";
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
let pool: pg.Pool;
let kernel: PgKernel;
const audit = new RecordingAudit();
const user = (id: string, tenantId: string): KernelContext => ({
  tenantId,
  principal: { id, type: "user", roles: ["ORG_USER"] },
});
const A = user("usr_a", "tnt_a");
const B = user("usr_b", "tnt_b");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  db = await freshDb();
  await db.admin.query(
    "insert into tenancy.tenant (id, product, name) values ('tnt_a', 'UDF', 'A'), ('tnt_b', 'UDF', 'B')",
  );
  // One connection: the next transaction after the ambient one reuses its connection.
  pool = new pg.Pool({ connectionString: db.url, max: 1 });
  kernel = new PgKernel({ pool });
});
afterAll(async () => {
  await pool?.end();
  await db?.end();
});

describe("no work on a connection after its transaction ends (R1-D-92)", () => {
  it("a sibling still running when the ambient mutation ends never runs in the next tenant's transaction", async () => {
    const seen: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    // The sibling that is let in waits at the gate, then reads which tenant its statement runs in.
    const slow = () =>
      kernel.mutate(
        A,
        async (tx) => {
          await gate;
          const r = await tx.query<{ t: string }>(
            "select current_setting('app.tenant_id', true) as t",
          );
          seen.push(r.rows[0]!.t);
          await audit.record(tx, { action: "x.y.slow", resourceType: "x", resourceId: "slow" });
          return 1;
        },
        { action: "x.y.slow" },
      );
    const quick = () =>
      kernel.mutate(
        A,
        async (tx) => {
          await audit.record(tx, { action: "x.y.quick", resourceType: "x", resourceId: "q" });
          return 2;
        },
        { action: "x.y.quick" },
      );
    let leaked: Promise<unknown> | undefined;
    const ambient = kernel.ambient(A, async (tx) => {
      await audit.record(tx, { action: "api.x", resourceType: "x", resourceId: "x" });
      leaked = slow();
      leaked.catch(() => undefined);
      // The second sibling is refused at once, so a Promise.all rejects while the first still runs.
      setTimeout(release, 150);
      await Promise.all([leaked, quick()]);
    });
    await expect(ambient).rejects.toThrow(/one at a time/);
    // Tenant B's transaction takes the only connection and holds it while the sibling could run.
    await kernel.mutate(
      B,
      async (tx) => {
        await sleep(300);
        await audit.record(tx, { action: "x.y.b", resourceType: "x", resourceId: "b" });
      },
      { action: "x.y.b" },
    );
    await leaked?.catch(() => undefined);
    expect(seen).not.toContain("tnt_b");
  });

  it("refuses a joined call once the ambient mutation has ended", async () => {
    let late: Promise<unknown> | undefined;
    await kernel.ambient(A, async (tx) => {
      await audit.record(tx, { action: "api.x", resourceType: "x", resourceId: "x" });
      late = sleep(50).then(() =>
        kernel.mutate(
          A,
          async (t) => {
            await audit.record(t, { action: "x.y.late", resourceType: "x", resourceId: "l" });
          },
          { action: "x.y.late" },
        ),
      );
      late.catch(() => undefined);
    });
    await expect(late).rejects.toThrow(/has ended/);
  });

  it("fails the ambient mutation when a joined call was still running at its end", async () => {
    let started = false;
    await expect(
      kernel.ambient(A, async (tx) => {
        await audit.record(tx, { action: "api.x", resourceType: "x", resourceId: "x" });
        // Not awaited: the ambient callback returns while the joined call runs.
        void kernel
          .mutate(
            A,
            async (t) => {
              started = true;
              await sleep(100);
              await audit.record(t, { action: "x.y.bg", resourceType: "x", resourceId: "bg" });
            },
            { action: "x.y.bg" },
          )
          .catch(() => undefined);
      }),
    ).rejects.toThrow(/still running/);
    expect(started).toBe(true);
  });

  it("refuses a statement on a transaction that has ended", async () => {
    let saved: Tx | undefined;
    await kernel.mutate(
      A,
      async (tx) => {
        saved = tx;
        await audit.record(tx, { action: "x.y.z", resourceType: "x", resourceId: "z" });
      },
      { action: "x.y.z" },
    );
    await expect(saved!.query("select 1")).rejects.toThrow(/has ended/);
    let savedRead: Tx | undefined;
    await kernel.read(A, async (tx) => {
      savedRead = tx;
    });
    await expect(savedRead!.query("select 1")).rejects.toThrow(/has ended/);
  });
});
