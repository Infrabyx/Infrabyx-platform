// Contract tests for Udofin PR-UDF-062 (R1-D-237): inside `kernel.ambient`, (1) a same-tenant call
// by another principal joins under a savepoint with its own `app.*` settings and ledger rows, and
// the settings of the call it was made from come back on every path; its reads join with
// `joinReads`; (2) another tenant's call never joins and runs in its own transaction; (3)
// concurrent joined calls queue and run one at a time in order, and a call made from inside a
// running joined call runs at once. The test ledger mirrors `audit.ledger`'s insert policy: a row
// must name the tenant and actor of the settings it is written under.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuditEntryInput, AuditSink, KernelContext, Tx } from "@infrabyx/contracts/kernel";
import { PgKernel } from "./kernel.js";
import { freshDb, type TestDb } from "./__tests__/pg.js";

/** Writes `t.ledger` as `PgAuditSink` writes `audit.ledger`: tenant and actor from `tx.ctx`. */
class TableAudit implements AuditSink {
  async record(tx: Tx, e: AuditEntryInput): Promise<{ id: string }> {
    await tx.query(
      "insert into t.ledger (tenant_id, actor_id, action, resource_id) values ($1, $2, $3, $4)",
      [tx.ctx.tenantId, tx.ctx.principal.id, e.action, e.resourceId],
    );
    tx.markAudited();
    return { id: "led_x" };
  }
}

let db: TestDb;
let kernel: PgKernel;
const audit = new TableAudit();
const user = (id: string, tenantId = "tnt_a"): KernelContext => ({
  tenantId,
  principal: { id, type: "user", roles: ["ORG_USER"] },
});
const A = user("usr_a");
const B = user("usr_b");
const C = user("usr_c");
const OTHER = user("usr_x", "tnt_b");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Settings {
  tenant: string;
  actor: string;
  action: string;
  role: string;
  ro: string;
}
const settings = async (tx: Tx): Promise<Settings> =>
  (
    await tx.query<Settings>(
      `select current_setting('app.tenant_id', true) as tenant,
              current_setting('app.actor_id', true) as actor,
              current_setting('app.action', true) as action,
              current_user as role, current_setting('transaction_read_only') as ro`,
    )
  ).rows[0]!;

/** A service that opens its own mutation, reports the settings it ran under, and ledgers it. */
function addDoc(
  ctx: KernelContext,
  text: string,
  o: { fail?: "throw" | "sql"; wait?: number; log?: string[] } = {},
): Promise<Settings> {
  return kernel.mutate(
    ctx,
    async (tx) => {
      const s = await settings(tx);
      o.log?.push(`start ${text} ${s.actor}`);
      if (o.wait) await sleep(o.wait);
      await tx.query("insert into t.doc (text) values ($1)", [text]);
      await audit.record(tx, { action: "docs.doc.add", resourceType: "doc", resourceId: text });
      if (o.fail === "throw") throw new Error(`refused ${text}`);
      if (o.fail === "sql") await tx.query("select 1 / 0");
      o.log?.push(`end ${text}`);
      return s;
    },
    { action: "docs.doc.add" },
  );
}

/** An ambient mutation as `A` with its own ledger entry, so it may commit. */
const ambient = <T>(fn: (tx: Tx) => Promise<T>, joinReads = false, ctx = A) =>
  kernel.ambient(
    ctx,
    async (tx) => {
      const r = await fn(tx);
      await audit.record(tx, { action: "api.docs", resourceType: "x", resourceId: "x" });
      return r;
    },
    { action: "api.docs", joinReads },
  );

const docs = async (like: string) =>
  (
    await db.admin.query<{ text: string; tenant_id: string; actor_id: string }>(
      "select text, tenant_id, actor_id from t.doc where text like $1 order by id",
      [like],
    )
  ).rows;
const ledger = async (like: string) =>
  (
    await db.admin.query<{ resource_id: string; actor_id: string }>(
      "select resource_id, actor_id from t.ledger where resource_id like $1 order by id",
      [like],
    )
  ).rows;

beforeAll(async () => {
  db = await freshDb();
  kernel = new PgKernel({ pool: db.pool, readRole: "app_ro" });
  await db.admin.query(
    "insert into tenancy.tenant (id, product, name) values ('tnt_a', 'UDF', 'A'), ('tnt_b', 'UDF', 'B')",
  );
  await db.admin.query(`
    create schema t;
    grant usage on schema t to app_rw, app_ro;
    -- A tenant's rows, each stamped with the actor of the settings it was written under.
    create table t.doc (
      id serial primary key,
      tenant_id text not null default current_setting('app.tenant_id', true),
      actor_id text not null default current_setting('app.actor_id', true),
      text text not null);
    alter table t.doc enable row level security;
    alter table t.doc force row level security;
    create policy doc_tenant on t.doc
      using (tenant_id = current_setting('app.tenant_id', true))
      with check (tenant_id = current_setting('app.tenant_id', true)
                  and actor_id = current_setting('app.actor_id', true));
    grant select, insert on t.doc to app_rw;
    grant select on t.doc to app_ro;
    grant usage on sequence t.doc_id_seq to app_rw;
    -- As audit.ledger: an entry names the tenant and actor of its settings (audit/0001).
    create table t.ledger (
      id serial primary key, tenant_id text not null, actor_id text not null,
      action text not null, resource_id text not null);
    alter table t.ledger enable row level security;
    alter table t.ledger force row level security;
    create policy ledger_tenant on t.ledger
      using (tenant_id = current_setting('app.tenant_id', true))
      with check (tenant_id = current_setting('app.tenant_id', true)
                  and actor_id = current_setting('app.actor_id', true));
    grant select, insert on t.ledger to app_rw;
    grant usage on sequence t.ledger_id_seq to app_rw;
    -- No RLS: shows what another transaction can see of uncommitted rows.
    create table t.plain (id serial primary key, text text not null);
    grant select, insert on t.plain to app_rw;
    grant select on t.plain to app_ro;
    grant usage on sequence t.plain_id_seq to app_rw;`);
  await db.admin.query(
    "insert into t.doc (tenant_id, actor_id, text) values ('tnt_b', 'usr_x', 'b-seed')",
  );
});
afterAll(async () => db?.end());

describe("@IPB-02-12 PR-UDF-062 (1) another principal of the tenant joins with its own settings", () => {
  it("runs under a savepoint with its own app.* values and ledger rows, then the ambient's come back", async () => {
    const out = await ambient(async (tx) => {
      const inB = await addDoc(B, "p1-b");
      const afterB = await settings(tx);
      const inA = await addDoc(A, "p1-a");
      // The ambient transaction sees the joined call's uncommitted row, under RLS.
      const seen = await tx.query<{ text: string }>(
        "select text from t.doc where text like 'p1-%' order by id",
      );
      return { inB, afterB, inA, seen: seen.rows.map((r) => r.text) };
    });
    expect(out.inB).toMatchObject({ tenant: "tnt_a", actor: "usr_b", action: "docs.doc.add" });
    expect(out.afterB).toMatchObject({ tenant: "tnt_a", actor: "usr_a", action: "api.docs" });
    expect(out.inA).toMatchObject({ actor: "usr_a", action: "docs.doc.add" });
    expect(out.seen).toEqual(["p1-b", "p1-a"]);
    expect(await docs("p1-%")).toEqual([
      { text: "p1-b", tenant_id: "tnt_a", actor_id: "usr_b" },
      { text: "p1-a", tenant_id: "tnt_a", actor_id: "usr_a" },
    ]);
    expect(await ledger("p1-%")).toEqual([
      { resource_id: "p1-b", actor_id: "usr_b" },
      { resource_id: "p1-a", actor_id: "usr_a" },
    ]);
  });

  it("restores the ambient principal after a joined call that throws or fails in SQL; the ambient carries on", async () => {
    const out = await ambient(async (tx) => {
      const thrown = await addDoc(B, "p2-throw", { fail: "throw" }).catch((e: Error) => e.message);
      const afterThrow = await settings(tx);
      const sql = await addDoc(C, "p2-sql", { fail: "sql" }).catch(
        (e: { code?: string }) => e.code,
      );
      const afterSql = await settings(tx);
      // The ambient's own write passes the policy as the ambient principal again.
      await tx.query("insert into t.doc (text) values ('p2-ambient')");
      return { thrown, afterThrow, sql, afterSql };
    });
    expect(out.thrown).toBe("refused p2-throw");
    expect(out.sql).toBe("22012"); // division_by_zero: the transaction is not left aborted
    for (const s of [out.afterThrow, out.afterSql])
      expect(s).toMatchObject({ tenant: "tnt_a", actor: "usr_a", action: "api.docs" });
    expect(await docs("p2-%")).toEqual([
      { text: "p2-ambient", tenant_id: "tnt_a", actor_id: "usr_a" },
    ]);
    expect(await ledger("p2-%")).toEqual([]);
  });

  it("RLS still isolates inside the joined call: the tenant's rows only, and only its own actor", async () => {
    const out = await ambient(() =>
      kernel.mutate(
        B,
        async (tx) => {
          const tenants = await tx.query<{ tenant_id: string }>(
            "select distinct tenant_id from t.doc",
          );
          // In a unit, so the refused insert does not abort the joined call.
          const u = await tx.unit!((x) =>
            x.query("insert into t.doc (actor_id, text) values ('usr_a', 'p3-spoof')"),
          );
          const spoof = u.ok ? "inserted" : (u.error as { code?: string }).code;
          await audit.record(tx, {
            action: "docs.doc.check",
            resourceType: "doc",
            resourceId: "p3",
          });
          return { tenants: tenants.rows.map((r) => r.tenant_id), spoof };
        },
        { action: "docs.doc.check" },
      ),
    );
    expect(out.tenants).toEqual(["tnt_a"]);
    expect(out.spoof).toBe("42501"); // the row names another actor than the settings
    expect(await ledger("p3")).toEqual([{ resource_id: "p3", actor_id: "usr_b" }]);
  });

  it("refuses another principal with a break-glass grant or support access, and another scope", async () => {
    const refused = async (ctx: KernelContext) =>
      ambient(() => addDoc(ctx, "p4")).then(
        () => "joined",
        (e: Error) => e.message,
      );
    expect(await refused({ ...B, breakGlassGrantId: "bg_x" })).toMatch(/ambient mutation's/);
    expect(
      await refused({
        tenantId: "tnt_a",
        principal: { id: "usr_s", type: "user", roles: ["PLT_SUPPORT"] },
      }),
    ).toMatch(/ambient mutation's/);
    expect(
      await refused({
        tenantId: "tnt_a",
        scope: "platform",
        principal: { id: "usr_p", type: "user", roles: ["PLT_SUPER_ADMIN"] },
      }),
    ).toMatch(/ambient mutation's/);
    expect(await docs("p4")).toEqual([]);
  });

  it("joins another principal's read with joinReads: its own settings, the ambient's uncommitted rows, and the ambient comes back", async () => {
    const out = await ambient(async (tx) => {
      await tx.query("insert into t.doc (text) values ('p5-pending')");
      const read = await kernel.read(B, async (r) => ({
        s: await settings(r),
        rows: (await r.query<{ text: string }>("select text from t.doc where text like 'p5-%'"))
          .rows,
      }));
      const failed = await kernel
        .read(C, (r) => r.query("select * from t.missing"))
        .catch((e: { code?: string }) => e.code);
      return { read, failed, after: await settings(tx) };
    }, true);
    expect(out.read.s).toEqual({
      tenant: "tnt_a",
      actor: "usr_b",
      action: "",
      role: "app_ro",
      ro: "on",
    });
    expect(out.read.rows).toEqual([{ text: "p5-pending" }]);
    expect(out.failed).toBe("42P01");
    expect(out.after).toEqual({
      tenant: "tnt_a",
      actor: "usr_a",
      action: "api.docs",
      role: "app_rw",
      ro: "off",
    });
    // Without joinReads another principal's read keeps its own transaction, as before.
    const own = await ambient(async (tx) => {
      await tx.query("insert into t.doc (text) values ('p5-second')");
      return kernel.read(
        B,
        async (r) =>
          (await r.query<{ text: string }>("select text from t.doc where text = 'p5-second'")).rows,
      );
    });
    expect(own).toEqual([]);
  });
});

describe("@IPB-02-12 PR-UDF-062 (2) another tenant's call runs in its own transaction", () => {
  it("commits on its own, under its own tenant, without seeing the ambient's uncommitted rows", async () => {
    let committedEarly = -1;
    let inOther: { s: Settings; plain: number } | undefined;
    await expect(
      ambient(async (tx) => {
        await tx.query("insert into t.plain (text) values ('q1-ambient')");
        inOther = await kernel.mutate(
          OTHER,
          async (t) => {
            const s = await settings(t);
            const plain = await t.query<{ n: number }>(
              "select count(*)::int as n from t.plain where text = 'q1-ambient'",
            );
            await t.query("insert into t.doc (text) values ('q1-other')");
            await audit.record(t, {
              action: "docs.doc.add",
              resourceType: "doc",
              resourceId: "q1",
            });
            return { s, plain: plain.rows[0]!.n };
          },
          { action: "docs.doc.add" },
        );
        // Committed already, while the ambient transaction is still open.
        committedEarly = (await db.admin.query("select 1 from t.doc where text = 'q1-other'"))
          .rowCount!;
        throw new Error("the ambient handler fails");
      }),
    ).rejects.toThrow("the ambient handler fails");
    expect(inOther).toEqual({
      s: expect.objectContaining({ tenant: "tnt_b", actor: "usr_x", action: "docs.doc.add" }),
      plain: 0,
    });
    expect(committedEarly).toBe(1);
    expect(await docs("q1-%")).toEqual([
      { text: "q1-other", tenant_id: "tnt_b", actor_id: "usr_x" },
    ]);
    expect((await db.admin.query("select 1 from t.plain where text = 'q1-ambient'")).rowCount).toBe(
      0,
    );
    expect(await ledger("q1")).toEqual([{ resource_id: "q1", actor_id: "usr_x" }]);
  });

  it("the ambient transaction does not see the other tenant's uncommitted rows either", async () => {
    let inserted!: () => void;
    const otherInserted = new Promise<void>((r) => (inserted = r));
    let checked!: () => void;
    const ambientChecked = new Promise<void>((r) => (checked = r));
    const out = await ambient(async (tx) => {
      const [, seen] = await Promise.all([
        kernel.mutate(
          OTHER,
          async (t) => {
            await t.query("insert into t.plain (text) values ('q2-other')");
            inserted();
            await ambientChecked;
            await audit.record(t, {
              action: "docs.doc.add",
              resourceType: "doc",
              resourceId: "q2",
            });
          },
          { action: "docs.doc.add" },
        ),
        (async () => {
          await otherInserted;
          // Another tenant's call is not a joined call, so this statement does not wait for it.
          const r = await tx.query<{ n: number }>(
            "select count(*)::int as n from t.plain where text = 'q2-other'",
          );
          checked();
          return r.rows[0]!.n;
        })(),
      ]);
      return seen;
    });
    expect(out).toBe(0);
    expect((await db.admin.query("select 1 from t.plain where text = 'q2-other'")).rowCount).toBe(
      1,
    );
  });

  it("another tenant's read keeps its own transaction even with joinReads, and a call nested in it does not join", async () => {
    const out = await ambient(async (tx) => {
      await tx.query("insert into t.plain (text) values ('q3-ambient')");
      return kernel.read(OTHER, async (r) => {
        const plain = await r.query<{ n: number }>(
          "select count(*)::int as n from t.plain where text = 'q3-ambient'",
        );
        const tenants = await r.query<{ tenant_id: string }>(
          "select distinct tenant_id from t.doc",
        );
        // The ambient tenant and principal, but made inside another tenant's call: not joined.
        const nested = await kernel.read(A, async (n) => {
          const q = await n.query<{ n: number }>(
            "select count(*)::int as n from t.plain where text = 'q3-ambient'",
          );
          return q.rows[0]!.n;
        });
        return { plain: plain.rows[0]!.n, tenants: tenants.rows.map((x) => x.tenant_id), nested };
      });
    }, true);
    expect(out).toEqual({ plain: 0, tenants: ["tnt_b"], nested: 0 });
  });
});

describe("@IPB-02-12 PR-UDF-062 (3) concurrent joined calls queue", () => {
  it("runs a Promise.all of joined calls one at a time, in order, each with its own settings", async () => {
    const log: string[] = [];
    const out = await ambient(async (tx) => {
      const [b, c, a, read] = await Promise.all([
        addDoc(B, "r1-b", { wait: 40, log }),
        addDoc(C, "r1-c", { wait: 10, log }),
        addDoc(A, "r1-a", { log }),
        kernel.read(B, async (r) => {
          log.push(`read ${(await settings(r)).actor}`);
          return (
            await r.query<{ text: string }>(
              "select text from t.doc where text like 'r1-%' order by id",
            )
          ).rows.map((x) => x.text);
        }),
      ]);
      return { b, c, a, read, after: await settings(tx) };
    }, true);
    expect(log).toEqual([
      "start r1-b usr_b",
      "end r1-b",
      "start r1-c usr_c",
      "end r1-c",
      "start r1-a usr_a",
      "end r1-a",
      "read usr_b",
    ]);
    expect([out.b.actor, out.c.actor, out.a.actor]).toEqual(["usr_b", "usr_c", "usr_a"]);
    expect(out.read).toEqual(["r1-b", "r1-c", "r1-a"]);
    expect(out.after).toMatchObject({ actor: "usr_a", action: "api.docs" });
    expect((await docs("r1-%")).map((d) => d.actor_id)).toEqual(["usr_b", "usr_c", "usr_a"]);
  });

  it("a failure in one queued call leaves the others' settings and writes intact", async () => {
    const out = await ambient(async (tx) => {
      const r = await Promise.allSettled([
        addDoc(B, "r2-b", { wait: 20 }),
        addDoc(C, "r2-c", { fail: "sql" }),
        addDoc(B, "r2-b2", { fail: "throw" }),
        addDoc(A, "r2-a"),
      ]);
      return { r, after: await settings(tx) };
    });
    const [b, c, b2, a] = out.r;
    expect(b).toMatchObject({ status: "fulfilled", value: { actor: "usr_b" } });
    expect(c).toMatchObject({ status: "rejected", reason: { code: "22012" } });
    expect(b2).toMatchObject({ status: "rejected", reason: { message: "refused r2-b2" } });
    expect(a).toMatchObject({
      status: "fulfilled",
      value: { actor: "usr_a", action: "docs.doc.add" },
    });
    expect(out.after).toMatchObject({ actor: "usr_a", action: "api.docs" });
    expect(await docs("r2-%")).toEqual([
      { text: "r2-b", tenant_id: "tnt_a", actor_id: "usr_b" },
      { text: "r2-a", tenant_id: "tnt_a", actor_id: "usr_a" },
    ]);
  });

  it("the ambient callback's own statements wait while a joined call runs, so none runs under its settings", async () => {
    const out = await ambient(async (tx) => {
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let entered!: () => void;
      const inside = new Promise<void>((r) => (entered = r));
      const joined = kernel.mutate(
        B,
        async (t) => {
          entered(); // B's savepoint and settings are in place
          await gate;
          await audit.record(t, { action: "docs.doc.hold", resourceType: "doc", resourceId: "r3" });
          return (await settings(t)).actor;
        },
        { action: "docs.doc.hold" },
      );
      await inside;
      // Sent while B's call holds the connection: it runs after B's call, as the ambient call.
      const mine = settings(tx);
      setTimeout(release, 50);
      return { joined: await joined, mine: await mine };
    });
    expect(out.joined).toBe("usr_b");
    expect(out.mine).toMatchObject({ actor: "usr_a", action: "api.docs" });
  });

  it("a call made inside a running joined call runs at once; the outer call's settings come back after it", async () => {
    const out = await ambient(async (tx) => {
      const outer = await kernel.mutate(
        B,
        async (t) => {
          const before = await settings(t);
          // Two nested calls at once: they queue behind each other, not behind their caller.
          const [c, a] = await Promise.all([addDoc(C, "r4-c", { wait: 10 }), addDoc(A, "r4-a")]);
          const after = await settings(t);
          await audit.record(t, {
            action: "docs.doc.outer",
            resourceType: "doc",
            resourceId: "r4",
          });
          return { before, c, a, after };
        },
        { action: "docs.doc.outer" },
      );
      return { outer, ambient: await settings(tx) };
    });
    expect(out.outer.before).toMatchObject({ actor: "usr_b", action: "docs.doc.outer" });
    expect(out.outer.c).toMatchObject({ actor: "usr_c", action: "docs.doc.add" });
    expect(out.outer.a).toMatchObject({ actor: "usr_a", action: "docs.doc.add" });
    // Restored to the outer call's settings, not the ambient call's.
    expect(out.outer.after).toMatchObject({ actor: "usr_b", action: "docs.doc.outer" });
    expect(out.ambient).toMatchObject({ actor: "usr_a", action: "api.docs" });
    expect(await ledger("r4%")).toEqual([
      { resource_id: "r4-c", actor_id: "usr_c" },
      { resource_id: "r4-a", actor_id: "usr_a" },
      { resource_id: "r4", actor_id: "usr_b" },
    ]);
  });

  it("refuses a call or statement left behind by a joined call whose callback has settled", async () => {
    let leakedCall: Promise<unknown> | undefined;
    let leakedStatement: Promise<unknown> | undefined;
    const out = await ambient(async (tx) => {
      await kernel.mutate(
        B,
        async (t) => {
          await audit.record(t, { action: "docs.doc.leak", resourceType: "doc", resourceId: "r5" });
          leakedCall = sleep(20).then(() => addDoc(C, "r5-late"));
          leakedStatement = sleep(20).then(() =>
            tx.query("insert into t.doc (text) values ('r5-raw')"),
          );
          leakedCall.catch(() => undefined);
          leakedStatement.catch(() => undefined);
        },
        { action: "docs.doc.leak" },
      );
      await expect(leakedCall).rejects.toThrow(/has ended/);
      await expect(leakedStatement).rejects.toThrow(/has ended/);
      return settings(tx);
    });
    expect(out).toMatchObject({ actor: "usr_a" });
    expect(await docs("r5-%")).toEqual([]);
  });
});
