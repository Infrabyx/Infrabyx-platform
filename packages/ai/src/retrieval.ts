// Tenant-scoped hybrid retrieval with citations (IPB-03-29 to 03-32; PL4 plan §4.9).
// - Isolation: every read runs in the caller's kernel context, so PostgreSQL's forced RLS returns
//   only the caller's tenant (@IPB-03-AT-05). On top, the product's `authorize` callback (its AUTHZ
//   check on `resource_ref`) removes anything the caller may not read, and a data-class ceiling
//   removes chunks above what the calling feature may receive. Nothing is returned on trust.
// - Hybrid search: pgvector HNSW (cosine) and PostgreSQL full-text search, fused with reciprocal
//   rank fusion (k = 60). The optional RERANK port is not wired in PL4 (IPB-03-08 is S tier, #28).
// - Personal data: chunks are embedded and indexed from scrubbed text (the scrubber's tokens), so
//   neither the vectors nor the lexical index carry identifiers; the original text is sealed with
//   FieldCrypto and opened only for the caller's tenant.
// - Re-embedding (IPB-03-32): a new index version is built in resumable batches while searches keep
//   reading the active version, then `activate` switches (the QUEUE drives the batches; A-10).
// - Erasure (OWNER-QUESTIONS #34, PL4-D-13): `deleteResource` deletes every chunk of a resource the
//   product deleted, in every version, ledgered. Writes of a resource's chunks and its erasure take
//   the same transaction lock, and a re-embedding copy read before an erasure is dropped, so an
//   erased resource cannot come back through a batch in flight. Retired versions are deleted after
//   30 days by `RetrievalRetention` (retrieval-retention.ts).
import type { DataClass } from "@infrabyx/contracts/data-class";
import { IpbError } from "@infrabyx/contracts/errors";
import type { AuditSink, KernelContext, MutationKernel, Tx } from "@infrabyx/contracts/kernel";
import type { DataBlock } from "@infrabyx/contracts";
import { FIELD_ALG, newId, sha256Hex, type SealedField } from "@infrabyx/crypto";
import { NotFoundError } from "@infrabyx/tenancy";
import type { EmbeddingGateway } from "./embedding.js";
import { CLASS_RANK, maxClass } from "./registry.js";

export const RRF_K = 60;
export const INDEX_DIMS = [256, 384, 512, 768, 1024, 1536] as const;
const EMBED_BATCH = 64;

/** The slice of `FieldCrypto` retrieval needs. */
export interface ChunkSealer {
  encryptField(
    tenantId: string,
    cls: DataClass,
    plaintext: string,
    at: { table: string; column: string; rowId: string },
  ): Promise<SealedField>;
  decryptField(
    tenantId: string,
    sealed: SealedField,
    at: { table: string; column: string; rowId: string },
  ): Promise<Uint8Array>;
}

/** The product's AUTHZ check: which of these resources may the caller read? */
export type RetrievalAuthorizer = (
  ctx: KernelContext,
  resourceRefs: readonly string[],
) => Promise<ReadonlySet<string>>;

export interface RetrievalIndex {
  id: string;
  name: string;
  version: number;
  embeddingModel: string;
  dims: number;
  chunker: string;
  state: "building" | "active" | "retired";
}

export interface ChunkInput {
  resourceRef: string;
  entityId?: string;
  /** Page, paragraph or row (IPB-03-31). */
  locator?: string;
  dataClass: Exclude<DataClass, "SECRET">;
  text: string;
  /** The product's access descriptor for the resource; stored as a hash. */
  acl: string;
}

export interface RetrievedChunk {
  chunkId: string;
  resourceRef: string;
  entityId: string | null;
  locator: string | null;
  dataClass: DataClass;
  text: string;
  score: number;
}

export interface SearchRequest {
  index: string;
  query: string;
  /** The class the query text carries (raised by the scrubber if it finds more). */
  queryClass: DataClass;
  /** The most the calling feature may receive; chunks above it are never returned. */
  maxDataClass: DataClass;
  featureKey: string;
  k?: number;
}

export interface SearchResult {
  chunks: RetrievedChunk[];
  /** The same chunks as data blocks for the LLM gateway (kind `retrieved`, source = chunk id). */
  blocks: DataBlock[];
  /** The highest class among the returned chunks (feeds the gateway's class). */
  dataClass: DataClass;
  queryRunId: string;
}

export interface RetrievalServiceOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  embeddings: EmbeddingGateway;
  sealer: ChunkSealer;
  authorize: RetrievalAuthorizer;
}

interface IndexRow {
  id: string;
  name: string;
  version: number;
  embedding_model: string;
  dims: number;
  chunker: string;
  state: RetrievalIndex["state"];
}
const toIndex = (r: IndexRow): RetrievalIndex => ({
  id: r.id,
  name: r.name,
  version: r.version,
  embeddingModel: r.embedding_model,
  dims: r.dims,
  chunker: r.chunker,
  state: r.state,
});
/** Serialises chunk writes and the erasure of one resource (transaction-scoped). */
export const lockResources = async (
  tx: Tx,
  tenantId: string,
  refs: Iterable<string>,
): Promise<void> => {
  for (const ref of [...new Set(refs)].sort())
    await tx.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
      `ai.chunk:${tenantId}:${ref}`,
    ]);
};

const isAgent = (ctx: KernelContext) =>
  ctx.principal.type === "agent" || ctx.principal.roles.some((r) => r.startsWith("AGT_"));

const vectorLiteral = (v: readonly number[]) => `[${v.map((x) => Number(x).toString()).join(",")}]`;
const at = (id: string) => ({ table: "ai.chunk", column: "text_enc", rowId: id });
const sealClass = (c: DataClass): DataClass => maxClass(c, "CONFIDENTIAL");

export class RetrievalService {
  constructor(private readonly o: RetrievalServiceOptions) {}

  /** A new version of `name`, in `building` state (the first version too). Ledgered. */
  async createIndex(
    ctx: KernelContext,
    i: { name: string; embeddingModel: string; dims: number; chunker: string },
  ): Promise<RetrievalIndex> {
    if (!(INDEX_DIMS as readonly number[]).includes(i.dims))
      throw new IpbError("IPB-AI-011", {
        detail: `supported dimensions: ${INDEX_DIMS.join(", ")}`,
      });
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const r = await tx.query<IndexRow>(
          `insert into ai.retrieval_index
             (id, tenant_id, name, version, embedding_model, dims, chunker, created_by)
           select $1, $2, $3, coalesce(max(version), 0) + 1, $4, $5, $6, $7
             from ai.retrieval_index where tenant_id = $2 and name = $3
           returning *`,
          [
            newId("idx"),
            ctx.tenantId,
            i.name,
            i.embeddingModel,
            i.dims,
            i.chunker,
            ctx.principal.id,
          ],
        );
        const row = r.rows[0] as IndexRow;
        await this.o.audit.record(tx, {
          action: "ai.index.create",
          resourceType: "retrieval_index",
          resourceId: row.id,
          after: { name: i.name, version: row.version, model: i.embeddingModel, dims: i.dims },
        });
        return toIndex(row);
      },
      { action: "ai.index.create" },
    );
  }

  /** Make a version the one searches read; the previous active version is retired. */
  async activate(ctx: KernelContext, indexId: string): Promise<RetrievalIndex> {
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const idx = await this.indexById(tx, indexId);
        const prev = await tx.query<{ id: string }>(
          `update ai.retrieval_index set state = 'retired'
            where tenant_id = $1 and name = $2 and state = 'active' and id <> $3 returning id`,
          [ctx.tenantId, idx.name, indexId],
        );
        const r = await tx.query<IndexRow>(
          `update ai.retrieval_index set state = 'active', activated_at = now()
            where id = $1 returning *`,
          [indexId],
        );
        await this.o.audit.record(tx, {
          action: "ai.index.activate",
          resourceType: "retrieval_index",
          resourceId: indexId,
          before: { active: prev.rows[0]?.id ?? null },
          after: { active: indexId },
        });
        return toIndex(r.rows[0] as IndexRow);
      },
      { action: "ai.index.activate" },
    );
  }

  private async indexById(tx: Tx, id: string): Promise<RetrievalIndex> {
    const r = await tx.query<IndexRow>("select * from ai.retrieval_index where id = $1", [id]);
    if (!r.rows[0]) throw new NotFoundError("retrieval index");
    return toIndex(r.rows[0]);
  }

  /** The version searches read. */
  async activeIndex(ctx: KernelContext, name: string): Promise<RetrievalIndex> {
    return this.o.kernel.read(ctx, async (tx) => {
      const r = await tx.query<IndexRow>(
        "select * from ai.retrieval_index where name = $1 and state = 'active'",
        [name],
      );
      if (!r.rows[0]) throw new NotFoundError("active retrieval index");
      return toIndex(r.rows[0]);
    });
  }

  /**
   * Embed and store chunks in a version (any state). Embedding happens first, through the gateway
   * pinned to the index's model; the rows and one ledger entry per batch follow in one transaction.
   */
  addChunks(
    ctx: KernelContext,
    indexId: string,
    chunks: readonly ChunkInput[],
    featureKey = "ai.retrieval.index",
  ): Promise<string[]> {
    return this.ingest(
      ctx,
      indexId,
      chunks.map(({ acl, ...c }) => ({ ...c, aclHash: sha256Hex(acl) })),
      featureKey,
    );
  }

  private async ingest(
    ctx: KernelContext,
    indexId: string,
    chunks: readonly (Omit<ChunkInput, "acl"> & { aclHash: string })[],
    featureKey: string,
    /** Re-embedding copies: the time their source was read; erasures since then drop them. */
    copiedAt?: Date,
  ): Promise<string[]> {
    const idx = await this.o.kernel.read(ctx, (tx) => this.indexById(tx, indexId));
    const ids: string[] = [];
    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      const batch = chunks.slice(i, i + EMBED_BATCH);
      for (const c of batch)
        if ((c.dataClass as string) === "SECRET")
          throw new IpbError("IPB-AI-012", { detail: "SECRET text is never indexed" });
      const e = await this.o.embeddings.embed(ctx, {
        featureKey,
        dataClass: maxClass(...batch.map((c) => c.dataClass)),
        texts: batch.map((c) => c.text),
        modelPin: idx.embeddingModel,
        dims: idx.dims,
        taskType: "document",
      });
      const rows = await Promise.all(
        batch.map(async (c, j) => {
          const id = newId("chk");
          const sealed = await this.o.sealer.encryptField(
            ctx.tenantId,
            sealClass(c.dataClass),
            c.text,
            at(id),
          );
          return { id, c, sealed, scrubbed: e.scrubbed[j] as string, vector: e.vectors[j]! };
        }),
      );
      const stored = await this.o.kernel.mutate(
        ctx,
        async (tx) => {
          await lockResources(
            tx,
            ctx.tenantId,
            rows.map((r) => r.c.resourceRef),
          );
          let keep = rows;
          if (copiedAt) {
            const erased = await tx.query<{ resource_ref: string }>(
              `select distinct resource_ref from ai.resource_erasure
                where resource_ref = any($1::text[]) and erased_at >= $2`,
              [[...new Set(rows.map((r) => r.c.resourceRef))], copiedAt],
            );
            const gone = new Set(erased.rows.map((x) => x.resource_ref));
            keep = rows.filter((r) => !gone.has(r.c.resourceRef));
          }
          for (const r of keep)
            await tx.query(
              `insert into ai.chunk
                 (id, tenant_id, index_id, entity_id, resource_ref, locator, acl_hash, data_class,
                  content_sha256, text_enc, text_key_id, tsv, dims, embedding)
               values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, to_tsvector('simple', $12),
                       $13, $14::vector)`,
              [
                r.id,
                ctx.tenantId,
                indexId,
                r.c.entityId ?? null,
                r.c.resourceRef,
                r.c.locator ?? null,
                r.c.aclHash,
                r.c.dataClass,
                sha256Hex(r.c.text),
                Buffer.from(r.sealed.enc),
                r.sealed.keyId,
                r.scrubbed,
                idx.dims,
                vectorLiteral(r.vector),
              ],
            );
          await this.o.audit.record(tx, {
            action: "ai.index.add_chunks",
            resourceType: "retrieval_index",
            resourceId: indexId,
            after: {
              count: keep.length,
              embed_run: e.runId,
              ...(keep.length < rows.length ? { dropped_erased: rows.length - keep.length } : {}),
            },
          });
          return keep;
        },
        { action: "ai.index.add_chunks" },
      );
      ids.push(...stored.map((r) => r.id));
    }
    return ids;
  }

  /** Hybrid search in the active version of `index`, scoped to the caller (IPB-03-29, 03-30). */
  async search(ctx: KernelContext, req: SearchRequest): Promise<SearchResult> {
    const k = Math.min(Math.max(req.k ?? 8, 1), 50);
    const idx = await this.activeIndex(ctx, req.index);
    const q = await this.o.embeddings.embed(ctx, {
      featureKey: req.featureKey,
      dataClass: req.queryClass,
      texts: [req.query],
      modelPin: idx.embeddingModel,
      dims: idx.dims,
      taskType: "query",
    });
    const pool = k * 4;
    const ceiling = Math.min(CLASS_RANK[req.maxDataClass], CLASS_RANK.REGULATED);
    const dims = idx.dims;
    const ranked = await this.o.kernel.read(ctx, async (tx) => {
      await tx.query("set local hnsw.ef_search = 100");
      await tx.query("set local hnsw.iterative_scan = relaxed_order");
      const v = await tx.query<{ id: string }>(
        `select id from ai.chunk
          where index_id = $1 and dims = ${dims} and class_rank <= $2
          order by embedding::vector(${dims}) <=> $3::vector(${dims}) limit $4`,
        [idx.id, ceiling, vectorLiteral(q.vectors[0]!), pool],
      );
      const l = await tx.query<{ id: string }>(
        `select id from ai.chunk, websearch_to_tsquery('simple', $3) query
          where index_id = $1 and class_rank <= $2 and tsv @@ query
          order by ts_rank_cd(tsv, query) desc, id limit $4`,
        [idx.id, ceiling, q.scrubbed[0], pool],
      );
      const score = new Map<string, number>();
      for (const list of [v.rows, l.rows])
        list.forEach((r, i) => score.set(r.id, (score.get(r.id) ?? 0) + 1 / (RRF_K + i + 1)));
      const top = [...score.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
      if (!top.length) return [];
      const rows = await tx.query<{
        id: string;
        resource_ref: string;
        entity_id: string | null;
        locator: string | null;
        data_class: DataClass;
        text_enc: Buffer;
        text_key_id: string;
      }>(
        `select id, resource_ref, entity_id, locator, data_class, text_enc, text_key_id
           from ai.chunk where id = any($1)`,
        [top.map((t) => t[0])],
      );
      const byId = new Map(rows.rows.map((r) => [r.id, r]));
      return top.map(([id, s]) => ({ row: byId.get(id)!, score: s })).filter((x) => x.row);
    });
    // The product's AUTHZ check on each resource (IPB-03-29): fail closed on anything not allowed.
    const allowed = ranked.length
      ? await this.o.authorize(ctx, [...new Set(ranked.map((r) => r.row.resource_ref))])
      : new Set<string>();
    const chunks: RetrievedChunk[] = [];
    for (const r of ranked) {
      if (chunks.length >= k) break;
      if (!allowed.has(r.row.resource_ref)) continue;
      const text = new TextDecoder().decode(
        await this.o.sealer.decryptField(
          ctx.tenantId,
          { enc: new Uint8Array(r.row.text_enc), keyId: r.row.text_key_id, alg: FIELD_ALG },
          at(r.row.id),
        ),
      );
      chunks.push({
        chunkId: r.row.id,
        resourceRef: r.row.resource_ref,
        entityId: r.row.entity_id,
        locator: r.row.locator,
        dataClass: r.row.data_class,
        text,
        score: Math.round(r.score * 1e6) / 1e6,
      });
    }
    return {
      chunks,
      blocks: chunks.map((c) => ({
        kind: "retrieved",
        sourceId: c.chunkId,
        resourceRef: c.resourceRef,
        ...(c.locator ? { locator: c.locator } : {}),
        dataClass: c.dataClass,
        text: c.text,
      })),
      dataClass: maxClass(...chunks.map((c) => c.dataClass)),
      queryRunId: q.runId,
    };
  }

  /**
   * The product deleted a resource: delete every chunk of it in every index version (OWNER-QUESTIONS
   * #34). One transaction records the erasure, deletes the chunks and ledgers it; a resource with no
   * chunks is still recorded, so a re-embedding batch in flight cannot copy it back. Agents may not
   * erase (`IPB-SEC-004`).
   */
  async deleteResource(
    ctx: KernelContext,
    resourceRef: string,
  ): Promise<{ chunks: number; indexIds: string[] }> {
    if (isAgent(ctx))
      throw new IpbError("IPB-SEC-004", { detail: "an agent cannot erase retrieval content" });
    if (!resourceRef || resourceRef.length > 300)
      throw new IpbError("IPB-AI-011", { detail: "a resource ref has 1 to 300 characters" });
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        await lockResources(tx, ctx.tenantId, [resourceRef]);
        const n = await tx.query<{ index_id: string; n: number }>(
          `select index_id, count(*)::int as n from ai.chunk where resource_ref = $1
            group by index_id order by index_id`,
          [resourceRef],
        );
        const chunks = n.rows.reduce((a, r) => a + r.n, 0);
        await tx.query(
          `insert into ai.resource_erasure (tenant_id, resource_ref, chunks, erased_by)
           values ($1, $2, $3, $4)`,
          [ctx.tenantId, resourceRef, chunks, ctx.principal.id],
        );
        const d = await tx.query("delete from ai.chunk where resource_ref = $1", [resourceRef]);
        if ((d.rowCount ?? 0) !== chunks)
          throw new Error(`erasure of ${resourceRef} deleted ${d.rowCount} of ${chunks} chunks`);
        const indexIds = n.rows.map((r) => r.index_id);
        await this.o.audit.record(tx, {
          action: "ai.retrieval.erase",
          resourceType: "retrieval_resource",
          resourceId: resourceRef,
          after: { chunks, index_ids: indexIds },
        });
        return { chunks, indexIds };
      },
      { action: "ai.retrieval.erase" },
    );
  }

  /**
   * Re-embed `name` with another model (IPB-03-32), one resumable batch per call: the first call
   * creates the `building` version; each call copies up to `batch` chunks of the active version
   * not yet copied (matched by resource, locator and content hash); searches keep reading the
   * active version meanwhile. When `remaining` is 0, `activate(newIndexId)` switches.
   */
  async reembedBatch(
    ctx: KernelContext,
    i: { name: string; embeddingModel: string; dims: number; chunker: string; batch?: number },
  ): Promise<{ indexId: string; copied: number; remaining: number }> {
    const active = await this.activeIndex(ctx, i.name);
    const building = await this.o.kernel.read(ctx, async (tx) => {
      const r = await tx.query<IndexRow>(
        `select * from ai.retrieval_index where name = $1 and state = 'building'
          order by version desc limit 1`,
        [i.name],
      );
      return r.rows[0] ? toIndex(r.rows[0]) : null;
    });
    const target = building ?? (await this.createIndex(ctx, i));
    if (target.embeddingModel !== i.embeddingModel || target.dims !== i.dims)
      throw new IpbError("IPB-AI-011", { detail: "a building version with another model exists" });
    const { todo, readAt } = await this.o.kernel.read(ctx, async (tx) => {
      const now = await tx.query<{ now: Date }>("select now() as now");
      const r = await tx.query<{
        id: string;
        resource_ref: string;
        entity_id: string | null;
        locator: string | null;
        data_class: Exclude<DataClass, "SECRET">;
        acl_hash: string;
        text_enc: Buffer;
        text_key_id: string;
        total: number;
      }>(
        `select a.id, a.resource_ref, a.entity_id, a.locator, a.data_class, a.acl_hash,
                a.text_enc, a.text_key_id, count(*) over ()::int as total
           from ai.chunk a
          where a.index_id = $1
            and not exists (select 1 from ai.chunk b where b.index_id = $2
                              and b.resource_ref = a.resource_ref
                              and b.locator is not distinct from a.locator
                              and b.content_sha256 = a.content_sha256)
          order by a.id limit $3`,
        [active.id, target.id, i.batch ?? 200],
      );
      return { todo: r.rows, readAt: now.rows[0]!.now };
    });
    if (!todo.length) return { indexId: target.id, copied: 0, remaining: 0 };
    const inputs = await Promise.all(
      todo.map(async (r) => ({
        resourceRef: r.resource_ref,
        ...(r.entity_id ? { entityId: r.entity_id } : {}),
        ...(r.locator ? { locator: r.locator } : {}),
        dataClass: r.data_class,
        text: new TextDecoder().decode(
          await this.o.sealer.decryptField(
            ctx.tenantId,
            { enc: new Uint8Array(r.text_enc), keyId: r.text_key_id, alg: FIELD_ALG },
            at(r.id),
          ),
        ),
        aclHash: r.acl_hash,
      })),
    );
    // The ACL hash is carried over as is: the descriptor itself was never stored.
    const copied = await this.ingest(ctx, target.id, inputs, "ai.retrieval.reembed", readAt);
    return {
      indexId: target.id,
      copied: copied.length,
      remaining: (todo[0]?.total ?? todo.length) - todo.length,
    };
  }
}
