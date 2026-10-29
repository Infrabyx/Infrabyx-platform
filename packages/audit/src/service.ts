// Ledger reads, corrections, verification and signed anchors (IPB-02-51, §02.4.7.1).
import type {
  AuditEntryInput,
  KernelContext,
  MutationKernel,
  OutboxWriter,
  Tx,
} from "@infrabyx/contracts/kernel";
import type { KmsPort, StoragePort } from "@infrabyx/contracts/ports";
import { storageKey } from "@infrabyx/contracts/ports";
import { internalEvent } from "@infrabyx/config/events";
import {
  canonicalize,
  newId,
  signRecord,
  verifyRecord,
  type SecretKey,
  type SignatureRecord,
} from "@infrabyx/crypto";
import { GENESIS_HASH, verifyChain, type LedgerEntry, type VerifyResult } from "./chain.js";
import {
  StatutoryCapture,
  verifyCaptureChain,
  type CaptureEntry,
  type CaptureVerifyResult,
} from "./capture.js";
import type { PgAuditSink } from "./sink.js";

export const LEDGER_RETENTION_DAYS = 2922; // 8 years (IPB-02-52)
export const ANCHOR_FORMAT = "infrabyx-audit-anchor/1";
/** An anchor that also signs the statutory capture's head (R1-D-25); written once a tenant has one. */
export const ANCHOR_FORMAT_CAPTURE = "infrabyx-audit-anchor/2";

export interface AnchorBody {
  format: typeof ANCHOR_FORMAT | typeof ANCHOR_FORMAT_CAPTURE;
  tenant_id: string;
  anchor_date: string;
  seq: number;
  head_hash: string;
  head_entry_id: string | null;
  /** Format 2: the last captured change of the anchor date (`audit.capture`) and its hash. */
  capture_seq?: number;
  capture_head_hash?: string;
  created_at: string;
}

export interface AnchorFile extends AnchorBody {
  signature: SignatureRecord;
}

export interface LedgerFilter {
  resourceType?: string;
  resourceId?: string;
  action?: string;
  actorId?: string;
  from?: Date;
  to?: Date;
  afterSeq?: number;
  limit?: number;
}

export interface AuditServiceOptions {
  kernel: MutationKernel;
  sink: PgAuditSink;
  product: string;
  outbox?: OutboxWriter;
  storage?: StoragePort;
  kms?: KmsPort;
  /** KMS signing key for anchors, e.g. LOCAL_KMS_KEYS.anchorSigning with LocalKms. */
  anchorKeyId?: string;
  pseudonymKey?: SecretKey;
  retentionDays?: number;
}

interface Row extends Omit<LedgerEntry, "seq" | "occurred_at"> {
  seq: string | number;
  occurred_at: Date;
}
const toEntry = (r: Row): LedgerEntry => ({
  ...r,
  seq: Number(r.seq),
  occurred_at: r.occurred_at.toISOString(),
});

export class AuditService {
  constructor(private readonly o: AuditServiceOptions) {}

  /** Tenant-scoped read for the Audit trails node and the tenant export slice (IPB-02-18). */
  async query(ctx: KernelContext, f: LedgerFilter = {}): Promise<LedgerEntry[]> {
    return this.o.kernel.read(ctx, (tx) => this.select(tx, f));
  }

  /** A correction is a new entry referencing the original; nothing is ever updated (NN-02). */
  async correct(
    tx: Tx,
    correctsId: string,
    entry: Omit<AuditEntryInput, "correctsId">,
  ): Promise<{ id: string }> {
    const r = await tx.query("select 1 from audit.ledger where id = $1", [correctsId]);
    if (r.rows.length === 0) throw new Error(`ledger entry ${correctsId} not found in this tenant`);
    return this.o.sink.record(tx, { ...entry, correctsId });
  }

  /** Recompute the tenant's chain; on a break, emit LedgerChainBroken (weekly verifier job). */
  async verify(ctx: KernelContext): Promise<VerifyResult> {
    const entries = await this.o.kernel.read(ctx, (tx) => this.select(tx, {}));
    const result = verifyChain(entries);
    if (!result.ok && result.break) {
      const brk = result.break;
      await this.o.kernel.mutate(
        ctx,
        async (tx) => {
          await this.o.sink.record(tx, {
            action: "audit.chain.break_detected",
            resourceType: "ledger",
            resourceId: brk.id,
            after: brk,
          });
          await this.emit(tx, "LedgerChainBroken", {
            tenant_id: ctx.tenantId,
            seq: brk.seq,
            entry_id: brk.id,
            reason: brk.reason,
          });
        },
        { action: "audit.chain.break_detected" },
      );
    }
    return result;
  }

  /**
   * The statutory capture's gap detector for the context tenant (R1-D-25): the chain, its head and
   * `audit.capture_problems()`. A break or a problem is ledgered and raises LedgerChainBroken.
   */
  async verifyCapture(ctx: KernelContext): Promise<CaptureVerifyResult> {
    const result = await new StatutoryCapture({ kernel: this.o.kernel }).verify(ctx);
    if (!result.ok) {
      const reason = result.break ? `capture-${result.break.reason}` : "capture-incomplete";
      await this.o.kernel.mutate(
        ctx,
        async (tx) => {
          await this.o.sink.record(tx, {
            action: "audit.capture.break_detected",
            resourceType: "audit.capture",
            resourceId: String(result.break?.seq ?? result.head.seq),
            after: { reason, break: result.break ?? null, problems: result.problems },
          });
          await this.emit(tx, "LedgerChainBroken", {
            tenant_id: ctx.tenantId,
            seq: result.break?.seq ?? result.head.seq,
            entry_id: `capture:${result.break?.seq ?? result.head.seq}`,
            reason,
          });
        },
        { action: "audit.capture.break_detected" },
      );
    }
    return result;
  }

  /** Build, sign and store the anchor for `date` (YYYY-MM-DD, UTC) for the context tenant. */
  async writeAnchor(ctx: KernelContext, date: string, now = new Date()): Promise<AnchorFile> {
    const { storage, kms, anchorKeyId } = this.o;
    if (!storage || !kms || !anchorKeyId)
      throw new Error("anchors need STORAGE, KMS and anchorKeyId");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("date must be YYYY-MM-DD");
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const head = await tx.query<{ seq: string; entry_hash: string; id: string }>(
          `select seq, entry_hash, id from audit.ledger
          where occurred_at < ($1::date + 1)::timestamp at time zone 'UTC'
          order by seq desc limit 1`,
          [date],
        );
        const h = head.rows[0];
        // The statutory capture's head at the end of the same day, where the tenant has one.
        const cap = (
          await tx.query<{ seq: string; entry_hash: string }>(
            `select seq::text as seq, entry_hash from audit.capture
              where occurred_at < ($1::date + 1)::timestamp at time zone 'UTC'
              order by audit.capture.seq desc limit 1`,
            [date],
          )
        ).rows[0];
        const body: AnchorBody = {
          format: cap ? ANCHOR_FORMAT_CAPTURE : ANCHOR_FORMAT,
          tenant_id: ctx.tenantId,
          anchor_date: date,
          seq: h ? Number(h.seq) : 0,
          head_hash: h?.entry_hash ?? GENESIS_HASH,
          head_entry_id: h?.id ?? null,
          ...(cap ? { capture_seq: Number(cap.seq), capture_head_hash: cap.entry_hash } : {}),
          created_at: now.toISOString(),
        };
        const signature = await signRecord(kms, anchorKeyId, canonicalize(body), { now });
        const file: AnchorFile = { ...body, signature };
        const id = newId("anc");
        const key = storageKey(ctx.tenantId, "audit", id.slice("anc_".length), "json");
        const retainUntil = new Date(
          Date.parse(`${date}T00:00:00Z`) +
            (this.o.retentionDays ?? LEDGER_RETENTION_DAYS) * 86_400_000,
        );
        await storage.putWithRetention(
          key,
          new TextEncoder().encode(`${JSON.stringify(file, null, 2)}\n`),
          retainUntil,
          {
            bucketClass: "AUDIT",
            contentType: "application/json",
          },
        );
        await tx.query(
          `insert into audit.anchor (id, tenant_id, anchor_date, seq, head_hash, signature, alg, key_id, storage_key)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            id,
            ctx.tenantId,
            date,
            body.seq,
            body.head_hash,
            signature.value,
            signature.alg,
            signature.key_id,
            key,
          ],
        );
        await this.o.sink.record(tx, {
          action: "audit.anchor.write",
          resourceType: "anchor",
          resourceId: id,
          after: body,
        });
        await this.emit(tx, "LedgerAnchorWritten", {
          tenant_id: ctx.tenantId,
          anchor_date: date,
          seq: body.seq,
          head_hash: body.head_hash,
          storage_key: key,
        });
        return file;
      },
      { action: "audit.anchor.write" },
    );
  }

  private async select(tx: Tx, f: LedgerFilter): Promise<LedgerEntry[]> {
    const where: string[] = [];
    const p: unknown[] = [];
    const add = (sql: string, v: unknown) => {
      p.push(v);
      where.push(sql.replace("?", `$${p.length}`));
    };
    if (f.resourceType) add("resource_type = ?", f.resourceType);
    if (f.resourceId) add("resource_id = ?", f.resourceId);
    if (f.action) add("action = ?", f.action);
    if (f.actorId) add("actor_id = ?", f.actorId);
    if (f.from) add("occurred_at >= ?", f.from);
    if (f.to) add("occurred_at < ?", f.to);
    if (f.afterSeq !== undefined) add("seq > ?", f.afterSeq);
    const limit = f.limit ? ` limit ${Math.max(1, Math.min(10_000, Math.floor(f.limit)))}` : "";
    const r = await tx.query<Row>(
      `select * from audit.ledger${where.length ? ` where ${where.join(" and ")}` : ""} order by seq${limit}`,
      p,
    );
    return r.rows.map(toEntry);
  }

  private async emit(
    tx: Tx,
    event: "LedgerAnchorWritten" | "LedgerChainBroken",
    data: Record<string, unknown>,
  ): Promise<void> {
    if (!this.o.outbox) return;
    const envelope = internalEvent({
      product: this.o.product,
      event,
      tenantId: tx.ctx.tenantId,
      data,
      actorId: tx.ctx.principal.id,
      ...(this.o.pseudonymKey ? { pseudonymKey: this.o.pseudonymKey } : {}),
    });
    await this.o.outbox.publish(tx, "audit", { envelope });
  }
}

/** Verify an anchor file with the public key alone (Trust Centre download, IPB-02 §02.4.7.1). */
export function verifyAnchorFile(file: AnchorFile, publicKeySpkiDer: Uint8Array): boolean {
  const { signature, ...body } = file;
  return verifyRecord(signature, canonicalize(body), publicKeySpkiDer);
}

/** A tenant verifies its exported ledger slice up to a signed anchor. */
export function verifyAgainstAnchor(
  entries: readonly LedgerEntry[],
  file: AnchorFile,
  publicKeySpkiDer: Uint8Array,
): VerifyResult & { signatureValid: boolean } {
  const signatureValid = verifyAnchorFile(file, publicKeySpkiDer);
  const r = verifyChain(entries.filter((e) => e.seq <= file.seq));
  if (r.ok && (r.head.seq !== file.seq || r.head.hash !== file.head_hash)) {
    return {
      ...r,
      ok: false,
      signatureValid,
      break: { seq: file.seq, id: file.head_entry_id ?? "", reason: "head-mismatch" },
    };
  }
  return { ...r, signatureValid };
}

/** A tenant or auditor verifies the exported capture up to a signed anchor (format 2). */
export function verifyCaptureAgainstAnchor(
  entries: readonly CaptureEntry[],
  file: AnchorFile,
  publicKeySpkiDer: Uint8Array,
): Omit<CaptureVerifyResult, "problems"> & { signatureValid: boolean } {
  const signatureValid = verifyAnchorFile(file, publicKeySpkiDer);
  if (file.format !== ANCHOR_FORMAT_CAPTURE || file.capture_seq === undefined)
    return {
      ok: false,
      checked: 0,
      head: { seq: 0, hash: GENESIS_HASH },
      break: { seq: 0, reason: "head-mismatch" },
      signatureValid,
    };
  const r = verifyCaptureChain(entries.filter((e) => e.seq <= file.capture_seq!));
  if (r.ok && (r.head.seq !== file.capture_seq || r.head.hash !== file.capture_head_hash))
    return {
      ...r,
      ok: false,
      break: { seq: file.capture_seq, reason: "head-mismatch" },
      signatureValid,
    };
  return { ...r, signatureValid };
}
