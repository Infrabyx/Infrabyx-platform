// Idempotency for port side effects (plan §3.5; PL2-D-08, PL2-D-25). The record is written as
// `pending` in its own committed transaction before the vendor call. A retry with the same key and
// the same request finds the stored result, or, while pending, looks the operation up at the vendor
// before calling again. Money operations are never re-sent while pending unless the vendor
// authoritatively reports the operation absent; otherwise they stay pending for a human (P-07).
import type { DataClass } from "@infrabyx/contracts/data-class";
import { IpbError, PortError, isIpbError } from "@infrabyx/contracts/errors";
import type { AuditSink, KernelContext, MutationKernel, Tx } from "@infrabyx/contracts/kernel";
import type { LookupResult } from "@infrabyx/contracts/ports";
import { canonicalize, fromBase64Url, newId, sha256Hex, toBase64Url } from "@infrabyx/crypto";

export interface IdempotencyRequest {
  port: string;
  adapter: string;
  operation: string;
  key: string;
  /** The request without transport details; hashed as SHA-256 over JCS (C-20). */
  request: unknown;
  dataClass: DataClass;
  money: boolean;
}

export type Reservation =
  | { kind: "new"; id: string }
  | { kind: "succeeded"; result: unknown }
  | { kind: "pending"; id: string }
  | { kind: "retry"; id: string };

export interface IdempotencyStore {
  /** Reserve the key: a new pending record, or what an earlier call with this key left. */
  reserve(req: IdempotencyRequest): Promise<Reservation>;
  settle(
    id: string,
    req: IdempotencyRequest,
    outcome: { status: "succeeded"; result: unknown } | { status: "failed" },
  ): Promise<void>;
}

/** Hours a record is kept (IPB-10-07); pending money records are kept until resolved. */
export const IDEMPOTENCY_TTL_HOURS = 24;

export const requestHash = (request: unknown): string => sha256Hex(canonicalize(request));
export const keyHash = (key: string): string => sha256Hex(key);

/** A definite vendor rejection: the operation did not happen, so the key may be used again. */
export function isDefiniteRejection(e: unknown): boolean {
  if (!isIpbError(e)) return false;
  if ((e.meta as { definite?: unknown } | undefined)?.definite === true) return true;
  const s = e.httpStatus;
  return s >= 400 && s < 500 && s !== 408 && s !== 409 && s !== 425 && s !== 429;
}

export interface RunIdempotentOptions<T> {
  store: IdempotencyStore;
  req: IdempotencyRequest;
  call: () => Promise<T>;
  /** Vendor lookup by key (IdempotencyLookup); absent for adapters without one. */
  lookup?: () => Promise<LookupResult<T>>;
  /** Told when a money operation stays pending and needs a person (P-07 human queue). */
  onUnresolved?: (req: IdempotencyRequest, reason: string) => Promise<void> | void;
}

export async function runIdempotent<T>(o: RunIdempotentOptions<T>): Promise<T> {
  const r = await o.store.reserve(o.req);
  if (r.kind === "succeeded") return r.result as T;
  if (r.kind === "pending") {
    const found = o.lookup
      ? await o.lookup().catch((e: unknown) => ({
          status: "unknown" as const,
          reason: String((e as Error)?.message ?? e),
        }))
      : undefined;
    if (found?.status === "found") {
      await o.store.settle(r.id, o.req, { status: "succeeded", result: found.result });
      return found.result;
    }
    const authoritativeAbsent = found?.status === "absent";
    if (!authoritativeAbsent && o.req.money) {
      const reason =
        found?.status === "unknown"
          ? `vendor lookup inconclusive: ${found.reason}`
          : "no vendor lookup";
      await o.onUnresolved?.(o.req, reason);
      throw new PortError("IPB-PORT-002", o.req.port, {
        adapter: o.req.adapter,
        detail: `${o.req.operation} is pending at the vendor; not re-sent (P-07)`,
        meta: { reason: "pending_unresolved" },
      });
    }
    if (!authoritativeAbsent && found?.status === "unknown") {
      throw new PortError("IPB-PORT-002", o.req.port, {
        adapter: o.req.adapter,
        detail: `${o.req.operation} outcome unknown; retry later`,
        meta: { reason: "pending_unknown" },
      });
    }
  }
  return execute(o, r.id);
}

async function execute<T>(o: RunIdempotentOptions<T>, id: string): Promise<T> {
  try {
    const result = await o.call();
    await o.store.settle(id, o.req, { status: "succeeded", result });
    return result;
  } catch (e) {
    if (isDefiniteRejection(e)) await o.store.settle(id, o.req, { status: "failed" });
    // Anything else (timeout, reset, 5xx after send) leaves the record pending.
    throw e;
  }
}

function conflict(req: IdempotencyRequest): PortError {
  return new PortError("IPB-PORT-004", req.port, {
    adapter: req.adapter,
    detail: "idempotency key reused with a different request",
  });
}

/** In-memory store for unit tests and single-process tools. */
export class MemoryIdempotencyStore implements IdempotencyStore {
  readonly records = new Map<
    string,
    { id: string; reqHash: string; status: "pending" | "succeeded" | "failed"; result?: unknown }
  >();

  async reserve(req: IdempotencyRequest): Promise<Reservation> {
    const k = `${req.port}:${keyHash(req.key)}`;
    const h = requestHash(req.request);
    const cur = this.records.get(k);
    if (!cur) {
      const id = newId("idm");
      this.records.set(k, { id, reqHash: h, status: "pending" });
      return { kind: "new", id };
    }
    if (cur.reqHash !== h) throw conflict(req);
    if (cur.status === "succeeded") return { kind: "succeeded", result: cur.result };
    if (cur.status === "failed") {
      cur.status = "pending";
      return { kind: "retry", id: cur.id };
    }
    return { kind: "pending", id: cur.id };
  }

  async settle(
    id: string,
    _req: IdempotencyRequest,
    outcome: { status: "succeeded"; result: unknown } | { status: "failed" },
  ): Promise<void> {
    for (const r of this.records.values())
      if (r.id === id) {
        r.status = outcome.status;
        if (outcome.status === "succeeded") r.result = outcome.result;
      }
  }
}

/** Results of class CONFIDENTIAL and above are sealed with the tenant key (PL1 field encryption). */
export interface ResultSealer {
  seal(tenantId: string, cls: DataClass, plaintext: string, rowId: string): Promise<unknown>;
  open(tenantId: string, sealed: unknown, rowId: string): Promise<string>;
}

const SEALED_CLASSES: readonly DataClass[] = ["CONFIDENTIAL", "REGULATED", "SECRET"];

interface SealedFieldLike {
  enc: Uint8Array;
  keyId: string;
  alg: string;
}

/** Bridge to the PL1 field encryption (`FieldCrypto` from @infrabyx/tenancy), stored as JSON. */
export function sealerFromFieldCrypto(fc: {
  encryptField(
    tenantId: string,
    cls: DataClass,
    plaintext: string,
    at: { table: string; column: string; rowId: string },
  ): Promise<SealedFieldLike>;
  decryptFieldText(
    tenantId: string,
    sealed: never,
    at: { table: string; column: string; rowId: string },
  ): Promise<string>;
}): ResultSealer {
  const at = (rowId: string) => ({
    table: "connectors.idempotency_record",
    column: "result_sealed",
    rowId,
  });
  return {
    async seal(tenantId, cls, plaintext, rowId) {
      const s = await fc.encryptField(tenantId, cls, plaintext, at(rowId));
      return { enc: toBase64Url(s.enc), keyId: s.keyId, alg: s.alg };
    },
    async open(tenantId, sealed, rowId) {
      const j = sealed as { enc: string; keyId: string; alg: string };
      return fc.decryptFieldText(
        tenantId,
        { enc: fromBase64Url(j.enc), keyId: j.keyId, alg: j.alg } as never,
        at(rowId),
      );
    },
  };
}

/**
 * PostgreSQL store on `connectors.idempotency_record`. Every write goes through the kernel with an
 * audit entry (IPB-MOD-003); the ledger records the port, adapter, operation and key hash, never
 * the payload.
 */
export class PgIdempotencyStore implements IdempotencyStore {
  constructor(
    private readonly o: {
      kernel: MutationKernel;
      audit: AuditSink;
      context: () => KernelContext;
      sealer?: ResultSealer;
      ttlHours?: number;
    },
  ) {}

  async reserve(req: IdempotencyRequest): Promise<Reservation> {
    const ctx = this.o.context();
    const h = requestHash(req.request);
    const kh = keyHash(req.key);
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const id = newId("idm");
        const ins = await tx.query<{ id: string }>(
          `insert into connectors.idempotency_record
             (id, tenant_id, port, adapter, operation, key_hash, request_hash, status, money, data_class, expires_at)
           values ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9, now() + make_interval(hours => $10))
           on conflict (tenant_id, port, key_hash) do nothing returning id`,
          [
            id,
            ctx.tenantId,
            req.port,
            req.adapter,
            req.operation,
            kh,
            h,
            req.money,
            req.dataClass,
            this.o.ttlHours ?? IDEMPOTENCY_TTL_HOURS,
          ],
        );
        if (ins.rowCount) {
          await this.ledger(tx, "connectors.idempotency.reserve", id, req, kh);
          return { kind: "new", id } as Reservation;
        }
        const cur = (
          await tx.query<{
            id: string;
            request_hash: string;
            status: string;
            result: unknown;
            result_sealed: unknown;
          }>(
            `select id, request_hash, status, result, result_sealed from connectors.idempotency_record
             where tenant_id = $1 and port = $2 and key_hash = $3 for update`,
            [ctx.tenantId, req.port, kh],
          )
        ).rows[0];
        if (!cur) throw new IpbError("IPB-PORT-002", { detail: "idempotency record vanished" });
        if (cur.request_hash !== h) throw conflict(req);
        if (cur.status === "succeeded") {
          const result =
            cur.result_sealed && this.o.sealer
              ? JSON.parse(await this.o.sealer.open(ctx.tenantId, cur.result_sealed, cur.id))
              : cur.result;
          await this.ledger(tx, "connectors.idempotency.replay", cur.id, req, kh);
          return { kind: "succeeded", result } as Reservation;
        }
        if (cur.status === "failed") {
          await tx.query(
            `update connectors.idempotency_record set status = 'pending', updated_at = now() where id = $1`,
            [cur.id],
          );
          await this.ledger(tx, "connectors.idempotency.retry", cur.id, req, kh);
          return { kind: "retry", id: cur.id } as Reservation;
        }
        await this.ledger(tx, "connectors.idempotency.pending_found", cur.id, req, kh);
        return { kind: "pending", id: cur.id } as Reservation;
      },
      { action: "connectors.idempotency.reserve" },
    );
  }

  async settle(
    id: string,
    req: IdempotencyRequest,
    outcome: { status: "succeeded"; result: unknown } | { status: "failed" },
  ): Promise<void> {
    const ctx = this.o.context();
    let result: unknown = null;
    let sealed: unknown = null;
    if (outcome.status === "succeeded") {
      const json = JSON.stringify(outcome.result ?? null);
      if (SEALED_CLASSES.includes(req.dataClass)) {
        if (!this.o.sealer)
          throw new IpbError("IPB-PORT-001", {
            detail: `a ${req.dataClass} result needs a sealer (field encryption)`,
          });
        sealed = await this.o.sealer.seal(ctx.tenantId, req.dataClass, json, id);
      } else result = json;
    }
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        await tx.query(
          `update connectors.idempotency_record
             set status = $2, result = $3::jsonb, result_sealed = $4::jsonb, updated_at = now()
           where id = $1`,
          [id, outcome.status, result, sealed === null ? null : JSON.stringify(sealed)],
        );
        await this.ledger(
          tx,
          `connectors.idempotency.${outcome.status}`,
          id,
          req,
          keyHash(req.key),
        );
      },
      { action: `connectors.idempotency.${outcome.status}` },
    );
  }

  /** Delete this tenant's expired records, keeping unresolved money records (plan §5.4). */
  async purgeExpired(): Promise<number> {
    const ctx = this.o.context();
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const r = await tx.query(
          `delete from connectors.idempotency_record
           where tenant_id = $1 and expires_at < now() and not (money and status = 'pending')`,
          [ctx.tenantId],
        );
        await this.o.audit.record(tx, {
          action: "connectors.idempotency.purge",
          resourceType: "connectors.idempotency_record",
          resourceId: ctx.tenantId,
          after: { deleted: r.rowCount ?? 0 },
        });
        return r.rowCount ?? 0;
      },
      { action: "connectors.idempotency.purge" },
    );
  }

  private async ledger(
    tx: Tx,
    action: string,
    id: string,
    req: IdempotencyRequest,
    kh: string,
  ): Promise<void> {
    await this.o.audit.record(tx, {
      action,
      resourceType: "connectors.idempotency_record",
      resourceId: id,
      after: {
        port: req.port,
        adapter: req.adapter,
        operation: req.operation,
        key_hash: kh,
        money: req.money,
      },
    });
  }
}
