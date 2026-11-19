// Aadhaar OTP e-KYC for a notified reporting entity (Udofin PR-UDF-041, R1-D-194; threat model
// §3.137): what the Digio and IDfy adapters share. Only an RE notified under PML Act s.11A may use
// Aadhaar OTP e-KYC (KYC Directions 2025 para 23 proviso (i) [VERIFY the paragraph against the
// Directions as published]), so an adapter refuses every call `not_configured` unless it was built
// with `notifiedEntity: true`, before it reads the request or calls its KUA.
//
// A keyed verify is kept, per tenant and adapter, so a retry gets the first answer. Hashes and
// references only, and never the number or the code: the number is not in a verify at all, the key
// is kept as SHA-256, and the request (transaction and code) as an HMAC-SHA-256 keyed by the
// idempotency key and the transaction together, which no row holds in clear; a six-digit code
// cannot be tested against a row without them ([ASSUMED – owner review] #145). A record lives 24
// hours (IPB-10-07's window, as #144). `PgAadhaarOtpVerifyStore` is the production store
// (`connectors.kyc_aadhaar_otp_verify`, migration 0011); `MemoryAadhaarOtpVerifyStore` serves tests
// and a single process.
import { PortError } from "@infrabyx/contracts/errors";
import type { AuditSink, KernelContext, MutationKernel, Tx } from "@infrabyx/contracts/kernel";
import { verhoeffValid } from "@infrabyx/contracts";
import type { AadhaarOtpRefusal, AadhaarOtpResult } from "@infrabyx/contracts/ports";
import { canonicalize, hmacSha256Hex, newId, SecretKey, sha256, sha256Hex } from "@infrabyx/crypto";

/** Hours a verify record is kept (IPB-10-07). */
export const AADHAAR_OTP_VERIFY_TTL_HOURS = 24;

/** The refusals a keyed verify keeps as its first answer: the vendor's definite word on the code. */
export type AadhaarOtpVerifyRefusal = Extract<AadhaarOtpRefusal, "otp_invalid" | "otp_expired">;

export const aadhaarOtpRefused = (
  adapter: string,
  reason: AadhaarOtpRefusal,
  detail: string,
): PortError =>
  new PortError("IPB-PORT-001", "KYC", { adapter, detail, meta: { reason, definite: true } });

/** The fail-closed gate: no notified entity, no call (and nothing read from the request). */
export function assertNotifiedEntity(adapter: string, notifiedEntity: boolean | undefined): void {
  if (notifiedEntity !== true)
    throw aadhaarOtpRefused(
      adapter,
      "not_configured",
      "Aadhaar OTP e-KYC is only for a reporting entity notified under PML Act s.11A (notifiedEntity)",
    );
}

const bounded = (n: number) => new RegExp(`(?<![0-9A-Za-z])[0-9]{${n}}(?![0-9A-Za-z])`, "g");
const TWELVE = bounded(12);
const SIXTEEN = bounded(16);

/**
 * True when `text` holds what reads as an Aadhaar number (12 digits, the first 2 to 9, Verhoeff) or
 * a VID (16 digits, Verhoeff), standing alone (not inside a longer run of letters or digits, so a
 * hash or a base64 run does not count). The adapter refuses to store an e-KYC response that does
 * (the number belongs in the RE's Aadhaar Data Vault, not in general STORAGE; R1-D-194, #145).
 */
export function holdsAadhaarNumber(text: string): boolean {
  for (const m of text.matchAll(TWELVE))
    if (/^[2-9]/.test(m[0]) && verhoeffValid(m[0])) return true;
  for (const m of text.matchAll(SIXTEEN)) if (verhoeffValid(m[0])) return true;
  return false;
}

export interface AadhaarOtpVerifyRequest {
  tenantId: string;
  /** The adapter's descriptor name; each adapter keeps its own records. */
  adapter: string;
  idempotencyKey: string;
  txn: string;
  otp: string;
}

/** What an earlier verify with the same key left. */
export type AadhaarOtpVerifyFound =
  | { kind: "none" }
  /** A verify with this key started and did not finish (a crash or a time-out). */
  | { kind: "pending"; id: string }
  | { kind: "done"; result: AadhaarOtpResult }
  | { kind: "refused"; reason: AadhaarOtpVerifyRefusal };

export type AadhaarOtpVerifyReservation =
  { kind: "new"; id: string } | Exclude<AadhaarOtpVerifyFound, { kind: "none" }>;

export type AadhaarOtpVerifyFinal = Extract<AadhaarOtpVerifyFound, { kind: "done" | "refused" }>;

export interface AadhaarOtpVerifyStore {
  /** Reserve the key, or report what an earlier call with it left; `IPB-PORT-004` on another request. */
  reserve(r: AadhaarOtpVerifyRequest): Promise<AadhaarOtpVerifyReservation>;
  /** Record the result; returns the record's (an earlier finisher's, if any). */
  complete(
    r: AadhaarOtpVerifyRequest,
    id: string,
    result: AadhaarOtpResult,
  ): Promise<AadhaarOtpResult>;
  /** Record the vendor's refusal; returns the record's final answer (an earlier finisher's, if any). */
  refuse(
    r: AadhaarOtpVerifyRequest,
    id: string,
    reason: AadhaarOtpVerifyRefusal,
  ): Promise<AadhaarOtpVerifyFinal>;
}

export const aadhaarOtpKeyHash = (key: string): string => sha256Hex(`aadhaar-otp-key:${key}`);

/**
 * The request's binding: HMAC-SHA-256 over the transaction and the code, under a key derived from
 * the idempotency key and the transaction. A row holds neither in clear (the key only as
 * `aadhaarOtpKeyHash`, the transaction not at all), so the code cannot be recovered by trying the
 * million six-digit values against it.
 */
export function aadhaarOtpRequestHash(r: AadhaarOtpVerifyRequest): string {
  const key = new SecretKey(
    "aadhaar-otp-binding",
    "hmac-sha-256",
    sha256(`aadhaar-otp-binding:${canonicalize([r.idempotencyKey, r.txn])}`),
  );
  return hmacSha256Hex(key, canonicalize({ txn: r.txn, otp: r.otp }));
}

export function aadhaarOtpConflict(adapter: string): PortError {
  return new PortError("IPB-PORT-004", "KYC", {
    adapter,
    detail: "idempotency key reused with another Aadhaar OTP code or transaction",
    meta: { reason: "idempotency_conflict" },
  });
}

/** Only the fields the port defines, so nothing else a vendor sent is ever kept. */
function resultOnly(r: AadhaarOtpResult): AadhaarOtpResult {
  return {
    vendorRef: r.vendorRef,
    adapter: r.adapter,
    modelVersion: r.modelVersion,
    checkedAt: r.checkedAt,
    ekyc: { storageKey: r.ekyc.storageKey, sha256: r.ekyc.sha256 },
    signatureValid: r.signatureValid,
    uidLast4: r.uidLast4,
  };
}

const REFUSALS: readonly AadhaarOtpVerifyRefusal[] = ["otp_invalid", "otp_expired"];

/** In-memory store for tests and a single process. */
export class MemoryAadhaarOtpVerifyStore implements AadhaarOtpVerifyStore {
  private readonly rows = new Map<
    string,
    {
      id: string;
      request: string;
      state: "pending" | "done" | "refused";
      result?: AadhaarOtpResult;
      reason?: AadhaarOtpVerifyRefusal;
      expiresAt: number;
    }
  >();
  constructor(private readonly o: { now?: () => Date; ttlHours?: number } = {}) {}
  private now(): number {
    return (this.o.now?.() ?? new Date()).getTime();
  }
  private k(r: AadhaarOtpVerifyRequest): string {
    return `${r.tenantId}|${r.adapter}|${aadhaarOtpKeyHash(r.idempotencyKey)}`;
  }

  async reserve(r: AadhaarOtpVerifyRequest): Promise<AadhaarOtpVerifyReservation> {
    const row = this.rows.get(this.k(r));
    if (row && row.expiresAt > this.now()) {
      if (row.request !== aadhaarOtpRequestHash(r)) throw aadhaarOtpConflict(r.adapter);
      if (row.state === "done") return { kind: "done", result: structuredClone(row.result!) };
      if (row.state === "refused") return { kind: "refused", reason: row.reason! };
      return { kind: "pending", id: row.id };
    }
    const id = newId("kao");
    this.rows.set(this.k(r), {
      id,
      request: aadhaarOtpRequestHash(r),
      state: "pending",
      expiresAt: this.now() + (this.o.ttlHours ?? AADHAAR_OTP_VERIFY_TTL_HOURS) * 3600_000,
    });
    return { kind: "new", id };
  }

  async complete(
    r: AadhaarOtpVerifyRequest,
    id: string,
    result: AadhaarOtpResult,
  ): Promise<AadhaarOtpResult> {
    const row = this.rows.get(this.k(r));
    if (!row || row.id !== id) return resultOnly(result);
    if (row.state === "pending") {
      row.state = "done";
      row.result = resultOnly(result);
    }
    if (row.state === "done") return structuredClone(row.result!);
    // Refused first by a concurrent call with the key: its refusal is the answer.
    throw aadhaarOtpRefused(r.adapter, row.reason!, "the first verify with this key was refused");
  }

  async refuse(
    r: AadhaarOtpVerifyRequest,
    id: string,
    reason: AadhaarOtpVerifyRefusal,
  ): Promise<AadhaarOtpVerifyFinal> {
    const row = this.rows.get(this.k(r));
    if (!row || row.id !== id) return { kind: "refused", reason };
    if (row.state === "pending") {
      row.state = "refused";
      row.reason = reason;
    }
    return row.state === "done"
      ? { kind: "done", result: structuredClone(row.result!) }
      : { kind: "refused", reason: row.reason! };
  }
}

export interface PgAadhaarOtpVerifyStoreOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  /** The kernel context to write a tenant's records in (the adapter's service principal). */
  context: (tenantId: string) => KernelContext;
  ttlHours?: number;
}

interface Row {
  id: string;
  request_hash: string;
  state: "pending" | "done" | "refused";
  reason: AadhaarOtpVerifyRefusal | null;
  result: AadhaarOtpResult | null;
}

const COLS = "id, request_hash, state, reason, result";

/**
 * PostgreSQL store on `connectors.kyc_aadhaar_otp_verify`. Every write goes through the kernel with
 * a ledger entry that names the adapter, the key's hash, the state and the refusal label; never the
 * key, the transaction, the code, the storage key or the last four digits.
 */
export class PgAadhaarOtpVerifyStore implements AadhaarOtpVerifyStore {
  constructor(private readonly o: PgAadhaarOtpVerifyStoreOptions) {}

  private ctx(tenantId: string): KernelContext {
    const ctx = this.o.context(tenantId);
    if (ctx.tenantId !== tenantId)
      throw new PortError("IPB-PORT-001", "KYC", {
        detail: "the Aadhaar OTP verify store's context names another tenant",
        meta: { reason: "tenant_mismatch" },
      });
    return ctx;
  }

  private static map(r: AadhaarOtpVerifyRequest, row: Row): AadhaarOtpVerifyReservation {
    if (row.request_hash !== aadhaarOtpRequestHash(r)) throw aadhaarOtpConflict(r.adapter);
    if (row.state === "done") return { kind: "done", result: row.result! };
    if (row.state === "refused") return { kind: "refused", reason: row.reason! };
    return { kind: "pending", id: row.id };
  }

  async reserve(r: AadhaarOtpVerifyRequest): Promise<AadhaarOtpVerifyReservation> {
    const ctx = this.ctx(r.tenantId);
    const kh = aadhaarOtpKeyHash(r.idempotencyKey);
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        // An expired record of this key is forgotten before the new one is written.
        await tx.query(
          `delete from connectors.kyc_aadhaar_otp_verify
            where tenant_id = $1 and adapter = $2 and key_hash = $3 and expires_at <= now()`,
          [ctx.tenantId, r.adapter, kh],
        );
        const id = newId("kao");
        const ins = await tx.query<{ id: string }>(
          `insert into connectors.kyc_aadhaar_otp_verify
             (id, tenant_id, adapter, key_hash, request_hash, state, expires_at)
           values ($1, $2, $3, $4, $5, 'pending', now() + make_interval(hours => $6))
           on conflict do nothing returning id`,
          [
            id,
            ctx.tenantId,
            r.adapter,
            kh,
            aadhaarOtpRequestHash(r),
            this.o.ttlHours ?? AADHAAR_OTP_VERIFY_TTL_HOURS,
          ],
        );
        if (ins.rowCount) {
          await this.ledger(tx, "reserve", id, r.adapter, kh, "pending", null);
          return { kind: "new", id } as AadhaarOtpVerifyReservation;
        }
        const row = (
          await tx.query<Row>(
            `select ${COLS} from connectors.kyc_aadhaar_otp_verify
              where tenant_id = $1 and adapter = $2 and key_hash = $3 for update`,
            [ctx.tenantId, r.adapter, kh],
          )
        ).rows[0]!;
        const found = PgAadhaarOtpVerifyStore.map(r, row);
        await this.ledger(
          tx,
          found.kind === "pending" ? "found" : "replay",
          row.id,
          r.adapter,
          kh,
          row.state,
          row.reason,
        );
        return found;
      },
      { action: "connectors.kyc_aadhaar_otp.reserve" },
    );
  }

  async complete(
    r: AadhaarOtpVerifyRequest,
    id: string,
    result: AadhaarOtpResult,
  ): Promise<AadhaarOtpResult> {
    const ctx = this.ctx(r.tenantId);
    const kh = aadhaarOtpKeyHash(r.idempotencyKey);
    const final = await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const up = await tx.query<Row>(
          `update connectors.kyc_aadhaar_otp_verify set state = 'done', result = $2::jsonb
            where id = $1 and state = 'pending' returning ${COLS}`,
          [id, JSON.stringify(resultOnly(result))],
        );
        if (up.rowCount) {
          await this.ledger(tx, "complete", id, r.adapter, kh, "done", null);
          return up.rows[0]!;
        }
        // A concurrent call with the key finished first: its answer is the answer.
        const row = (
          await tx.query<Row>(
            `select ${COLS} from connectors.kyc_aadhaar_otp_verify where id = $1`,
            [id],
          )
        ).rows[0];
        await this.ledger(
          tx,
          "replay",
          id,
          r.adapter,
          kh,
          row?.state ?? "none",
          row?.reason ?? null,
        );
        return row;
      },
      { action: "connectors.kyc_aadhaar_otp.complete" },
    );
    if (final?.state === "refused")
      throw aadhaarOtpRefused(
        r.adapter,
        final.reason!,
        "the first verify with this key was refused",
      );
    return final?.state === "done" && final.result ? final.result : resultOnly(result);
  }

  async refuse(
    r: AadhaarOtpVerifyRequest,
    id: string,
    reason: AadhaarOtpVerifyRefusal,
  ): Promise<AadhaarOtpVerifyFinal> {
    if (!REFUSALS.includes(reason)) throw new RangeError("not a verify refusal");
    const ctx = this.ctx(r.tenantId);
    const kh = aadhaarOtpKeyHash(r.idempotencyKey);
    const row = await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const up = await tx.query<Row>(
          `update connectors.kyc_aadhaar_otp_verify set state = 'refused', reason = $2
            where id = $1 and state = 'pending' returning ${COLS}`,
          [id, reason],
        );
        const out =
          up.rows[0] ??
          (
            await tx.query<Row>(
              `select ${COLS} from connectors.kyc_aadhaar_otp_verify where id = $1`,
              [id],
            )
          ).rows[0];
        await this.ledger(
          tx,
          up.rowCount ? "refuse" : "replay",
          id,
          r.adapter,
          kh,
          out?.state ?? "none",
          out?.reason ?? null,
        );
        return out;
      },
      { action: "connectors.kyc_aadhaar_otp.refuse" },
    );
    if (row?.state === "done" && row.result) return { kind: "done", result: row.result };
    return { kind: "refused", reason: row?.reason ?? reason };
  }

  /** Delete this tenant's expired records (IPB-10-07); a product's maintenance job calls it. */
  async purgeExpired(tenantId: string): Promise<number> {
    const ctx = this.ctx(tenantId);
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const d = await tx.query(
          `delete from connectors.kyc_aadhaar_otp_verify where tenant_id = $1 and expires_at <= now()`,
          [ctx.tenantId],
        );
        await this.o.audit.record(tx, {
          action: "connectors.kyc_aadhaar_otp.purge",
          resourceType: "connectors.kyc_aadhaar_otp_verify",
          resourceId: ctx.tenantId,
          after: { deleted: d.rowCount ?? 0 },
        });
        return d.rowCount ?? 0;
      },
      { action: "connectors.kyc_aadhaar_otp.purge" },
    );
  }

  private async ledger(
    tx: Tx,
    step: string,
    id: string,
    adapter: string,
    kh: string,
    state: string,
    reason: string | null,
  ): Promise<void> {
    await this.o.audit.record(tx, {
      action: `connectors.kyc_aadhaar_otp.${step}`,
      resourceType: "connectors.kyc_aadhaar_otp_verify",
      resourceId: id,
      after: { adapter, key_hash: kh, state, ...(reason ? { reason } : {}) },
    });
  }
}

/**
 * The verify flow both adapters run, around their own vendor call: the store's first answer for a
 * keyed retry, the vendor's refusal kept as the key's answer, the result kept once stored.
 */
export async function keyedAadhaarOtpVerify(o: {
  store: AadhaarOtpVerifyStore;
  request: AadhaarOtpVerifyRequest | undefined;
  /** The vendor call; throws `aadhaarOtpRefused` for a definite refusal. */
  verify: () => Promise<AadhaarOtpResult>;
}): Promise<AadhaarOtpResult> {
  const { store, request } = o;
  if (!request) return o.verify();
  const res = await store.reserve(request);
  if (res.kind === "done") return res.result;
  if (res.kind === "refused")
    throw aadhaarOtpRefused(
      request.adapter,
      res.reason,
      "the first verify with this key was refused",
    );
  let result: AadhaarOtpResult;
  try {
    result = await o.verify();
  } catch (e) {
    const x = e as { code?: unknown; meta?: { reason?: unknown } };
    const reason = x.meta?.reason as AadhaarOtpVerifyRefusal;
    if (x.code === "IPB-PORT-001" && REFUSALS.includes(reason)) {
      const final = await store.refuse(request, res.id, reason);
      if (final.kind === "done") return final.result;
      if (final.reason !== reason)
        throw aadhaarOtpRefused(
          request.adapter,
          final.reason,
          "the first verify with this key was refused",
        );
    }
    throw e;
  }
  return store.complete(request, res.id, result);
}
