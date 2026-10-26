// PgIdempotencyStore on PostgreSQL 18 with every platform migration applied, connectors included.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localTenantKeyId } from "@infrabyx/crypto";
import { FieldCrypto } from "@infrabyx/tenancy";
import { fakeKms, startPostgres, withTenant, type TestDatabase } from "@infrabyx/testing";
import {
  PgIdempotencyStore,
  runIdempotent,
  sealerFromFieldCrypto,
  type IdempotencyRequest,
} from "../core/idempotency.js";

let db: TestDatabase;
beforeAll(async () => {
  db = await startPostgres();
  await db.admin.query(
    "insert into tenancy.tenant (id, product, name) values ('tnt_a', 'LD', 'A'), ('tnt_b', 'LD', 'B')",
  );
});
afterAll(async () => db?.end());

const req = (over: Partial<IdempotencyRequest> = {}): IdempotencyRequest => ({
  port: "PAYMENTS",
  adapter: "razorpay",
  operation: "refund",
  key: "refund-key-1",
  request: { paymentId: "pay_1", amountMinor: 500 },
  dataClass: "REGULATED",
  money: true,
  ...over,
});

const store = (tenant: string) =>
  new PgIdempotencyStore({
    kernel: db.kernel,
    audit: db.audit,
    context: () => withTenant(tenant),
    sealer: sealerFromFieldCrypto(new FieldCrypto({ kms: fakeKms(), keyIdFor: localTenantKeyId })),
  });

describe("connectors.idempotency_record (plan §3.5, @NN-01, @NN-45)", () => {
  it("writes pending before the call, seals a REGULATED result, and replays it", async () => {
    const s = store("tnt_a");
    let calls = 0;
    const call = async () => ({ refundId: "rfnd_1", n: ++calls });
    expect(await runIdempotent({ store: s, req: req(), call })).toEqual({
      refundId: "rfnd_1",
      n: 1,
    });
    expect(await runIdempotent({ store: s, req: req(), call })).toEqual({
      refundId: "rfnd_1",
      n: 1,
    });
    expect(calls).toBe(1);
    const row = (
      await db.admin.query(
        "select status, result, result_sealed, key_hash from connectors.idempotency_record",
      )
    ).rows[0];
    expect(row.status).toBe("succeeded");
    expect(row.result).toBeNull();
    expect(JSON.stringify(row.result_sealed)).not.toContain("rfnd_1");
    expect(row.key_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("@NN-45 each reserve and settle writes an audit entry; the ledger holds no payload", async () => {
    const actions = (
      await db.admin.query("select action from audit.ledger where tenant_id = 'tnt_a' order by seq")
    ).rows.map((r) => r.action as string);
    expect(actions).toEqual([
      "connectors.idempotency.reserve",
      "connectors.idempotency.succeeded",
      "connectors.idempotency.replay",
    ]);
    const after = JSON.stringify(
      (await db.admin.query("select * from audit.ledger where tenant_id = 'tnt_a'")).rows,
    );
    expect(after).not.toContain("pay_1");
    expect(after).not.toContain("refund-key-1");
  });

  it("@NN-01 another tenant neither sees the record nor collides with its key", async () => {
    const b = store("tnt_b");
    expect(
      await db.kernel.read(withTenant("tnt_b"), (tx) =>
        tx.query("select * from connectors.idempotency_record"),
      ),
    ).toMatchObject({ rowCount: 0 });
    expect(
      await runIdempotent({ store: b, req: req(), call: async () => ({ refundId: "rfnd_b" }) }),
    ).toEqual({ refundId: "rfnd_b" });
  });

  it("an unknown money outcome stays pending, is never re-sent, and is kept by the purge", async () => {
    const s = store("tnt_a");
    const r = req({ key: "refund-key-2" });
    await expect(
      runIdempotent({ store: s, req: r, call: () => Promise.reject(new Error("socket hang up")) }),
    ).rejects.toThrow();
    let calls = 0;
    await expect(
      runIdempotent({ store: s, req: r, call: async () => ++calls }),
    ).rejects.toMatchObject({ code: "IPB-PORT-002" });
    expect(calls).toBe(0);
    await db.admin.query(
      "update connectors.idempotency_record set expires_at = now() - interval '1 day'",
    );
    expect(await s.purgeExpired()).toBe(1); // the settled refund goes; the pending one stays
    const left = (
      await db.admin.query(
        "select status from connectors.idempotency_record where tenant_id = 'tnt_a'",
      )
    ).rows;
    expect(left).toEqual([{ status: "pending" }]);
  });

  it("a different request with the same key is IPB-PORT-004", async () => {
    await expect(
      runIdempotent({
        store: store("tnt_a"),
        req: req({ key: "refund-key-2", request: { other: true } }),
        call: async () => 1,
      }),
    ).rejects.toMatchObject({ code: "IPB-PORT-004" });
  });
});
