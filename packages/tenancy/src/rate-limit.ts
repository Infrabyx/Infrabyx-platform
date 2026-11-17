// The shared rate limiter (LawDocsComply PR-LDC-54; IPB-02 abuse controls; R1-D-123, R1-D-149).
//
// `RateLimiter.hit(ctx, bucket, key, { limit, windowSeconds })` counts one hit in a fixed window
// shared by every pod (PostgreSQL, `tenancy.rate_limit_counter`). The key (a token, an address,
// a client id) is never stored: the row holds the HMAC-SHA-256 of the bucket and the key under the
// tenant's rate-limit sub-key of the product's blind-index root (PL1-C-05, R1-D-37; no new
// cryptography). A hit writes no ledger row: it runs in its own short transaction as
// `svc_rate_limit`, a role that may only select, insert and update the counter table under the
// tenant's RLS, so the path can change nothing else. The window is the database's clock, aligned
// to the window length, so every pod agrees on it.
//
// `RateLimitSweep` is the one deletion the owner allowed for counters (answer #129, R1-D-144): it
// deletes only rows whose window has fully ended (the database also refuses any other delete) and
// writes one summary ledger entry per run (rows deleted and the range of window ends), never one
// per row. Run it per tenant through `TenantSweep`.
import { IpbError } from "@infrabyx/contracts/errors";
import { TENANT_ID_REGEX } from "@infrabyx/contracts/ids";
import type { AuditSink, KernelContext, MutationKernel } from "@infrabyx/contracts/kernel";
import { blindIndex, tenantBlindIndexKey, type BlindIndexRoot } from "@infrabyx/crypto";
import type { SecretKey } from "@infrabyx/crypto";
import type { PoolLike } from "./kernel.js";

/** The database role a hit runs as (tenancy/0024). */
export const RATE_LIMIT_DB_ROLE = "svc_rate_limit";
/** The blind-index scope of rate-limit key hashes. */
export const RATE_LIMIT_INDEX_SCOPE = "rate_limit";

const BUCKET = /^[a-z][a-z0-9_.:-]{0,63}$/;
const MAX_KEY_LENGTH = 1024;
const MAX_LIMIT = 1_000_000;
const MAX_WINDOW_SECONDS = 86_400;

export interface RateLimitRule {
  /** Hits allowed per window (1 to 1,000,000); read it from a setting the product registers. */
  limit: number;
  /** The window length in seconds (1 to 86,400). */
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  /** Hits left in this window (0 once the limit is reached). */
  remaining: number;
  /** When this window ends (ISO 8601, UTC). */
  resetAt: string;
  /** Seconds until the window ends, at least 1 (the `Retry-After` value when refused). */
  retryAfterSeconds: number;
}

export interface RateLimiterOptions {
  pool: PoolLike;
  /** The product code the blind-index root belongs to (lower case, as for `BlindIndexer`). */
  product: string;
  /** The product's blind-index root (`loadBlindIndexRoot`; `localBlindIndexRoot` below staging). */
  root: BlindIndexRoot;
  /** Most tenant sub-keys kept in memory (default 10,000). */
  maxCachedKeys?: number;
}

function assertRule(rule: RateLimitRule): void {
  if (!Number.isInteger(rule.limit) || rule.limit < 1 || rule.limit > MAX_LIMIT)
    throw new RangeError(`a rate limit is an integer from 1 to ${MAX_LIMIT}`);
  if (
    !Number.isInteger(rule.windowSeconds) ||
    rule.windowSeconds < 1 ||
    rule.windowSeconds > MAX_WINDOW_SECONDS
  )
    throw new RangeError(`a rate-limit window is 1 to ${MAX_WINDOW_SECONDS} whole seconds`);
}

export class RateLimiter {
  private readonly keys = new Map<string, SecretKey>();

  constructor(private readonly o: RateLimiterOptions) {
    // Fails at construction for a bad product code or root version, not on the first hit.
    tenantBlindIndexKey(o.root, {
      product: o.product,
      scope: RATE_LIMIT_INDEX_SCOPE,
      tenantId: "tnt_check",
    });
  }

  /** The stored hash of a key: the tenant's sub-key over `<bucket>\0<key>`, as given (no folding). */
  keyHash(tenantId: string, bucket: string, key: string): string {
    let k = this.keys.get(tenantId);
    if (!k) {
      k = tenantBlindIndexKey(this.o.root, {
        product: this.o.product,
        scope: RATE_LIMIT_INDEX_SCOPE,
        tenantId,
      });
      if (this.keys.size >= (this.o.maxCachedKeys ?? 10_000)) {
        const oldest = this.keys.keys().next().value;
        if (oldest !== undefined) this.keys.delete(oldest);
      }
      this.keys.set(tenantId, k);
    }
    return blindIndex(k, `${bucket}\0${key}`, (v) => v);
  }

  /** Count one hit for `key` in `bucket`; `allowed` is false once the window's limit is passed. */
  async hit(
    ctx: Pick<KernelContext, "tenantId">,
    bucket: string,
    key: string,
    rule: RateLimitRule,
  ): Promise<RateLimitResult> {
    if (!TENANT_ID_REGEX.test(ctx.tenantId)) throw new RangeError("invalid tenant id");
    if (!BUCKET.test(bucket))
      throw new RangeError("a rate-limit bucket is 1 to 64 of a-z 0-9 _ . : - starting a-z");
    if (typeof key !== "string" || key.length < 1 || key.length > MAX_KEY_LENGTH)
      throw new RangeError(`a rate-limit key has 1 to ${MAX_KEY_LENGTH} characters`);
    assertRule(rule);
    const hash = this.keyHash(ctx.tenantId, bucket, key);
    const client = await this.o.pool.connect();
    let done = false;
    try {
      await client.query("begin");
      await client.query(`set local role ${RATE_LIMIT_DB_ROLE}`);
      await client.query("select set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
      const r = await client.query<{ hits: number; window_end: Date; now: Date }>(
        `with w as (
           select to_timestamp(floor(extract(epoch from now()) / $3::int) * $3::int) as start)
         insert into tenancy.rate_limit_counter as c
           (tenant_id, bucket, key_hash, window_start, window_end, hits)
         select current_setting('app.tenant_id', true), $1, $2, w.start,
                w.start + make_interval(secs => $3::int), 1
           from w
         on conflict (tenant_id, bucket, key_hash, window_start)
           do update set hits = least(c.hits + 1, $4::int + 1)
         returning c.hits, c.window_end, now() as now`,
        [bucket, hash, rule.windowSeconds, rule.limit],
      );
      await client.query("commit");
      done = true;
      const row = r.rows[0];
      if (!row) throw new Error("rate limit: no counter row returned");
      const hits = Number(row.hits);
      const end = new Date(row.window_end);
      return {
        allowed: hits <= rule.limit,
        limit: rule.limit,
        remaining: Math.max(0, rule.limit - hits),
        resetAt: end.toISOString(),
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((end.getTime() - new Date(row.now).getTime()) / 1000),
        ),
      };
    } finally {
      if (!done) await client.query("rollback").catch(() => undefined);
      client.release();
    }
  }

  /** As `hit`, but throws 429 `IPB-SEC-019` (with `retry_after`) when the hit is refused. */
  async consume(
    ctx: Pick<KernelContext, "tenantId">,
    bucket: string,
    key: string,
    rule: RateLimitRule,
  ): Promise<RateLimitResult> {
    const r = await this.hit(ctx, bucket, key, rule);
    if (!r.allowed) throw rateLimitError(r);
    return r;
  }
}

/** 429 `IPB-SEC-019`; send `Retry-After: meta.retry_after` (`rateLimitHeaders`). */
export function rateLimitError(r: RateLimitResult): IpbError {
  return new IpbError("IPB-SEC-019", {
    detail: "too many requests; retry after the window ends",
    meta: { retry_after: r.retryAfterSeconds, limit: r.limit, reset_at: r.resetAt },
  });
}

/** The response headers for a limited route: `Retry-After` when refused, and the window's state. */
export function rateLimitHeaders(r: RateLimitResult): Record<string, string> {
  const h: Record<string, string> = {
    "RateLimit-Limit": String(r.limit),
    "RateLimit-Remaining": String(r.remaining),
    "RateLimit-Reset": String(r.retryAfterSeconds),
  };
  if (!r.allowed) h["Retry-After"] = String(r.retryAfterSeconds);
  return h;
}

export interface RateLimitSweepResult {
  deleted: number;
  /** The earliest and latest window end deleted (ISO 8601), or null when nothing was. */
  oldestWindowEnd: string | null;
  newestWindowEnd: string | null;
}

/**
 * The expired-window sweep (owner answer #129): in one transaction per tenant and run, deletes up
 * to `maxRows` counter rows whose window ended at or before the sweep's start, in batches, and
 * writes one ledger entry with the count and the range of window ends. Rows left over (more than
 * `maxRows`) go in the next run. Daily through `TenantSweep` is enough for windows of a day or less.
 */
export class RateLimitSweep {
  constructor(
    private readonly o: {
      kernel: MutationKernel;
      audit: AuditSink;
      /** Rows per delete statement (default 1,000, at most 10,000). */
      batch?: number;
      /** Rows per run and tenant (default 100,000, at most 1,000,000). */
      maxRows?: number;
    },
  ) {}

  async purgeTenant(ctx: KernelContext): Promise<RateLimitSweepResult> {
    const batch = Math.max(1, Math.min(this.o.batch ?? 1000, 10_000));
    const maxRows = Math.max(1, Math.min(this.o.maxRows ?? 100_000, 1_000_000));
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        let deleted = 0;
        let oldest: Date | null = null;
        let newest: Date | null = null;
        while (deleted < maxRows) {
          const r = await tx.query<{ oldest: Date | null; newest: Date | null; n: string }>(
            `with gone as (
               delete from tenancy.rate_limit_counter
                where (tenant_id, bucket, key_hash, window_start) in (
                  select tenant_id, bucket, key_hash, window_start
                    from tenancy.rate_limit_counter
                   where window_end <= now()
                   order by window_end
                   limit $1)
               returning window_end)
             select min(window_end) as oldest, max(window_end) as newest, count(*) as n from gone`,
            [Math.min(batch, maxRows - deleted)],
          );
          const row = r.rows[0];
          const n = Number(row?.n ?? 0);
          if (n > 0 && row?.oldest && row.newest) {
            const a = new Date(row.oldest);
            const b = new Date(row.newest);
            if (!oldest || a < oldest) oldest = a;
            if (!newest || b > newest) newest = b;
          }
          deleted += n;
          if (n < batch) break;
        }
        const result: RateLimitSweepResult = {
          deleted,
          oldestWindowEnd: oldest?.toISOString() ?? null,
          newestWindowEnd: newest?.toISOString() ?? null,
        };
        await this.o.audit.record(tx, {
          action: "tenancy.rate_limit.sweep",
          resourceType: "tenancy.rate_limit_counter",
          resourceId: "expired",
          after: {
            deleted: result.deleted,
            oldest_window_end: result.oldestWindowEnd,
            newest_window_end: result.newestWindowEnd,
          },
        });
        return result;
      },
      { action: "tenancy.rate_limit.sweep" },
    );
  }

  sweep(sweep: { run<T>(job: (ctx: KernelContext) => Promise<T>): Promise<unknown> }) {
    return sweep.run((ctx) => this.purgeTenant(ctx));
  }
}
