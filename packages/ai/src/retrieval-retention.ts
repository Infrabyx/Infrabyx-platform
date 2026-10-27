// Retired retrieval index versions (IPB-03-32; owner approval OWNER-QUESTIONS #34, PL4-D-13). When
// `activate` switches a name to a new version, the previous version is retired and PostgreSQL
// stamps `retired_at`. Thirty days later `RetrievalRetention.sweep()` deletes the version: its
// chunks in batches, then the version row, each step ledgered in its own transaction. PostgreSQL
// refuses any other delete of chunks or versions (migration `ai/0005`). A version brought back
// within the 30 days loses its `retired_at` and is kept.
import type { AuditSink, KernelContext, MutationKernel } from "@infrabyx/contracts/kernel";
import { ServiceReader } from "@infrabyx/tenancy";

/** The owner's period (PL4-D-13); PostgreSQL enforces the same 30 days. */
export const RETIRED_INDEX_RETENTION_DAYS = 30;
export const AI_INDEX_SWEEP_PRINCIPAL_ID = "svc_ai_index_sweep";
const NOTHING_DUE = Symbol("nothing due");

/** The sweep's per-tenant context: a service principal that only deletes retired versions. */
export const indexSweepContext = (tenantId: string): KernelContext => ({
  tenantId,
  principal: { id: AI_INDEX_SWEEP_PRINCIPAL_ID, type: "service", roles: ["SVC_AI_RETENTION"] },
});

export interface RetrievalRetentionOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  onRead?: ConstructorParameters<typeof ServiceReader>[0]["onRead"];
}

export class RetrievalRetention {
  private readonly reader: ServiceReader;
  constructor(private readonly o: RetrievalRetentionOptions) {
    this.reader = new ServiceReader({
      kernel: o.kernel,
      audit: o.audit,
      role: "SVC_AI_INDEX_SWEEP",
      principalId: AI_INDEX_SWEEP_PRINCIPAL_ID,
      ...(o.onRead ? { onRead: o.onRead } : {}),
    });
  }

  /**
   * Run daily from one worker. Finds retired versions past 30 days through SVC_AI_INDEX_SWEEP
   * (ledgered per tenant), then per version deletes its chunks in batches (one
   * `ai.index.purge_chunks` entry per batch) and the version row (`ai.index.purge`).
   */
  async sweep(o: { batch?: number } = {}): Promise<{ versions: number; chunks: number }> {
    const batch = Math.min(o.batch ?? 1000, 5000);
    const due = await this.reader.read<{ id: string; tenant_id: string }>(
      "ai.retrieval_index",
      `select id, tenant_id from ai.retrieval_index
        where state = 'retired' and retired_at < now() - make_interval(days => $1)
        order by tenant_id, id`,
      [RETIRED_INDEX_RETENTION_DAYS],
    );
    let versions = 0;
    let chunks = 0;
    for (const v of due) {
      for (;;) {
        const n = await this.purgeChunks(v.tenant_id, v.id, batch);
        chunks += n;
        if (n < batch) break;
      }
      if (await this.purgeVersion(v.tenant_id, v.id)) versions++;
    }
    return { versions, chunks };
  }

  private async purgeChunks(tenantId: string, indexId: string, size: number): Promise<number> {
    try {
      return await this.o.kernel.mutate(
        indexSweepContext(tenantId),
        async (tx) => {
          const r = await tx.query<{ id: string }>(
            `delete from ai.chunk where id in (
               select id from ai.chunk where index_id = $1 order by id limit $2)
             returning id`,
            [indexId, size],
          );
          if (!r.rows.length) throw NOTHING_DUE;
          await this.o.audit.record(tx, {
            action: "ai.index.purge_chunks",
            resourceType: "retrieval_index",
            resourceId: indexId,
            after: { chunks: r.rows.length, reason: "retired", retention_days: 30 },
          });
          return r.rows.length;
        },
        { action: "ai.index.purge_chunks" },
      );
    } catch (e) {
      if (e === NOTHING_DUE) return 0;
      throw e;
    }
  }

  private async purgeVersion(tenantId: string, indexId: string): Promise<boolean> {
    try {
      return await this.o.kernel.mutate(
        indexSweepContext(tenantId),
        async (tx) => {
          const r = await tx.query<{ name: string; version: number }>(
            "delete from ai.retrieval_index where id = $1 returning name, version",
            [indexId],
          );
          // Brought back meanwhile, or another sweep took it: roll back, ledger nothing.
          const row = r.rows[0];
          if (!row) throw NOTHING_DUE;
          await this.o.audit.record(tx, {
            action: "ai.index.purge",
            resourceType: "retrieval_index",
            resourceId: indexId,
            after: { name: row.name, version: row.version, reason: "retired", retention_days: 30 },
          });
          return true;
        },
        { action: "ai.index.purge" },
      );
    } catch (e) {
      if (e === NOTHING_DUE) return false;
      throw e;
    }
  }
}
