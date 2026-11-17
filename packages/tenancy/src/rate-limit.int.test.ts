// The shared rate limiter (PR-LDC-54; R1-D-123, R1-D-149; tenancy/0024) on PostgreSQL: hits are
// counted across limiter instances (pods) per tenant, bucket, key and window; keys are stored only
// as keyed hashes; a hit writes no ledger row and its role can change nothing else; the sweep
// deletes only rows whose window has ended (owner answer #129) with one ledger entry per run.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuditEntryInput, AuditSink, KernelContext, Tx } from "@infrabyx/contracts/kernel";
import { localBlindIndexRoot } from "@infrabyx/crypto";
import { PgKernel } from "./kernel.js";
import {
  RATE_LIMIT_DB_ROLE,
  RateLimiter,
  RateLimitSweep,
  rateLimitError,
  rateLimitHeaders,
} from "./rate-limit.js";
import { freshDb, type TestDb } from "./__tests__/pg.js";

class RecordingAudit implements AuditSink {
  readonly entries: AuditEntryInput[] = [];
  async record(tx: Tx, e: AuditEntryInput): Promise<{ id: string }> {
    this.entries.push(e);
    tx.markAudited();
    return { id: "led_x" };
  }
}

let db: TestDb;
let kernel: PgKernel;
const audit = new RecordingAudit();
const job = (tenantId = "tnt_a"): KernelContext => ({
  tenantId,
  principal: { id: "svc_tenant_job", type: "service", roles: ["SVC_TENANT_JOB"] },
});
const TOKEN = ["pub", "lic", "read", "abc123"].join("-");
const rule = { limit: 3, windowSeconds: 3600 };

beforeAll(async () => {
  db = await freshDb();
  kernel = new PgKernel({ pool: db.pool });
  await db.admin.query(
    "insert into tenancy.tenant (id, product, name) values ('tnt_a', 'LDC', 'A'), ('tnt_b', 'LDC', 'B')",
  );
});
afterAll(async () => db?.end());

const limiter = () =>
  new RateLimiter({ pool: db.pool, product: "ldc", root: localBlindIndexRoot() });

describe("@IPB-02 shared rate limiter (PR-LDC-54)", () => {
  it("counts across instances, per tenant, bucket and key; refuses past the limit with 429", async () => {
    const a = limiter();
    const b = limiter();
    const r1 = await a.hit({ tenantId: "tnt_a" }, "ldc.public_read", TOKEN, rule);
    expect(r1).toMatchObject({ allowed: true, limit: 3, remaining: 2 });
    expect(r1.retryAfterSeconds).toBeGreaterThan(0);
    expect((await b.hit({ tenantId: "tnt_a" }, "ldc.public_read", TOKEN, rule)).remaining).toBe(1);
    expect((await a.hit({ tenantId: "tnt_a" }, "ldc.public_read", TOKEN, rule)).remaining).toBe(0);
    const over = await b.hit({ tenantId: "tnt_a" }, "ldc.public_read", TOKEN, rule);
    expect(over.allowed).toBe(false);
    expect(rateLimitHeaders(over)["Retry-After"]).toBe(String(over.retryAfterSeconds));
    expect(rateLimitError(over)).toMatchObject({ code: "IPB-SEC-019" });
    await expect(
      a.consume({ tenantId: "tnt_a" }, "ldc.public_read", TOKEN, rule),
    ).rejects.toMatchObject({ code: "IPB-SEC-019" });
    // Another key, bucket or tenant has its own counter.
    expect((await a.hit({ tenantId: "tnt_a" }, "ldc.public_read", `${TOKEN}x`, rule)).allowed).toBe(
      true,
    );
    expect((await a.hit({ tenantId: "tnt_a" }, "ldc.other", TOKEN, rule)).allowed).toBe(true);
    expect((await a.hit({ tenantId: "tnt_b" }, "ldc.public_read", TOKEN, rule)).allowed).toBe(true);
    // Hits past the limit are capped, not counted without bound.
    const c = await db.admin.query<{ hits: number }>(
      "select hits from tenancy.rate_limit_counter where tenant_id = 'tnt_a' and bucket = 'ldc.public_read' order by hits desc limit 1",
    );
    expect(c.rows[0]?.hits).toBe(4);
  });

  it("stores no key, only a 64-hex keyed hash that differs by tenant; writes no ledger row", async () => {
    const all = await db.admin.query<{ key_hash: string; tenant_id: string; bucket: string }>(
      "select tenant_id, bucket, key_hash from tenancy.rate_limit_counter",
    );
    expect(JSON.stringify(all.rows)).not.toContain("abc123");
    for (const r of all.rows) expect(r.key_hash).toMatch(/^[0-9a-f]{64}$/);
    const l = limiter();
    expect(l.keyHash("tnt_a", "ldc.public_read", TOKEN)).not.toBe(
      l.keyHash("tnt_b", "ldc.public_read", TOKEN),
    );
    // Case matters: keys are hashed as given.
    expect(l.keyHash("tnt_a", "b", "Ab")).not.toBe(l.keyHash("tnt_a", "b", "AB"));
    expect(audit.entries).toHaveLength(0);
  });

  it("refuses bad input before any database call", async () => {
    const l = limiter();
    await expect(l.hit({ tenantId: "tnt_a" }, "Bad Bucket", "k", rule)).rejects.toThrow(RangeError);
    await expect(l.hit({ tenantId: "tnt_a" }, "b", "", rule)).rejects.toThrow(RangeError);
    await expect(
      l.hit({ tenantId: "tnt_a" }, "b", "k", { limit: 0, windowSeconds: 60 }),
    ).rejects.toThrow(RangeError);
    await expect(
      l.hit({ tenantId: "tnt_a" }, "b", "k", { limit: 1, windowSeconds: 86_401 }),
    ).rejects.toThrow(RangeError);
    await expect(l.hit({ tenantId: "not a tenant" }, "b", "k", rule)).rejects.toThrow(RangeError);
  });

  it("the hit role can only count: no delete, no other table, no other tenant", async () => {
    const c = await db.pool.connect();
    try {
      await c.query("begin");
      await c.query(`set local role ${RATE_LIMIT_DB_ROLE}`);
      await c.query("select set_config('app.tenant_id', 'tnt_a', true)");
      const seen = await c.query("select tenant_id from tenancy.rate_limit_counter");
      expect(seen.rows.every((r: { tenant_id: string }) => r.tenant_id === "tnt_a")).toBe(true);
      await expect(c.query("delete from tenancy.rate_limit_counter")).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await c.query("rollback");
      c.release();
    }
    const d = await db.pool.connect();
    try {
      await d.query("begin");
      await d.query(`set local role ${RATE_LIMIT_DB_ROLE}`);
      await expect(d.query("select id from tenancy.tenant")).rejects.toThrow(/permission denied/);
    } finally {
      await d.query("rollback");
      d.release();
    }
  });

  it("@owner-129 the sweep deletes only fully expired windows, one ledger entry per run", async () => {
    const sweep = new RateLimitSweep({ kernel, audit, batch: 2 });
    // Nothing has expired yet: nothing deleted, one entry still written for the run.
    expect(await sweep.purgeTenant(job())).toEqual({
      deleted: 0,
      oldestWindowEnd: null,
      newestWindowEnd: null,
    });
    // A live window cannot be deleted by anyone through app_rw.
    await kernel.mutate(job(), async (tx) => {
      const r = await tx.query("delete from tenancy.rate_limit_counter");
      expect(r.rowCount).toBe(0);
      await audit.record(tx, { action: "test.delete.try", resourceType: "x", resourceId: "x" });
    });
    // Age tnt_a's rows by two hours: their one-hour windows have ended.
    await db.admin.query(
      "update tenancy.rate_limit_counter set window_start = window_start - interval '2 hours', window_end = window_end - interval '2 hours' where tenant_id = 'tnt_a'",
    );
    const before = audit.entries.length;
    const r = await sweep.purgeTenant(job());
    expect(r.deleted).toBe(3);
    expect(r.oldestWindowEnd).not.toBeNull();
    const entries = audit.entries.slice(before);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: "tenancy.rate_limit.sweep",
      after: {
        deleted: 3,
        oldest_window_end: r.oldestWindowEnd,
        newest_window_end: r.newestWindowEnd,
      },
    });
    // tnt_b's live row is untouched.
    const left = await db.admin.query("select tenant_id from tenancy.rate_limit_counter");
    expect(left.rows).toEqual([{ tenant_id: "tnt_b" }]);
    // A fresh window starts at one hit again.
    expect(
      (await limiter().hit({ tenantId: "tnt_a" }, "ldc.public_read", TOKEN, rule)).remaining,
    ).toBe(2);
  });
});
