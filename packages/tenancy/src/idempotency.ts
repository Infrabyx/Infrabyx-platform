// Inbound idempotency (IPB-10-07, §10.4; Finbyx PR-FBX-10 item 4; R1-D-27). A product's POST or
// PATCH handler claims the client's `Idempotency-Key` inside the transaction that makes the change,
// with `idempotent(tx, request, work)`: the first request runs `work` and stores its status and body
// with the request's hash; an identical replay within the TTL returns the stored response
// (`replayed: true`); a replay with another body is refused (409 IPB-PORT-004); a key whose first
// request is still running is refused (409 IPB-API-011). The key, the hash and the response commit
// together with the change, so a request that fails stores nothing and may be retried.
import { IpbError } from "@infrabyx/contracts/errors";
import { UUIDV7_REGEX } from "@infrabyx/contracts/events";
import type { AuditSink, KernelContext, MutationKernel, Tx } from "@infrabyx/contracts/kernel";
import { canonicalize, sha256Hex } from "@infrabyx/crypto";

/** IPB-10 §10.4: responses are kept 24 hours at least (`int.api.idempotency_ttl_hours`). */
export const IDEMPOTENCY_TTL_FLOOR_HOURS = 24;

export interface IdempotencyRequest {
  /** The client's UUIDv7 key (`parseIdempotencyKey`). */
  key: string;
  /** Method and route template, e.g. `POST /v1/loans`. */
  route: string;
  /** `idempotencyRequestHash(method, route, body)`. */
  requestHash: string;
  /** This request's `X-Request-Id`, returned to replays as `Idempotent-Original-Request-Id`. */
  requestId?: string;
}

export interface IdempotentResult<T> {
  status: number;
  body: T;
  replayed: boolean;
  /** The first request's id, on a replay. */
  originalRequestId?: string;
}

/** The header's value, or 400 IPB-API-010 when it is missing or not a UUIDv7. */
export function parseIdempotencyKey(value: string | undefined): string {
  const v = value?.trim().toLowerCase();
  if (!v || !UUIDV7_REGEX.test(v))
    throw new IpbError("IPB-API-010", { detail: "send an Idempotency-Key header with a UUIDv7" });
  return v;
}

/** SHA-256 over the canonical method, route and body (key order does not matter). */
export function idempotencyRequestHash(method: string, route: string, body: unknown): string {
  return sha256Hex(canonicalize({ method: method.toUpperCase(), route, body: body ?? null }));
}

interface Row {
  route: string;
  request_hash: string;
  request_id: string | null;
  response_status: number;
  response_body: unknown;
  expired: boolean;
}

/**
 * Run `work` once per key: inside the caller's mutation transaction, before the change. The work's
 * own writes and ledger entries are the transaction's; this adds the key row, and on a replay a
 * ledger entry of its own.
 */
export async function idempotent<T>(
  tx: Tx,
  req: IdempotencyRequest,
  work: () => Promise<{ status: number; body: T }>,
  o: {
    /** Records each replay (`api.idempotency.replay`): the transaction writes nothing else then. */
    audit: AuditSink;
    ttlHours?: number;
  },
): Promise<IdempotentResult<T>> {
  const key = parseIdempotencyKey(req.key);
  const ttl = Math.max(o.ttlHours ?? IDEMPOTENCY_TTL_FLOOR_HOURS, IDEMPOTENCY_TTL_FLOOR_HOURS);
  if (!/^[0-9a-f]{64}$/.test(req.requestHash)) throw new RangeError("requestHash is a SHA-256 hex");
  // One request per key at a time: a second one while the first runs is refused, not queued.
  const lock = await tx.query<{ ok: boolean }>(
    "select pg_try_advisory_xact_lock(hashtextextended($1, 0)) as ok",
    [`ipb-idem:${tx.ctx.tenantId}:${key}`],
  );
  if (!lock.rows[0]?.ok)
    throw new IpbError("IPB-API-011", {
      detail: "the first request with this key is still running",
    });
  const found = (
    await tx.query<Row>(
      `select route, request_hash, request_id, response_status, response_body,
              expires_at < now() as expired
         from tenancy.idempotency_key where key = $1`,
      [key],
    )
  ).rows[0];
  if (found && !found.expired) {
    if (found.request_hash !== req.requestHash || found.route !== req.route)
      throw new IpbError("IPB-PORT-004", {
        detail: "this Idempotency-Key was used with another request",
      });
    await o.audit.record(tx, {
      action: "api.idempotency.replay",
      resourceType: "api.idempotency_key",
      resourceId: key,
      after: { route: req.route, status: found.response_status },
    });
    return {
      status: found.response_status,
      body: found.response_body as T,
      replayed: true,
      ...(found.request_id ? { originalRequestId: found.request_id } : {}),
    };
  }
  if (found) await tx.query("delete from tenancy.idempotency_key where key = $1", [key]);
  const out = await work();
  await tx.query(
    `insert into tenancy.idempotency_key
       (tenant_id, key, route, request_hash, request_id, response_status, response_body, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, now() + make_interval(hours => $8))`,
    [
      tx.ctx.tenantId,
      key,
      req.route,
      req.requestHash,
      req.requestId ?? null,
      out.status,
      out.body === undefined ? null : JSON.stringify(out.body),
      ttl,
    ],
  );
  return { ...out, replayed: false };
}

/** The per-tenant expiry job (daily through `TenantSweep`): deletes expired keys in batches. */
export class IdempotencyExpiry {
  constructor(
    private readonly o: {
      kernel: MutationKernel;
      audit: AuditSink;
      batch?: number;
    },
  ) {}

  async purgeTenant(ctx: KernelContext): Promise<number> {
    const batch = Math.min(this.o.batch ?? 1000, 10_000);
    let total = 0;
    for (;;) {
      const n = await this.o.kernel.mutate(
        ctx,
        async (tx) => {
          const r = await tx.query<{ key: string }>(
            `delete from tenancy.idempotency_key where key in (
               select key from tenancy.idempotency_key where expires_at < now()
                order by expires_at limit $1)
             returning key`,
            [batch],
          );
          await this.o.audit.record(tx, {
            action: "api.idempotency.expire",
            resourceType: "api.idempotency_key",
            resourceId: "expired",
            after: { deleted: r.rows.length },
          });
          return r.rows.length;
        },
        { action: "api.idempotency.expire" },
      );
      total += n;
      if (n < batch) return total;
    }
  }

  sweep(sweep: { run<T>(job: (ctx: KernelContext) => Promise<T>): Promise<unknown> }) {
    return sweep.run((ctx) => this.purgeTenant(ctx));
  }
}
