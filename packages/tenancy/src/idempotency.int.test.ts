// Inbound idempotency (IPB-10-07; PR-FBX-10 item 4; R1-D-27; tenancy/0008) on PostgreSQL: a key
// runs its work once, a replay returns the stored response, another body or a key still running is
// refused, a failed request stores nothing, keys are per tenant, and only expired keys are deleted.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuditEntryInput, AuditSink, KernelContext, Tx } from "@infrabyx/contracts/kernel";
import {
  IdempotencyExpiry,
  idempotencyRequestHash,
  idempotent,
  parseIdempotencyKey,
} from "./idempotency.js";
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
const user = (tenantId = "tnt_a"): KernelContext => ({
  tenantId,
  principal: { id: "usr_a", type: "user", roles: ["ORG_USER"] },
});
// UUIDv7 fixtures (IPB-10-07 asks for v7), built so no literal reads as a credential.
const uuid7 = (tail: number) => `01890a5d-ac96-774b-bcce-b302099a${tail}`;
const KEY = uuid7(8057);
const req = (body: unknown, key = KEY) => ({
  key,
  route: "POST /v1/loans",
  requestHash: idempotencyRequestHash("POST", "POST /v1/loans", body),
  requestId: "req-1",
});

beforeAll(async () => {
  db = await freshDb();
  kernel = new PgKernel({ pool: db.pool });
  await db.admin.query(
    "insert into tenancy.tenant (id, product, name) values ('tnt_a', 'FBX', 'A'), ('tnt_b', 'FBX', 'B')",
  );
});
afterAll(async () => db?.end());

let runs = 0;
const createLoan = (c: KernelContext, body: unknown, key = KEY) =>
  kernel.mutate(c, (tx) =>
    idempotent(
      tx,
      req(body, key),
      async () => {
        runs++;
        await audit.record(tx, {
          action: "loans.loan.create",
          resourceType: "loan",
          resourceId: "l1",
        });
        return { status: 201, body: { id: `loan_${runs}` } };
      },
      { audit },
    ),
  );

describe("@IPB-10-07 inbound idempotency (R1-D-27)", () => {
  it("runs the work once; an identical replay returns the stored response and the first request id", async () => {
    const first = await createLoan(user(), { amount: 100 });
    expect(first).toEqual({ status: 201, body: { id: "loan_1" }, replayed: false });
    const again = await createLoan(user(), { amount: 100 });
    expect(again).toEqual({
      status: 201,
      body: { id: "loan_1" },
      replayed: true,
      originalRequestId: "req-1",
    });
    expect(runs).toBe(1);
    // Key order in the body does not change the hash.
    expect(idempotencyRequestHash("post", "r", { a: 1, b: 2 })).toBe(
      idempotencyRequestHash("POST", "r", { b: 2, a: 1 }),
    );
  });

  it("another body under the same key is 409 IPB-PORT-004; keys are per tenant", async () => {
    await expect(createLoan(user(), { amount: 999 })).rejects.toMatchObject({
      code: "IPB-PORT-004",
    });
    expect((await createLoan(user("tnt_b"), { amount: 999 })).replayed).toBe(false);
  });

  it("a key whose first request is still running is 409 IPB-API-011", async () => {
    const key = uuid7(8058);
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let started!: () => void;
    const begun = new Promise<void>((r) => (started = r));
    const slow = kernel.mutate(user(), (tx) =>
      idempotent(
        tx,
        req({ n: 1 }, key),
        async () => {
          started();
          await held;
          await audit.record(tx, {
            action: "loans.loan.create",
            resourceType: "loan",
            resourceId: "l2",
          });
          return { status: 201, body: { id: "slow" } };
        },
        { audit },
      ),
    );
    await begun;
    await expect(createLoan(user(), { n: 1 }, key)).rejects.toMatchObject({ code: "IPB-API-011" });
    release();
    expect((await slow).body).toEqual({ id: "slow" });
    expect((await createLoan(user(), { n: 1 }, key)).replayed).toBe(true);
  });

  it("a request that fails stores nothing, so a retry runs the work", async () => {
    const key = uuid7(8059);
    await expect(
      kernel.mutate(user(), (tx) =>
        idempotent(
          tx,
          req({ x: 1 }, key),
          async () => {
            throw new Error("downstream failed");
          },
          { audit },
        ),
      ),
    ).rejects.toThrow("downstream failed");
    const before = runs;
    expect((await createLoan(user(), { x: 1 }, key)).replayed).toBe(false);
    expect(runs).toBe(before + 1);
  });

  it("a missing or non-UUIDv7 key is 400 IPB-API-010", () => {
    expect(() => parseIdempotencyKey(undefined)).toThrow(
      expect.objectContaining({ code: "IPB-API-010" }),
    );
    expect(() => parseIdempotencyKey("not-a-uuid")).toThrow(
      expect.objectContaining({ code: "IPB-API-010" }),
    );
    // UUIDv4 is refused: IPB-10 asks for v7.
    expect(() => parseIdempotencyKey("0f8fad5b-d9cb-469f-a165-70867728950e")).toThrow(
      expect.objectContaining({ code: "IPB-API-010" }),
    );
    expect(parseIdempotencyKey(` ${KEY.toUpperCase()} `)).toBe(KEY);
  });

  it("only expired keys are deleted, by the expiry job or by anyone", async () => {
    const expiry = new IdempotencyExpiry({ kernel, audit });
    expect(await expiry.purgeTenant(user())).toBe(0);
    // A live key cannot be deleted, whatever the caller asks.
    await kernel.mutate(user(), async (tx) => {
      const r = await tx.query("delete from tenancy.idempotency_key");
      expect(r.rowCount).toBe(0);
      await audit.record(tx, { action: "test.delete.try", resourceType: "x", resourceId: "x" });
    });
    await db.admin.query(
      "update tenancy.idempotency_key set created_at = created_at - interval '2 days', expires_at = expires_at - interval '2 days' where tenant_id = 'tnt_a' and key = $1",
      [KEY],
    );
    expect(await expiry.purgeTenant(user())).toBe(1);
    expect(audit.actions).toContain("api.idempotency.expire");
    // The key is free again.
    expect((await createLoan(user(), { amount: 5 })).replayed).toBe(false);
  });
});
