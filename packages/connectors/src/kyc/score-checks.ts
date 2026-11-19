// Liveness and face match by mode, threshold and idempotency key (Udofin PR-UDF-044, R1-D-197;
// threat model §3.140): what the KYC adapters share. A liveness check may ask for a mode
// (`passive`, `active_gesture`, `active_voice`); an adapter that cannot honour it refuses
// `IPB-PORT-002` `mode_unsupported` (`KYC_MODE_UNSUPPORTED`, the label PR-UDF-043 introduced) before
// any vendor call and never falls back to another mode. A score is a finite number from 0 to 1: an
// adapter normalises a vendor score whose scale it knows and refuses any other `IPB-PORT-003`
// `score_out_of_range`, never clamping it.
//
// A keyed check is kept, per tenant, adapter and method, so a retry gets the first answer and the
// vendor is never asked twice for one key. No image, frame, template or embedding is ever kept, and
// no storage reference in clear: the key is kept as SHA-256, and the request (the files' storage
// keys and SHA-256s, in order, and the liveness mode) as an HMAC-SHA-256 under a key derived from
// the idempotency key, which no row holds in clear (as PR-UDF-041 and -043 did). The answer kept is
// the port's (score, pass, threshold, mode, evidence). A record lives 24 hours (IPB-10-07's window,
// as #144). A check left pending by a vendor error is asked again on its retry: nothing moves.
// `PgKycScoreCheckStore` is the production store (`connectors.kyc_score_check`, migration 0013);
// `MemoryKycScoreCheckStore` serves tests and a single process.
import { PortError } from "@infrabyx/contracts/errors";
import type { AuditSink, KernelContext, MutationKernel, Tx } from "@infrabyx/contracts/kernel";
import {
  KYC_MODE_UNSUPPORTED,
  KYC_SCORE_OUT_OF_RANGE,
  kycScoreValid,
  type KycFileRef,
  type LivenessMode,
  type ScoreResult,
} from "@infrabyx/contracts/ports";
import { canonicalize, hmacSha256Hex, newId, SecretKey, sha256, sha256Hex } from "@infrabyx/crypto";

/** Hours a check record is kept (IPB-10-07). */
export const KYC_SCORE_CHECK_TTL_HOURS = 24;

/** The two scored methods; a key is scoped to its method. */
export const KYC_SCORE_METHODS = ["liveness", "face_match"] as const;
export type KycScoreMethod = (typeof KYC_SCORE_METHODS)[number];

/**
 * The mode a liveness check uses: the one asked, or `configured`. A mode the adapter does not
 * honour is refused `IPB-PORT-002` with `meta.reason: "mode_unsupported"`; the caller checks this
 * before it reads anything else or calls its vendor (as `bankAccountMode`, PR-UDF-043).
 */
export function livenessMode(
  adapter: string,
  asked: LivenessMode | undefined,
  o: { honoured: readonly LivenessMode[]; configured: LivenessMode },
): LivenessMode {
  const mode = asked ?? o.configured;
  if (!o.honoured.includes(mode))
    throw new PortError("IPB-PORT-002", "KYC", {
      adapter,
      detail: `${adapter} does not check liveness by ${mode}`,
      meta: { reason: KYC_MODE_UNSUPPORTED, definite: true },
    });
  return mode;
}

/** A threshold given to an adapter: a number from 0 to 1, else a construction error. */
export function scoreThreshold(adapter: string, t: number | undefined, fallback: number): number {
  const v = t ?? fallback;
  if (!kycScoreValid(v)) throw new RangeError(`${adapter}: a threshold is a number from 0 to 1`);
  return v;
}

export function scoreOutOfRange(adapter: string, field: string): PortError {
  return new PortError("IPB-PORT-003", "KYC", {
    adapter,
    detail: `${adapter} answered a ${field} off its known scale`,
    meta: { reason: KYC_SCORE_OUT_OF_RANGE },
  });
}

/**
 * A vendor score on a known scale (0 to `scale`) as the port's 0 to 1. Anything not a finite number
 * on that scale is refused `IPB-PORT-003` (`score_out_of_range`): never clamped, never guessed.
 */
export function scoreOnScale(adapter: string, field: string, raw: unknown, scale: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > scale)
    throw scoreOutOfRange(adapter, field);
  const score = raw / scale;
  if (!kycScoreValid(score)) throw scoreOutOfRange(adapter, field);
  return score;
}

export interface KycScoreCheckRequest {
  tenantId: string;
  /** The adapter's descriptor name; each adapter keeps its own records. */
  adapter: string;
  method: KycScoreMethod;
  idempotencyKey: string;
  /** The frames (liveness) or the two images (face match), in the order asked. */
  files: readonly KycFileRef[];
  /** Liveness only: the mode used (the configured one when the check named none). */
  mode?: LivenessMode;
}

/** What an earlier check with the same key left. */
export type KycScoreCheckReservation =
  | { kind: "new"; id: string }
  /** A check with this key started and did not finish (a crash, a time-out, a vendor error). */
  | { kind: "pending"; id: string }
  | { kind: "done"; result: ScoreResult };

export interface KycScoreCheckStore {
  /** Reserve the key, or report what an earlier call with it left; `IPB-PORT-004` on another request. */
  reserve(r: KycScoreCheckRequest): Promise<KycScoreCheckReservation>;
  /** Record the result; returns the record's (an earlier finisher's, if any). */
  complete(r: KycScoreCheckRequest, id: string, result: ScoreResult): Promise<ScoreResult>;
}

export const kycScoreKeyHash = (method: KycScoreMethod, key: string): string =>
  sha256Hex(`kyc-score-key:${method}:${key}`);

/**
 * The request's binding: HMAC-SHA-256 over the method, the files' storage keys and SHA-256s in
 * order, and the mode, under a key derived from the idempotency key. A row holds none of them in
 * clear (the key only as `kycScoreKeyHash`), so a file cannot be found by trying candidates.
 */
export function kycScoreRequestHash(r: KycScoreCheckRequest): string {
  const key = new SecretKey(
    "kyc-score-binding",
    "hmac-sha-256",
    sha256(`kyc-score-binding:${canonicalize([r.method, r.idempotencyKey])}`),
  );
  return hmacSha256Hex(
    key,
    canonicalize({
      method: r.method,
      files: r.files.map((f) => [f.storageKey, f.sha256]),
      mode: r.mode ?? null,
    }),
  );
}

export function kycScoreConflict(adapter: string, method: KycScoreMethod): PortError {
  return new PortError("IPB-PORT-004", "KYC", {
    adapter,
    detail:
      method === "liveness"
        ? "idempotency key reused with other frames or another liveness mode"
        : "idempotency key reused with other face images",
    meta: { reason: "idempotency_conflict" },
  });
}

/** Only the fields the port defines, so nothing else a vendor sent is ever kept. */
function resultOnly(r: ScoreResult): ScoreResult {
  return {
    vendorRef: r.vendorRef,
    adapter: r.adapter,
    modelVersion: r.modelVersion,
    checkedAt: r.checkedAt,
    score: r.score,
    passed: r.passed,
    ...(r.threshold !== undefined ? { threshold: r.threshold } : {}),
    ...(r.mode !== undefined ? { mode: r.mode } : {}),
  };
}

/** In-memory store for tests and a single process. */
export class MemoryKycScoreCheckStore implements KycScoreCheckStore {
  private readonly rows = new Map<
    string,
    {
      id: string;
      request: string;
      state: "pending" | "done";
      result?: ScoreResult;
      expiresAt: number;
    }
  >();
  constructor(private readonly o: { now?: () => Date; ttlHours?: number } = {}) {}
  private now(): number {
    return (this.o.now?.() ?? new Date()).getTime();
  }
  private k(r: KycScoreCheckRequest): string {
    return `${r.tenantId}|${r.adapter}|${r.method}|${kycScoreKeyHash(r.method, r.idempotencyKey)}`;
  }

  async reserve(r: KycScoreCheckRequest): Promise<KycScoreCheckReservation> {
    const row = this.rows.get(this.k(r));
    if (row && row.expiresAt > this.now()) {
      if (row.request !== kycScoreRequestHash(r)) throw kycScoreConflict(r.adapter, r.method);
      if (row.state === "done") return { kind: "done", result: structuredClone(row.result!) };
      return { kind: "pending", id: row.id };
    }
    const id = newId("ksc");
    this.rows.set(this.k(r), {
      id,
      request: kycScoreRequestHash(r),
      state: "pending",
      expiresAt: this.now() + (this.o.ttlHours ?? KYC_SCORE_CHECK_TTL_HOURS) * 3600_000,
    });
    return { kind: "new", id };
  }

  async complete(r: KycScoreCheckRequest, id: string, result: ScoreResult): Promise<ScoreResult> {
    const row = this.rows.get(this.k(r));
    if (!row || row.id !== id) return resultOnly(result);
    if (row.state === "pending") {
      row.state = "done";
      row.result = resultOnly(result);
    }
    return structuredClone(row.result!);
  }
}

export interface PgKycScoreCheckStoreOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  /** The kernel context to write a tenant's records in (the adapter's service principal). */
  context: (tenantId: string) => KernelContext;
  ttlHours?: number;
}

interface Row {
  id: string;
  request_hash: string;
  state: "pending" | "done";
  result: ScoreResult | null;
}

const COLS = "id, request_hash, state, result";

/**
 * PostgreSQL store on `connectors.kyc_score_check`. Every write goes through the kernel with a
 * ledger entry that names the adapter, the method, the key's hash, the mode and the state; never
 * the key, a file's reference or the answer.
 */
export class PgKycScoreCheckStore implements KycScoreCheckStore {
  constructor(private readonly o: PgKycScoreCheckStoreOptions) {}

  private ctx(tenantId: string): KernelContext {
    const ctx = this.o.context(tenantId);
    if (ctx.tenantId !== tenantId)
      throw new PortError("IPB-PORT-001", "KYC", {
        detail: "the liveness and face-match check store's context names another tenant",
        meta: { reason: "tenant_mismatch" },
      });
    return ctx;
  }

  async reserve(r: KycScoreCheckRequest): Promise<KycScoreCheckReservation> {
    const ctx = this.ctx(r.tenantId);
    const kh = kycScoreKeyHash(r.method, r.idempotencyKey);
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        // An expired record of this key is forgotten before the new one is written.
        await tx.query(
          `delete from connectors.kyc_score_check
            where tenant_id = $1 and adapter = $2 and method = $3 and key_hash = $4
              and expires_at <= now()`,
          [ctx.tenantId, r.adapter, r.method, kh],
        );
        const id = newId("ksc");
        const ins = await tx.query<{ id: string }>(
          `insert into connectors.kyc_score_check
             (id, tenant_id, adapter, method, key_hash, request_hash, mode, state, expires_at)
           values ($1, $2, $3, $4, $5, $6, $7, 'pending', now() + make_interval(hours => $8))
           on conflict do nothing returning id`,
          [
            id,
            ctx.tenantId,
            r.adapter,
            r.method,
            kh,
            kycScoreRequestHash(r),
            r.mode ?? null,
            this.o.ttlHours ?? KYC_SCORE_CHECK_TTL_HOURS,
          ],
        );
        if (ins.rowCount) {
          await this.ledger(tx, "reserve", id, r, kh, "pending");
          return { kind: "new", id } as KycScoreCheckReservation;
        }
        const row = (
          await tx.query<Row>(
            `select ${COLS} from connectors.kyc_score_check
              where tenant_id = $1 and adapter = $2 and method = $3 and key_hash = $4 for update`,
            [ctx.tenantId, r.adapter, r.method, kh],
          )
        ).rows[0]!;
        if (row.request_hash !== kycScoreRequestHash(r))
          throw kycScoreConflict(r.adapter, r.method);
        await this.ledger(
          tx,
          row.state === "pending" ? "found" : "replay",
          row.id,
          r,
          kh,
          row.state,
        );
        return row.state === "done"
          ? { kind: "done", result: row.result! }
          : { kind: "pending", id: row.id };
      },
      { action: "connectors.kyc_score.reserve" },
    );
  }

  async complete(r: KycScoreCheckRequest, id: string, result: ScoreResult): Promise<ScoreResult> {
    const ctx = this.ctx(r.tenantId);
    const kh = kycScoreKeyHash(r.method, r.idempotencyKey);
    const final = await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const up = await tx.query<Row>(
          `update connectors.kyc_score_check set state = 'done', result = $2::jsonb
            where id = $1 and state = 'pending' returning ${COLS}`,
          [id, JSON.stringify(resultOnly(result))],
        );
        if (up.rowCount) {
          await this.ledger(tx, "complete", id, r, kh, "done");
          return up.rows[0]!;
        }
        // A concurrent call with the key finished first: its answer is the answer.
        const row = (
          await tx.query<Row>(`select ${COLS} from connectors.kyc_score_check where id = $1`, [id])
        ).rows[0];
        await this.ledger(tx, "replay", id, r, kh, row?.state ?? "none");
        return row;
      },
      { action: "connectors.kyc_score.complete" },
    );
    return final?.state === "done" && final.result ? final.result : resultOnly(result);
  }

  /** Delete this tenant's expired records (IPB-10-07); a product's maintenance job calls it. */
  async purgeExpired(tenantId: string): Promise<number> {
    const ctx = this.ctx(tenantId);
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const d = await tx.query(
          `delete from connectors.kyc_score_check where tenant_id = $1 and expires_at <= now()`,
          [ctx.tenantId],
        );
        await this.o.audit.record(tx, {
          action: "connectors.kyc_score.purge",
          resourceType: "connectors.kyc_score_check",
          resourceId: ctx.tenantId,
          after: { deleted: d.rowCount ?? 0 },
        });
        return d.rowCount ?? 0;
      },
      { action: "connectors.kyc_score.purge" },
    );
  }

  private async ledger(
    tx: Tx,
    step: string,
    id: string,
    r: KycScoreCheckRequest,
    kh: string,
    state: string,
  ): Promise<void> {
    await this.o.audit.record(tx, {
      action: `connectors.kyc_score.${step}`,
      resourceType: "connectors.kyc_score_check",
      resourceId: id,
      after: { adapter: r.adapter, method: r.method, key_hash: kh, mode: r.mode ?? null, state },
    });
  }
}

/**
 * The check flow the adapters run around their own vendor call: the store's first answer for a
 * keyed retry, the result kept once answered. A vendor error (or a refused score) leaves the key
 * pending, and its retry asks the vendor again.
 */
export async function keyedScoreCheck(o: {
  store: KycScoreCheckStore;
  request: KycScoreCheckRequest | undefined;
  /** The vendor call. */
  check: () => Promise<ScoreResult>;
}): Promise<ScoreResult> {
  const { store, request } = o;
  if (!request) return o.check();
  const res = await store.reserve(request);
  if (res.kind === "done") return res.result;
  const result = await o.check();
  return store.complete(request, res.id, result);
}
