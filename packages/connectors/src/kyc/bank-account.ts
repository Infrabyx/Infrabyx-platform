// Bank account checks by mode and by idempotency key (Udofin PR-UDF-043, R1-D-196; threat model
// §3.139): what the Digio and IDfy adapters share. A check may ask for a mode (`pennyless` or
// `penny_drop`); an adapter that cannot honour it refuses `IPB-PORT-002` `mode_unsupported` before
// any vendor call and never falls back to another mode. The platform's adapters make pennyless
// checks only: a penny drop credits the customer's account, which is money movement and on the
// locked list, so they refuse it until the owner approves one ([ASSUMED – owner review] #147).
//
// A keyed check is kept, per tenant and adapter, so a retry gets the first answer and the vendor is
// never asked twice for one key. Hashes only, and never the account number or the IFSC: the key is
// kept as SHA-256, and the request (IFSC, account number, name and mode) as an HMAC-SHA-256 under a
// key derived from the idempotency key, which no row holds in clear. An account number is short and
// guessable, so no unkeyed hash of it is ever kept (as PR-UDF-041 did for the OTP; #147). A record
// lives 24 hours (IPB-10-07's window, as #144 and #145). A keyed penny drop left pending (its first
// call did not finish) is never sent again: it is refused `pending_unresolved` for a person, as
// the router does for a pending money operation (P-07). `PgBankAccountVerifyStore` is the
// production store (`connectors.kyc_bank_account_verify`, migration 0012);
// `MemoryBankAccountVerifyStore` serves tests and a single process.
import { PortError } from "@infrabyx/contracts/errors";
import type { AuditSink, KernelContext, MutationKernel, Tx } from "@infrabyx/contracts/kernel";
import {
  BANK_ACCOUNT_MODE_UNSUPPORTED,
  type BankAccountMode,
  type BankAccountResult,
  type NameMatch,
} from "@infrabyx/contracts/ports";
import { canonicalize, hmacSha256Hex, newId, SecretKey, sha256, sha256Hex } from "@infrabyx/crypto";

/** Hours a check record is kept (IPB-10-07). */
export const BANK_ACCOUNT_VERIFY_TTL_HOURS = 24;

/** The modes the platform's Digio and IDfy adapters honour: pennyless only (R1-D-196, #147). */
export const PLATFORM_BANK_ACCOUNT_MODES: readonly BankAccountMode[] = ["pennyless"];

/**
 * The mode a check uses: the one asked, or `configured`. A mode the adapter does not honour is
 * refused `IPB-PORT-002` with `meta.reason: "mode_unsupported"`; the caller checks this before it
 * reads anything else or calls its vendor.
 */
export function bankAccountMode(
  adapter: string,
  asked: BankAccountMode | undefined,
  o: { honoured: readonly BankAccountMode[]; configured: BankAccountMode },
): BankAccountMode {
  const mode = asked ?? o.configured;
  if (!o.honoured.includes(mode))
    throw new PortError("IPB-PORT-002", "KYC", {
      adapter,
      detail: `${adapter} does not verify bank accounts by ${mode}`,
      meta: { reason: BANK_ACCOUNT_MODE_UNSUPPORTED, definite: true },
    });
  return mode;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * The name asked against the name at the bank: `match` when equal once case, punctuation and
 * spacing are ignored, `partial` when the first names agree, otherwise `mismatch`.
 */
export function bankNameMatch(asked: string, atBank: string): NameMatch {
  const a = norm(asked);
  const b = norm(atBank);
  if (a === b) return "match";
  return a.split(" ")[0] === b.split(" ")[0] ? "partial" : "mismatch";
}

export interface BankAccountVerifyRequest {
  tenantId: string;
  /** The adapter's descriptor name; each adapter keeps its own records. */
  adapter: string;
  idempotencyKey: string;
  ifsc: string;
  accountNumber: string;
  name?: string;
  /** The mode used (the configured one when the check named none). */
  mode: BankAccountMode;
}

/** What an earlier check with the same key left. */
export type BankAccountVerifyReservation =
  | { kind: "new"; id: string }
  /** A check with this key started and did not finish (a crash, a time-out, a vendor error). */
  | { kind: "pending"; id: string }
  | { kind: "done"; result: BankAccountResult };

export interface BankAccountVerifyStore {
  /** Reserve the key, or report what an earlier call with it left; `IPB-PORT-004` on another request. */
  reserve(r: BankAccountVerifyRequest): Promise<BankAccountVerifyReservation>;
  /** Record the result; returns the record's (an earlier finisher's, if any). */
  complete(
    r: BankAccountVerifyRequest,
    id: string,
    result: BankAccountResult,
  ): Promise<BankAccountResult>;
}

export const bankAccountKeyHash = (key: string): string => sha256Hex(`bank-account-key:${key}`);

/**
 * The request's binding: HMAC-SHA-256 over the IFSC, the account number, the name and the mode,
 * under a key derived from the idempotency key. A row holds neither in clear (the key only as
 * `bankAccountKeyHash`), so an account number cannot be found by trying candidates against a row.
 */
export function bankAccountRequestHash(r: BankAccountVerifyRequest): string {
  const key = new SecretKey(
    "bank-account-binding",
    "hmac-sha-256",
    sha256(`bank-account-binding:${canonicalize([r.idempotencyKey])}`),
  );
  return hmacSha256Hex(
    key,
    canonicalize({
      ifsc: r.ifsc,
      accountNumber: r.accountNumber,
      name: r.name ?? null,
      mode: r.mode,
    }),
  );
}

export function bankAccountConflict(adapter: string): PortError {
  return new PortError("IPB-PORT-004", "KYC", {
    adapter,
    detail: "idempotency key reused with another bank account, IFSC, name or mode",
    meta: { reason: "idempotency_conflict" },
  });
}

/** A keyed penny drop whose first call did not finish: never sent again (P-07). */
export function bankAccountPendingUnresolved(adapter: string): PortError {
  return new PortError("IPB-PORT-002", "KYC", {
    adapter,
    detail:
      "the first penny drop with this key did not finish; it is not sent again until a person checks it with the provider",
    meta: { reason: "pending_unresolved" },
  });
}

/** Only the fields the port defines, so nothing else a vendor sent is ever kept. */
function resultOnly(r: BankAccountResult): BankAccountResult {
  return {
    vendorRef: r.vendorRef,
    adapter: r.adapter,
    modelVersion: r.modelVersion,
    checkedAt: r.checkedAt,
    status: r.status,
    ...(r.mode !== undefined ? { mode: r.mode } : {}),
    ...(r.nameAtBank !== undefined ? { nameAtBank: r.nameAtBank } : {}),
    ...(r.nameMatch !== undefined ? { nameMatch: r.nameMatch } : {}),
  };
}

/** In-memory store for tests and a single process. */
export class MemoryBankAccountVerifyStore implements BankAccountVerifyStore {
  private readonly rows = new Map<
    string,
    {
      id: string;
      request: string;
      state: "pending" | "done";
      result?: BankAccountResult;
      expiresAt: number;
    }
  >();
  constructor(private readonly o: { now?: () => Date; ttlHours?: number } = {}) {}
  private now(): number {
    return (this.o.now?.() ?? new Date()).getTime();
  }
  private k(r: BankAccountVerifyRequest): string {
    return `${r.tenantId}|${r.adapter}|${bankAccountKeyHash(r.idempotencyKey)}`;
  }

  async reserve(r: BankAccountVerifyRequest): Promise<BankAccountVerifyReservation> {
    const row = this.rows.get(this.k(r));
    if (row && row.expiresAt > this.now()) {
      if (row.request !== bankAccountRequestHash(r)) throw bankAccountConflict(r.adapter);
      if (row.state === "done") return { kind: "done", result: structuredClone(row.result!) };
      return { kind: "pending", id: row.id };
    }
    const id = newId("kba");
    this.rows.set(this.k(r), {
      id,
      request: bankAccountRequestHash(r),
      state: "pending",
      expiresAt: this.now() + (this.o.ttlHours ?? BANK_ACCOUNT_VERIFY_TTL_HOURS) * 3600_000,
    });
    return { kind: "new", id };
  }

  async complete(
    r: BankAccountVerifyRequest,
    id: string,
    result: BankAccountResult,
  ): Promise<BankAccountResult> {
    const row = this.rows.get(this.k(r));
    if (!row || row.id !== id) return resultOnly(result);
    if (row.state === "pending") {
      row.state = "done";
      row.result = resultOnly(result);
    }
    return structuredClone(row.result!);
  }
}

export interface PgBankAccountVerifyStoreOptions {
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
  result: BankAccountResult | null;
}

const COLS = "id, request_hash, state, result";

/**
 * PostgreSQL store on `connectors.kyc_bank_account_verify`. Every write goes through the kernel with
 * a ledger entry that names the adapter, the key's hash, the mode and the state; never the key, the
 * account number, the IFSC, the name or the answer.
 */
export class PgBankAccountVerifyStore implements BankAccountVerifyStore {
  constructor(private readonly o: PgBankAccountVerifyStoreOptions) {}

  private ctx(tenantId: string): KernelContext {
    const ctx = this.o.context(tenantId);
    if (ctx.tenantId !== tenantId)
      throw new PortError("IPB-PORT-001", "KYC", {
        detail: "the bank account check store's context names another tenant",
        meta: { reason: "tenant_mismatch" },
      });
    return ctx;
  }

  async reserve(r: BankAccountVerifyRequest): Promise<BankAccountVerifyReservation> {
    const ctx = this.ctx(r.tenantId);
    const kh = bankAccountKeyHash(r.idempotencyKey);
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        // An expired record of this key is forgotten before the new one is written.
        await tx.query(
          `delete from connectors.kyc_bank_account_verify
            where tenant_id = $1 and adapter = $2 and key_hash = $3 and expires_at <= now()`,
          [ctx.tenantId, r.adapter, kh],
        );
        const id = newId("kba");
        const ins = await tx.query<{ id: string }>(
          `insert into connectors.kyc_bank_account_verify
             (id, tenant_id, adapter, key_hash, request_hash, mode, state, expires_at)
           values ($1, $2, $3, $4, $5, $6, 'pending', now() + make_interval(hours => $7))
           on conflict do nothing returning id`,
          [
            id,
            ctx.tenantId,
            r.adapter,
            kh,
            bankAccountRequestHash(r),
            r.mode,
            this.o.ttlHours ?? BANK_ACCOUNT_VERIFY_TTL_HOURS,
          ],
        );
        if (ins.rowCount) {
          await this.ledger(tx, "reserve", id, r.adapter, kh, r.mode, "pending");
          return { kind: "new", id } as BankAccountVerifyReservation;
        }
        const row = (
          await tx.query<Row>(
            `select ${COLS} from connectors.kyc_bank_account_verify
              where tenant_id = $1 and adapter = $2 and key_hash = $3 for update`,
            [ctx.tenantId, r.adapter, kh],
          )
        ).rows[0]!;
        if (row.request_hash !== bankAccountRequestHash(r)) throw bankAccountConflict(r.adapter);
        await this.ledger(
          tx,
          row.state === "pending" ? "found" : "replay",
          row.id,
          r.adapter,
          kh,
          r.mode,
          row.state,
        );
        return row.state === "done"
          ? { kind: "done", result: row.result! }
          : { kind: "pending", id: row.id };
      },
      { action: "connectors.kyc_bank_account.reserve" },
    );
  }

  async complete(
    r: BankAccountVerifyRequest,
    id: string,
    result: BankAccountResult,
  ): Promise<BankAccountResult> {
    const ctx = this.ctx(r.tenantId);
    const kh = bankAccountKeyHash(r.idempotencyKey);
    const final = await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const up = await tx.query<Row>(
          `update connectors.kyc_bank_account_verify set state = 'done', result = $2::jsonb
            where id = $1 and state = 'pending' returning ${COLS}`,
          [id, JSON.stringify(resultOnly(result))],
        );
        if (up.rowCount) {
          await this.ledger(tx, "complete", id, r.adapter, kh, r.mode, "done");
          return up.rows[0]!;
        }
        // A concurrent call with the key finished first: its answer is the answer.
        const row = (
          await tx.query<Row>(
            `select ${COLS} from connectors.kyc_bank_account_verify where id = $1`,
            [id],
          )
        ).rows[0];
        await this.ledger(tx, "replay", id, r.adapter, kh, r.mode, row?.state ?? "none");
        return row;
      },
      { action: "connectors.kyc_bank_account.complete" },
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
          `delete from connectors.kyc_bank_account_verify where tenant_id = $1 and expires_at <= now()`,
          [ctx.tenantId],
        );
        await this.o.audit.record(tx, {
          action: "connectors.kyc_bank_account.purge",
          resourceType: "connectors.kyc_bank_account_verify",
          resourceId: ctx.tenantId,
          after: { deleted: d.rowCount ?? 0 },
        });
        return d.rowCount ?? 0;
      },
      { action: "connectors.kyc_bank_account.purge" },
    );
  }

  private async ledger(
    tx: Tx,
    step: string,
    id: string,
    adapter: string,
    kh: string,
    mode: BankAccountMode,
    state: string,
  ): Promise<void> {
    await this.o.audit.record(tx, {
      action: `connectors.kyc_bank_account.${step}`,
      resourceType: "connectors.kyc_bank_account_verify",
      resourceId: id,
      after: { adapter, key_hash: kh, mode, state },
    });
  }
}

/**
 * The check flow both adapters run, around their own vendor call: the store's first answer for a
 * keyed retry, a pending penny drop never sent again, the result kept once answered. A vendor
 * error leaves a pennyless key pending, and its retry asks the vendor again (nothing is credited).
 */
export async function keyedBankAccountVerify(o: {
  store: BankAccountVerifyStore;
  request: BankAccountVerifyRequest | undefined;
  /** The vendor call. */
  verify: () => Promise<BankAccountResult>;
}): Promise<BankAccountResult> {
  const { store, request } = o;
  if (!request) return o.verify();
  const res = await store.reserve(request);
  if (res.kind === "done") return res.result;
  if (res.kind === "pending" && request.mode === "penny_drop")
    throw bankAccountPendingUnresolved(request.adapter);
  const result = await o.verify();
  return store.complete(request, res.id, result);
}
