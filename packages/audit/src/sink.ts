// AuditSink over audit.ledger (IPB-02-51). Called inside kernel.mutate; the database trigger
// assigns seq, prev_hash, entry_hash and occurred_at, so no caller can write an unchained row.
// Before/after payloads are stored only as canonical SHA-256 digests.
import type { AuditEntryInput, AuditSink, Tx } from "@infrabyx/contracts/kernel";
import { canonicalDigest, hmacSha256Hex, newId, type SecretKey } from "@infrabyx/crypto";
import type { ActorType } from "./chain.js";

export interface PgAuditSinkOptions {
  /** HMAC key for ip_hash and ua_hash (PL1-C-02); without it they are not recorded. */
  pseudonymKey?: SecretKey;
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
    await tx.query(
      `insert into audit.ledger
         (id, tenant_id, seq, actor_id, actor_type, action, resource_type, resource_id,
          before_digest, after_digest, corrects_id, trace_id, ip_hash, ua_hash, occurred_at, prev_hash, entry_hash,
          branch_id)
       values ($1, $2, 0, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now(), $14, $14, $15)`,
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
      ],
    );
    tx.markAudited();
    return { id };
  }
}
