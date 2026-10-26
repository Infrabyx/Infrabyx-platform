// PgRevocationStore on PostgreSQL 18 with every platform migration applied (IPB-02-05,
// PL2-D-53): revocations are tenant-scoped under RLS, written with a ledger entry, and seen by
// another replica within one cache refresh.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startPostgres, withTenant, type TestDatabase } from "@infrabyx/testing";
import { PgRevocationStore } from "../identity/common.js";

let db: TestDatabase;
beforeAll(async () => {
  db = await startPostgres();
  await db.admin.query(
    "insert into tenancy.tenant (id, product, name) values ('tnt_a', 'LD', 'A'), ('tnt_b', 'LD', 'B')",
  );
});
afterAll(async () => db?.end());

const store = (now: () => number) =>
  new PgRevocationStore({
    kernel: db.kernel,
    audit: db.audit,
    context: (tenant) => withTenant(tenant),
    now,
  });

const claims = (over: Partial<{ tid: string; sub: string; sid: string; iat: number }> = {}) => ({
  tid: "tnt_a",
  sub: "u-1",
  sid: "s-1",
  iat: Math.floor(Date.now() / 1000) - 5,
  ...over,
});

describe("PgRevocationStore", () => {
  it("a revocation on one replica is seen by another within one refresh", async () => {
    let t = 0;
    const writer = store(() => Date.now());
    const reader = store(() => t);
    expect(await reader.isRevoked(claims())).toBe(false);
    await writer.revoke("tnt_a", "session", "s-1", new Date(), "logout");
    // Cached for up to 15 s on the reader …
    t += 14_000;
    expect(await reader.isRevoked(claims())).toBe(false);
    // … then refreshed.
    t += 1_001;
    expect(await reader.isRevoked(claims())).toBe(true);
    expect(await writer.isRevoked(claims({ sid: "s-2" }))).toBe(false);
  });

  it("user revocations refuse older tokens only, per tenant", async () => {
    const s = store(() => Date.now());
    await s.revoke("tnt_a", "user", "u-9", new Date(), "scim_deactivate");
    expect(await s.isRevoked(claims({ sub: "u-9", sid: "x" }))).toBe(true);
    expect(await s.isRevoked(claims({ sub: "u-9", sid: "x", tid: "tnt_b" }))).toBe(false);
    expect(
      await s.isRevoked(claims({ sub: "u-9", sid: "x", iat: Math.floor(Date.now() / 1000) + 2 })),
    ).toBe(false);
  });

  it("stores hashes only, under RLS, with a ledger entry per revocation", async () => {
    await store(() => Date.now()).revoke(
      "tnt_b",
      "user",
      "person@example.test",
      new Date(),
      "security",
    );
    const rows = await db.admin.query<{ tenant_id: string; subject_hash: string }>(
      "select tenant_id, subject_hash from connectors.session_revocation where tenant_id = 'tnt_b'",
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]!.subject_hash).toMatch(/^[0-9a-f]{64}$/);
    const seen = await db.kernel.read(withTenant("tnt_a"), (tx) =>
      tx.query("select 1 from connectors.session_revocation where tenant_id = 'tnt_b'"),
    );
    expect(seen.rows).toHaveLength(0);
    const ledger = await db.admin.query<{ n: string }>(
      "select count(*) as n from audit.ledger where action = 'identity.user.revoke' and tenant_id = 'tnt_b'",
    );
    expect(Number(ledger.rows[0]!.n)).toBe(1);
  });
});
