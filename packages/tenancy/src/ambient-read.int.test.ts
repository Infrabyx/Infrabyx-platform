// Reads joined to an ambient mutation (Udofin PR-UDF-037; R1-D-188): with `joinReads`, a `read`
// inside `ambient` sees the transaction's uncommitted writes, runs read-only as the read role and
// leaves the ambient transaction as it was; without it, and for a snapshot or another tenant's
// read, a read keeps its own transaction. Joined reads run one at a time with joined mutations.
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
const user = (id = "usr_a", tenantId = "tnt_a"): KernelContext => ({
  tenantId,
  principal: { id, type: "user", roles: ["ORG_USER"] },
});

const insertItem = (ctx: KernelContext, text: string) =>
  kernel.mutate(
    ctx,
    async (tx) => {
      await tx.query("insert into t.item (text) values ($1)", [text]);
      await audit.record(tx, { action: "items.item.add", resourceType: "item", resourceId: text });
    },
    { action: "items.item.add" },
  );
const readItems = (ctx: KernelContext, opts?: { snapshot?: boolean }) =>
  kernel.read(
    ctx,
    async (tx) =>
      (await tx.query<{ text: string }>("select text from t.item order by id")).rows.map(
        (r) => r.text,
      ),
    opts,
  );
/** An ambient mutation with its own ledger entry, so it may commit. */
const ambient = <T>(fn: (tx: Tx) => Promise<T>, joinReads = true) =>
  kernel.ambient(
    user(),
    async (tx) => {
      const r = await fn(tx);
      await audit.record(tx, { action: "api.items", resourceType: "x", resourceId: "x" });
      return r;
    },
    { action: "api.items", joinReads },
  );

beforeAll(async () => {
  db = await freshDb();
  kernel = new PgKernel({ pool: db.pool, readRole: "app_ro" });
  await db.admin.query(
    "insert into tenancy.tenant (id, product, name) values ('tnt_a', 'UDF', 'A'), ('tnt_b', 'UDF', 'B')",
  );
  await db.admin.query(`
    create schema t;
    create table t.item (id serial primary key, text text);
    create table t.secret (id serial primary key, text text);
    grant usage on schema t to app_rw, app_ro;
    grant select, insert on t.item to app_rw;
    grant select on t.item to app_ro;
    grant select, insert on t.secret to app_rw;
    grant usage on sequence t.item_id_seq, t.secret_id_seq to app_rw`);
});
afterAll(async () => db?.end());

describe("reads joined to an ambient mutation (PR-UDF-037)", () => {
  it("sees the ambient transaction's uncommitted writes with joinReads", async () => {
    const seen = await ambient(async () => {
      await insertItem(user(), "one");
      return readItems(user());
    });
    expect(seen).toEqual(["one"]);
  });

  it("without joinReads, a snapshot read or another tenant's read, keeps its own transaction", async () => {
    const out = await ambient(async () => {
      await insertItem(user(), "two");
      return {
        snapshot: await readItems(user(), { snapshot: true }),
        otherTenant: await readItems(user("usr_a", "tnt_b")),
      };
    });
    expect(out.snapshot).toEqual(["one"]);
    expect(out.otherTenant).toEqual(["one"]);
    const plain = await ambient(async () => {
      await insertItem(user(), "three");
      return readItems(user());
    }, false);
    expect(plain).toEqual(["one", "two"]);
  });

  it("runs read-only as the read role and leaves the ambient transaction read-write as it was", async () => {
    const out = await ambient(async (tx) => {
      const write = await kernel
        .read(user(), (r) => r.query("insert into t.item (text) values ('sneaky')"))
        .catch((e: { code?: string }) => e.code);
      const secret = await kernel
        .read(user(), (r) => r.query("select * from t.secret"))
        .catch((e: { code?: string }) => e.code);
      const inside = await kernel.read(user(), async (r) => {
        const s = await r.query<{ role: string; ro: string; action: string }>(
          "select current_user as role, current_setting('transaction_read_only') as ro, current_setting('app.action') as action",
        );
        return s.rows[0];
      });
      // The ambient transaction is still itself: its role, read-write state and settings.
      const after = await tx.query<{ role: string; ro: string; action: string }>(
        "select current_user as role, current_setting('transaction_read_only') as ro, current_setting('app.action') as action",
      );
      await tx.query("insert into t.secret (text) values ('kept')");
      return { write, secret, inside, after: after.rows[0] };
    });
    expect(out.write).toBe("25006"); // read_only_sql_transaction
    expect(out.secret).toBe("42501"); // insufficient_privilege: app_ro holds no grant
    expect(out.inside).toEqual({ role: "app_ro", ro: "on", action: "" });
    expect(out.after).toEqual({ role: "app_rw", ro: "off", action: "api.items" });
    const kept = await db.admin.query("select text from t.secret");
    expect(kept.rows).toEqual([{ text: "kept" }]);
    expect((await db.admin.query("select 1 from t.item where text = 'sneaky'")).rows).toEqual([]);
  });

  it("runs one at a time with joined calls; a read nested in a joined mutation joins", async () => {
    await expect(
      ambient(async () => {
        const r = await Promise.allSettled([readItems(user()), readItems(user())]);
        const refused = r.find((x) => x.status === "rejected");
        if (refused) throw refused.reason;
      }),
    ).rejects.toThrow(/one at a time/);
    const nested = await ambient(() =>
      kernel.mutate(
        user(),
        async (tx) => {
          await tx.query("insert into t.item (text) values ('four')");
          await audit.record(tx, { action: "items.item.add", resourceType: "i", resourceId: "4" });
          return readItems(user());
        },
        { action: "items.item.add" },
      ),
    );
    expect(nested).toContain("four");
  });

  it("a joined read's failure reaches its caller and the ambient transaction carries on", async () => {
    const out = await ambient(async () => {
      const e = await kernel
        .read(user(), (r) => r.query("select * from t.missing"))
        .catch((x: { code?: string }) => x.code);
      await insertItem(user(), "five");
      return { e, items: await readItems(user()) };
    });
    expect(out.e).toBe("42P01");
    expect(out.items).toContain("five");
  });
});
