// Statement analyses by record and by idempotency key (Udofin PR-UDF-048, R1-D-202; threat model
// §3.144), the KYC store pattern (`kyc/bank-account.ts`). Every `analyse` call leaves a record, keyed
// or not, so `status` finds a pending analysis's report prefix and vendor reference; a keyed retry
// gets the first analysis and the analyser is asked once per key, and the key with another request
// is `IPB-PORT-004` before any analyser call. References and hashes only: the key is kept as
// SHA-256, the request as a SHA-256 of its canonical form (JCS), which binds the statements' own
// SHA-256 digests and so cannot be tested against guesses without the statements; no HMAC and no
// new key is needed. A record lives 24 hours (IPB-10-07's window, as #144). `PgStatementAnalysisStore`
// is the production store (`connectors.statement_analysis`, migration 0014);
// `MemoryStatementAnalysisStore` serves tests and a single process.
import { PortError } from "@infrabyx/contracts/errors";
import type { AuditSink, KernelContext, MutationKernel, Tx } from "@infrabyx/contracts/kernel";
import {
  statementAnalysisResultOnly,
  type StatementAnalysis,
  type StatementAnalysisInput,
} from "@infrabyx/contracts/ports";
import { canonicalize, newId, sha256Hex } from "@infrabyx/crypto";

/** Hours a record is kept (IPB-10-07). */
export const STATEMENT_ANALYSIS_TTL_HOURS = 24;

/** The parsed request, as the store binds it. */
export interface StatementAnalysisBinding {
  subjectRef: string;
  inputs: StatementAnalysisInput[];
  reportPrefix: string;
}

export interface StatementAnalysisStoreRequest {
  tenantId: string;
  /** The adapter's descriptor name; each adapter keeps its own records. */
  adapter: string;
  idempotencyKey?: string;
  request: StatementAnalysisBinding;
}

/** What `reserve` found or made. */
export type StatementAnalysisReservation =
  | { kind: "new"; analysisId: string }
  /** A keyed call with this key started and left no answer (a crash, a time-out, a vendor error). */
  | { kind: "requested"; analysisId: string }
  | { kind: "answered"; analysisId: string; result: StatementAnalysis };

export interface StatementAnalysisRecord {
  analysisId: string;
  reportPrefix: string;
  /** Undefined while no answer has been kept. */
  result?: StatementAnalysis;
}

export interface StatementAnalysisStore {
  /** A new record, or what an earlier call with the key left; `IPB-PORT-004` on another request. */
  reserve(r: StatementAnalysisStoreRequest): Promise<StatementAnalysisReservation>;
  /**
   * Keep an answer. A record moves forward only; a final one (COMPLETED or FAILED) is kept as it
   * is, and the kept answer is returned.
   */
  record(
    tenantId: string,
    adapter: string,
    analysisId: string,
    result: StatementAnalysis,
  ): Promise<StatementAnalysis>;
  /** The tenant's unexpired record, or undefined. */
  get(
    tenantId: string,
    adapter: string,
    analysisId: string,
  ): Promise<StatementAnalysisRecord | undefined>;
}

export const statementAnalysisKeyHash = (key: string): string =>
  sha256Hex(`statement-analysis-key:${key}`);

/** The request's binding: SHA-256 over its canonical form (subject, inputs in order, prefix). */
export function statementAnalysisRequestHash(r: StatementAnalysisBinding): string {
  return sha256Hex(
    `statement-analysis-request:${canonicalize({
      subjectRef: r.subjectRef,
      inputs: r.inputs.map((i) => ({
        fiType: i.fiType,
        storageKey: i.storageKey,
        sha256: i.sha256,
      })),
      reportPrefix: r.reportPrefix,
    })}`,
  );
}

export function statementAnalysisConflict(adapter: string): PortError {
  return new PortError("IPB-PORT-004", "STATEMENT_ANALYSIS", {
    adapter,
    detail: "idempotency key reused with other statements, subject or report prefix",
    meta: { reason: "idempotency_conflict" },
  });
}

const FINAL = new Set(["COMPLETED", "FAILED"]);
const column = (s: StatementAnalysis["state"]) =>
  s.toLowerCase() as "pending" | "completed" | "failed";

/** In-memory store for tests and a single process. */
export class MemoryStatementAnalysisStore implements StatementAnalysisStore {
  private readonly rows = new Map<
    string,
    {
      tenantId: string;
      adapter: string;
      keyHash?: string;
      request: string;
      reportPrefix: string;
      result?: StatementAnalysis;
      expiresAt: number;
    }
  >();
  constructor(private readonly o: { now?: () => Date; ttlHours?: number } = {}) {}
  private now(): number {
    return (this.o.now?.() ?? new Date()).getTime();
  }

  async reserve(r: StatementAnalysisStoreRequest): Promise<StatementAnalysisReservation> {
    const request = statementAnalysisRequestHash(r.request);
    const kh = r.idempotencyKey ? statementAnalysisKeyHash(r.idempotencyKey) : undefined;
    if (kh)
      for (const [id, row] of this.rows) {
        if (row.tenantId !== r.tenantId || row.adapter !== r.adapter || row.keyHash !== kh)
          continue;
        if (row.expiresAt <= this.now()) {
          this.rows.delete(id);
          break;
        }
        if (row.request !== request) throw statementAnalysisConflict(r.adapter);
        return row.result
          ? { kind: "answered", analysisId: id, result: structuredClone(row.result) }
          : { kind: "requested", analysisId: id };
      }
    const analysisId = newId("sta");
    this.rows.set(analysisId, {
      tenantId: r.tenantId,
      adapter: r.adapter,
      ...(kh ? { keyHash: kh } : {}),
      request,
      reportPrefix: r.request.reportPrefix,
      expiresAt: this.now() + (this.o.ttlHours ?? STATEMENT_ANALYSIS_TTL_HOURS) * 3600_000,
    });
    return { kind: "new", analysisId };
  }

  async record(
    tenantId: string,
    adapter: string,
    analysisId: string,
    result: StatementAnalysis,
  ): Promise<StatementAnalysis> {
    const row = this.rows.get(analysisId);
    const kept = statementAnalysisResultOnly(result);
    if (!row || row.tenantId !== tenantId || row.adapter !== adapter) return kept;
    if (!row.result || !FINAL.has(row.result.state)) row.result = kept;
    return structuredClone(row.result);
  }

  async get(
    tenantId: string,
    adapter: string,
    analysisId: string,
  ): Promise<StatementAnalysisRecord | undefined> {
    const row = this.rows.get(analysisId);
    if (!row || row.tenantId !== tenantId || row.adapter !== adapter) return undefined;
    if (row.expiresAt <= this.now()) return undefined;
    return {
      analysisId,
      reportPrefix: row.reportPrefix,
      ...(row.result ? { result: structuredClone(row.result) } : {}),
    };
  }
}

export interface PgStatementAnalysisStoreOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  /** The kernel context to write a tenant's records in (the adapter's service principal). */
  context: (tenantId: string) => KernelContext;
  ttlHours?: number;
}

interface Row {
  id: string;
  request_hash: string;
  report_prefix: string;
  state: "requested" | "pending" | "completed" | "failed";
  result: StatementAnalysis | null;
}

const COLS = "id, request_hash, report_prefix, state, result";

/**
 * PostgreSQL store on `connectors.statement_analysis`. Every write goes through the kernel with a
 * ledger entry that names the row, the adapter, the key's hash and the state; never the key, the
 * subject reference, the inputs or the answer.
 */
export class PgStatementAnalysisStore implements StatementAnalysisStore {
  constructor(private readonly o: PgStatementAnalysisStoreOptions) {}

  private ctx(tenantId: string): KernelContext {
    const ctx = this.o.context(tenantId);
    if (ctx.tenantId !== tenantId)
      throw new PortError("IPB-PORT-001", "STATEMENT_ANALYSIS", {
        detail: "the statement analysis store's context names another tenant",
        meta: { reason: "tenant_mismatch" },
      });
    return ctx;
  }

  async reserve(r: StatementAnalysisStoreRequest): Promise<StatementAnalysisReservation> {
    const ctx = this.ctx(r.tenantId);
    const kh = r.idempotencyKey ? statementAnalysisKeyHash(r.idempotencyKey) : null;
    const request = statementAnalysisRequestHash(r.request);
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        // An expired record of this key is forgotten before the new one is written.
        if (kh)
          await tx.query(
            `delete from connectors.statement_analysis
              where tenant_id = $1 and adapter = $2 and key_hash = $3 and expires_at <= now()`,
            [ctx.tenantId, r.adapter, kh],
          );
        const id = newId("sta");
        const ins = await tx.query<{ id: string }>(
          `insert into connectors.statement_analysis
             (id, tenant_id, adapter, key_hash, request_hash, report_prefix, state, expires_at)
           values ($1, $2, $3, $4, $5, $6, 'requested', now() + make_interval(hours => $7))
           on conflict do nothing returning id`,
          [
            id,
            ctx.tenantId,
            r.adapter,
            kh,
            request,
            r.request.reportPrefix,
            this.o.ttlHours ?? STATEMENT_ANALYSIS_TTL_HOURS,
          ],
        );
        if (ins.rowCount) {
          await this.ledger(tx, "reserve", id, r.adapter, kh, "requested");
          return { kind: "new", analysisId: id } as StatementAnalysisReservation;
        }
        const row = (
          await tx.query<Row>(
            `select ${COLS} from connectors.statement_analysis
              where tenant_id = $1 and adapter = $2 and key_hash = $3 for update`,
            [ctx.tenantId, r.adapter, kh],
          )
        ).rows[0]!;
        if (row.request_hash !== request) throw statementAnalysisConflict(r.adapter);
        await this.ledger(tx, row.result ? "replay" : "found", row.id, r.adapter, kh, row.state);
        return row.result
          ? { kind: "answered", analysisId: row.id, result: row.result }
          : { kind: "requested", analysisId: row.id };
      },
      { action: "connectors.statement_analysis.reserve" },
    );
  }

  async record(
    tenantId: string,
    adapter: string,
    analysisId: string,
    result: StatementAnalysis,
  ): Promise<StatementAnalysis> {
    const ctx = this.ctx(tenantId);
    const kept = statementAnalysisResultOnly(result);
    const final = await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const up = await tx.query<Row>(
          `update connectors.statement_analysis
              set state = $3, result = $4::jsonb, vendor_ref = coalesce(vendor_ref, $5)
            where id = $1 and adapter = $2 and state in ('requested', 'pending')
              and (vendor_ref is null or vendor_ref = $5)
          returning ${COLS}`,
          [analysisId, adapter, column(kept.state), JSON.stringify(kept), kept.vendorRef],
        );
        if (up.rowCount) {
          await this.ledger(tx, "record", analysisId, adapter, null, column(kept.state));
          return up.rows[0]!;
        }
        // Already final (or answered by another call first): the kept answer is the answer.
        const row = (
          await tx.query<Row>(`select ${COLS} from connectors.statement_analysis where id = $1`, [
            analysisId,
          ])
        ).rows[0];
        await this.ledger(tx, "replay", analysisId, adapter, null, row?.state ?? "none");
        return row;
      },
      { action: "connectors.statement_analysis.record" },
    );
    return final?.result ?? kept;
  }

  async get(
    tenantId: string,
    adapter: string,
    analysisId: string,
  ): Promise<StatementAnalysisRecord | undefined> {
    const ctx = this.ctx(tenantId);
    const row = await this.o.kernel.read(ctx, async (tx) => {
      const r = await tx.query<Row>(
        `select ${COLS} from connectors.statement_analysis
          where id = $1 and tenant_id = $2 and adapter = $3 and expires_at > now()`,
        [analysisId, ctx.tenantId, adapter],
      );
      return r.rows[0];
    });
    if (!row) return undefined;
    return {
      analysisId: row.id,
      reportPrefix: row.report_prefix,
      ...(row.result ? { result: row.result } : {}),
    };
  }

  /** Delete this tenant's expired records (IPB-10-07); a product's maintenance job calls it. */
  async purgeExpired(tenantId: string): Promise<number> {
    const ctx = this.ctx(tenantId);
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const d = await tx.query(
          `delete from connectors.statement_analysis where tenant_id = $1 and expires_at <= now()`,
          [ctx.tenantId],
        );
        await this.o.audit.record(tx, {
          action: "connectors.statement_analysis.purge",
          resourceType: "connectors.statement_analysis",
          resourceId: ctx.tenantId,
          after: { deleted: d.rowCount ?? 0 },
        });
        return d.rowCount ?? 0;
      },
      { action: "connectors.statement_analysis.purge" },
    );
  }

  private async ledger(
    tx: Tx,
    step: string,
    id: string,
    adapter: string,
    kh: string | null,
    state: string,
  ): Promise<void> {
    await this.o.audit.record(tx, {
      action: `connectors.statement_analysis.${step}`,
      resourceType: "connectors.statement_analysis",
      resourceId: id,
      after: { adapter, key_hash: kh, state },
    });
  }
}
