// Ambient mutations (Udofin PR-UDF-033, Finbyx PR-FBX-21; R1-D-48): a service's own `mutate`
// joins the handler's transaction, so `idempotent()` covers it; a joined call's failure rolls back
// only its writes; its settings are its own and the ambient ones come back; another principal,
// tenant or a concurrent sibling is refused. Idempotency keys belong to their first principal and
// the hash covers the route's parameters.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuditEntryInput, AuditSink, KernelContext, Tx } from "@infrabyx/contracts/kernel";
import { idempotencyRequestHash, idempotent } from "./idempotency.js";
import { PgKernel } from "./kernel.js";
import { freshDb, type TestDb } from "./__tests__/pg.js";

class RecordingAudit implements AuditSink {
  readonly actions: string[] = [];
  async record(tx: Tx, e: AuditEntryInput): Promise<{ id: string }> {
    this.actions.push(e.action);
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
const uuid7 = (tail: number) => `01890a5d-ac96-774b-bcce-b302099a${tail}`;

/** A service that opens its own mutation, as the platform's engines do. */
async function addNote(ctx: KernelContext, text: string, fail = false): Promise<string> {
  return kernel.mutate(
    ctx,
    async (tx) => {
      const s = await tx.query<{ action: string; actor: string }>(
        "select current_setting('app.action') as action, current_setting('app.actor_id') as actor",
      );
      await tx.query("insert into t.note (text, action) values ($1, $2)", [
        text,
        s.rows[0]!.action,
      ]);
      await audit.record(tx, { action: "notes.note.add", resourceType: "note", resourceId: text });
      if (fail) throw new Error("note refused");
      return text;
    },
    { action: "notes.note.add" },
  );
}
const notes = async () =>
  (await db.admin.query<{ text: string }>("select text from t.note order by id")).rows.map(
    (r) => r.text,
  );

beforeAll(async () => {
  db = await freshDb();
  kernel = new PgKernel({ pool: db.pool });
  await db.admin.query(
    "insert into tenancy.tenant (id, product, name) values ('tnt_a', 'UDF', 'A'), ('tnt_b', 'UDF', 'B')",
  );
  await db.admin.query(
    "create schema t; create table t.note (id serial primary key, text text, action text); grant usage on schema t to app_rw; grant select, insert on t.note to app_rw; grant usage on sequence t.note_id_seq to app_rw",
  );
});
afterAll(async () => db?.end());

describe("ambient mutations (PR-UDF-033 (1), PR-FBX-21 (1))", () => {
  it("joins a service's mutation, so idempotent() covers it and a replay runs nothing", async () => {
    const key = uuid7(9001);
    const route = "POST /v1/notes";
    const handler = () =>
      kernel.ambient(
        user(),
        (tx) =>
          idempotent(
            tx,
            { key, route, requestHash: idempotencyRequestHash("POST", route, { t: "one" }) },
            async () => ({ status: 201, body: { id: await addNote(user(), "one") } }),
            { audit },
          ),
        { action: "api.notes.create" },
      );
    expect((await handler()).replayed).toBe(false);
    expect((await handler()).replayed).toBe(true);
    expect(await notes()).toEqual(["one"]);
  });

  it("rolls back only the failed joined call, with its own settings, and restores the ambient ones", async () => {
    const out = await kernel.ambient(
      user(),
      async (tx) => {
        await addNote(user(), "two");
        await expect(addNote(user(), "three", true)).rejects.toThrow("note refused");
        const s = await tx.query<{ action: string }>(
          "select current_setting('app.action') as action",
        );
        await audit.record(tx, { action: "api.batch", resourceType: "x", resourceId: "x" });
        return s.rows[0]!.action;
      },
      { action: "api.batch" },
    );
    expect(out).toBe("api.batch");
    expect(await notes()).toEqual(["one", "two"]);
    const row = await db.admin.query("select action from t.note where text = 'two'");
    expect(row.rows[0]).toEqual({ action: "notes.note.add" });
  });

  it("everything rolls back when the ambient mutation fails", async () => {
    await expect(
      kernel.ambient(user(), async () => {
        await addNote(user(), "four");
        throw new Error("handler failed");
      }),
    ).rejects.toThrow("handler failed");
    expect(await notes()).not.toContain("four");
  });

  it("refuses another principal or tenant, concurrent siblings and a nested ambient", async () => {
    const run = (fn: () => Promise<unknown>) =>
      kernel.ambient(user(), async (tx) => {
        try {
          return await fn();
        } finally {
          await audit.record(tx, { action: "api.x", resourceType: "x", resourceId: "x" });
        }
      });
    await expect(run(() => addNote(user("usr_b"), "five"))).rejects.toThrow(/ambient mutation's/);
    await expect(run(() => addNote(user("usr_a", "tnt_b"), "five"))).rejects.toThrow(
      /ambient mutation's/,
    );
    await expect(
      run(() => Promise.all([addNote(user(), "six"), addNote(user(), "seven")])),
    ).rejects.toThrow(/one at a time/);
    await expect(run(() => kernel.ambient(user(), async () => 1))).rejects.toThrow(/already open/);
    // A joined call still needs its own ledger entry.
    await expect(
      run(() => kernel.mutate(user(), async () => undefined, { action: "x.y.z" })),
    ).rejects.toMatchObject({ code: "IPB-MOD-003" });
  });
});

describe("idempotency keys per principal and resource (PR-UDF-033 (2), PR-FBX-21 (2))", () => {
  const create = (who: string, key: string, params?: Record<string, string>) =>
    kernel.mutate(user(who), (tx) =>
      idempotent(
        tx,
        {
          key,
          route: "POST /v1/branches/:id/change",
          requestHash: idempotencyRequestHash(
            "POST",
            "POST /v1/branches/:id/change",
            { to: "x" },
            params ? { params } : {},
          ),
        },
        async () => {
          await audit.record(tx, { action: "b.change", resourceType: "b", resourceId: who });
          return { status: 200, body: { by: who } };
        },
        { audit },
      ),
    );

  it("never serves one principal's stored response to another", async () => {
    const key = uuid7(9002);
    expect((await create("usr_a", key)).body).toEqual({ by: "usr_a" });
    await expect(create("usr_b", key)).rejects.toMatchObject({ code: "IPB-PORT-004" });
    expect((await create("usr_a", key)).replayed).toBe(true);
  });

  it("a key does not replay across two resources of one route", async () => {
    const key = uuid7(9003);
    await create("usr_a", key, { id: "br_1" });
    await expect(create("usr_a", key, { id: "br_2" })).rejects.toMatchObject({
      code: "IPB-PORT-004",
    });
    // Without parameters the hash is unchanged from earlier releases.
    expect(idempotencyRequestHash("POST", "r", { a: 1 }, { params: {} })).toBe(
      idempotencyRequestHash("POST", "r", { a: 1 }),
    );
  });
});
