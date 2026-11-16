// AuditSink over audit.ledger (IPB-02-51). Called inside kernel.mutate; the database trigger
// assigns seq, prev_hash, entry_hash and occurred_at, so no caller can write an unchained row.
// Before/after payloads are stored only as canonical SHA-256 digests.
import {
  BUSINESS_ID_PATTERN,
  MAX_BUSINESS_IDS,
  type AuditEntryInput,
  type AuditSink,
  type Tx,
} from "@infrabyx/contracts/kernel";
import { canonicalDigest, hmacSha256Hex, newId, type SecretKey } from "@infrabyx/crypto";
import type { ActorType } from "./chain.js";

export interface PgAuditSinkOptions {
  /** HMAC key for ip_hash and ua_hash (PL1-C-02); without it they are not recorded. */
  pseudonymKey?: SecretKey;
}

/** A job step over many resources (Finbyx PR-FBX-30, R1-D-41). */
export interface BatchEntryInput {
  /** Dotted action, e.g. "cob.loan.accrue". */
  action: string;
  /** The job run (e.g. the close-of-business run id) and the step within it. */
  run: string;
  step: string;
  /** The type of every member, e.g. "loan". */
  resourceType: string;
  /** The resources the step changed, in order (1 to 100,000; each a ledger resource id). */
  resourceIds: readonly string[];
}

export const MAX_BATCH_MEMBERS = 100_000;
const SEGMENT = /^[A-Za-z0-9_.:-]{1,80}$/;
const RESOURCE_TYPE = /^[a-z][a-z0-9_.]{0,63}$/;
const RESOURCE_ID = /^[A-Za-z0-9_.:@/+=-]{1,255}$/;
const CHUNK = 10_000;

const batchAfter = (run: string, step: string, type: string, ids: readonly string[]) => ({
  run,
  step,
  resource_type: type,
  resource_ids: ids,
});

/** 1 to 16 distinct ids of the business-id pattern, or none (PR-LDC-30, R1-D-125). */
export function checkBusinessIds(ids: readonly string[] | undefined): string[] | null {
  if (ids === undefined) return null;
  if (ids.length < 1 || ids.length > MAX_BUSINESS_IDS)
    throw new RangeError(`a ledger entry carries 1 to ${MAX_BUSINESS_IDS} business ids`);
  if (!ids.every((i) => typeof i === "string" && BUSINESS_ID_PATTERN.test(i)))
    throw new RangeError("a business id is 1 to 128 of A-Z a-z 0-9 _ . : @ / + = -");
  if (new Set(ids).size !== ids.length) throw new RangeError("business ids must be distinct");
  return [...ids];
}

export class PgAuditSink implements AuditSink {
  constructor(private readonly o: PgAuditSinkOptions = {}) {}

  async record(tx: Tx, e: AuditEntryInput): Promise<{ id: string }> {
    const ctx = tx.ctx;
    const id = newId("led");
    // An external grantee is a named person: a `user` actor (IPB-02 §02.4.7.1), whose entries name
    // the grant they read under (R1-D-29).
    const actorType: ActorType = ctx.breakGlassGrantId
      ? "breakglass"
      : ctx.principal.type === "external"
        ? "user"
        : ctx.principal.type;
    const key = this.o.pseudonymKey;
    const businessIds = checkBusinessIds(e.businessIds);
    await tx.query(
      `insert into audit.ledger
         (id, tenant_id, seq, actor_id, actor_type, action, resource_type, resource_id,
          before_digest, after_digest, corrects_id, trace_id, ip_hash, ua_hash, occurred_at, prev_hash, entry_hash,
          branch_id${businessIds ? ", business_ids" : ""})
       values ($1, $2, 0, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now(), $14, $14, $15${businessIds ? ", $16" : ""})`,
      [
        id,
        ctx.tenantId,
        ctx.principal.id,
        actorType,
        e.action,
        e.resourceType,
        e.resourceId,
        e.before === undefined ? null : canonicalDigest(e.before),
        e.after === undefined ? null : canonicalDigest(e.after),
        e.correctsId ?? null,
        ctx.traceId ?? null,
        key && ctx.ip ? hmacSha256Hex(key, ctx.ip) : null,
        key && ctx.userAgent ? hmacSha256Hex(key, ctx.userAgent) : null,
        "0".repeat(64), // placeholder; the trigger sets prev_hash and entry_hash
        ctx.branchId ?? null,
        // Named only when given, so an entry without ids writes as before audit/0010.
        ...(businessIds ? [businessIds] : []),
      ],
    );
    tx.markAudited();
    return { id };
  }

  /**
   * One ledger entry for a job step over many resources, in the caller's transaction: the entry
   * (`job_step`, `<run>/<step>/<type>`) carries the digest of the full id list, and the ids go to
   * `audit.batch_member` in order. Write it after the step's units, with the ids that succeeded.
   */
  async recordBatch(tx: Tx, b: BatchEntryInput): Promise<{ id: string; members: number }> {
    if (!SEGMENT.test(b.run) || !SEGMENT.test(b.step))
      throw new RangeError("run and step are 1 to 80 of A-Z a-z 0-9 _ . : -");
    if (!RESOURCE_TYPE.test(b.resourceType)) throw new RangeError("invalid resource type");
    const ids = [...b.resourceIds];
    if (ids.length < 1 || ids.length > MAX_BATCH_MEMBERS)
      throw new RangeError(`a batch entry lists 1 to ${MAX_BATCH_MEMBERS} resources`);
    if (!ids.every((i) => RESOURCE_ID.test(i))) throw new RangeError("invalid resource id");
    const { id } = await this.record(tx, {
      action: b.action,
      resourceType: "job_step",
      resourceId: `${b.run}/${b.step}/${b.resourceType}`,
      after: batchAfter(b.run, b.step, b.resourceType, ids),
    });
    for (let i = 0; i < ids.length; i += CHUNK) {
      await tx.query(
        `insert into audit.batch_member (tenant_id, ledger_id, ordinal, resource_id)
         select $1, $2, m.ord - 1 + $4, m.rid from unnest($3::text[]) with ordinality as m (rid, ord)`,
        [tx.ctx.tenantId, id, ids.slice(i, i + CHUNK), i],
      );
    }
    return { id, members: ids.length };
  }

  /** True when a batch entry's members still match the digest its ledger entry carries. */
  async verifyBatch(tx: Tx, ledgerId: string): Promise<boolean> {
    const l = await tx.query<{ resource_id: string; after_digest: string | null }>(
      "select resource_id, after_digest from audit.ledger where id = $1 and resource_type = 'job_step'",
      [ledgerId],
    );
    const row = l.rows[0];
    if (!row?.after_digest) return false;
    const [run, step, type] = row.resource_id.split("/");
    if (!run || !step || !type) return false;
    const m = await tx.query<{ resource_id: string }>(
      "select resource_id from audit.batch_member where ledger_id = $1 order by ordinal",
      [ledgerId],
    );
    const ids = m.rows.map((r) => r.resource_id);
    return canonicalDigest(batchAfter(run, step, type, ids)) === row.after_digest;
  }
}
