// Retrieval on PostgreSQL with pgvector and every platform migration applied (PL4 plan §4.9,
// session 4). Embeddings come from FakeEmbedding (hashed bag of words): no provider is called (O-6).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localTenantKeyId } from "@infrabyx/crypto";
import type { KernelContext } from "@infrabyx/contracts/kernel";
import { platformSeedModule, runSeed } from "@infrabyx/seed";
import { ApprovalsEngine, FieldCrypto, PgOutbox } from "@infrabyx/tenancy";
import {
  agentContext,
  fakeKms,
  FakeEmbedding,
  platformContext,
  startPostgres,
  withTenant,
  type TestDatabase,
} from "@infrabyx/testing";
import { EmbeddingGateway } from "../embedding.js";
import { KillSwitches, type SettingsReader } from "../kill.js";
import { ModelRegistry } from "../registry.js";
import { RetrievalService, type ChunkInput } from "../retrieval.js";
import { indexSweepContext, RetrievalRetention } from "../retrieval-retention.js";

let db: TestDatabase;
let retrieval: RetrievalService;
let registry: ModelRegistry;
let approvals: ApprovalsEngine;
const settings: SettingsReader = {
  async get(_ctx, key) {
    if (key === "ai.enabled") return true;
    if (key === "ai.cost.tenant_daily_token_cap") return 50_000_000;
    if (key.startsWith("ai.kill.")) return false;
    return null;
  },
};
const staff = platformContext(["PLT_SUPER_ADMIN"], "tnt_platform", "usr_staff");
const officer = platformContext(["PLT_SECURITY_OFFICER"], "tnt_platform", "usr_officer");
const a = withTenant("tnt_rag_a", ["ORG_MEMBER"], { principal: { id: "usr_a" } });
const b = withTenant("tnt_rag_b", ["ORG_MEMBER"], { principal: { id: "usr_b" } });
const fake = new FakeEmbedding({
  adapterKey: "bedrock_claude_in",
  aiResidency: "IN",
  region: "ap-south-1",
});
/** Resources the product's AUTHZ check refuses. */
const denied = new Set(["doc:a:board-minutes"]);
const MODEL_V1 = "bedrock_claude_in/titan-embed-test";
const MODEL_V2 = "bedrock_claude_in/titan-embed-test-v2";

async function approveEmbed(model: string, dims: number, asDefault: boolean): Promise<string> {
  const m = await registry.addCandidate(staff, {
    adapterKey: "bedrock_claude_in",
    providerModelName: model.split("/")[1]!,
    capabilities: ["embed"],
    embeddingDims: dims,
    residency: "IN",
    retentionPolicy: "ZERO",
    notes: "[VERIFY] test fixture",
  });
  await registry.transition(staff, m.modelId, "EVALUATING", { reason: "eval" });
  await registry.recordEvidence(staff, m.modelId, {
    retentionEvidenceUrl: "https://example.org/retention",
    trainingOptOut: true,
    trainingEvidenceUrl: "https://example.org/training",
    evalScores: { recall: 1 },
  });
  const steps = [() => registry.requestPromotion(staff, m.modelId)];
  if (asDefault) steps.push(() => registry.requestDefault(staff, m.modelId, "embed", "in_zero"));
  for (const step of steps) {
    const { approvalId } = await step();
    await approvals.decide(officer, approvalId, "approve");
    await db.admin.query(
      "update tenancy.approval_request set delay_until = now() - interval '1 minute' where id = $1",
      [approvalId],
    );
    await approvals.execute(officer, approvalId);
  }
  return m.modelId;
}

const corpus = (tenant: "a" | "b"): ChunkInput[] =>
  Array.from({ length: 100 }, (_, i) => ({
    resourceRef: `doc:${tenant}:${i % 10}`,
    locator: `p.${i}`,
    dataClass: "CONFIDENTIAL" as const,
    acl: `matter:${tenant}`,
    text:
      tenant === "b"
        ? // Tenant B holds the best matches for the question tenant A will ask.
          `Lease termination notice period clause ${i}: either party may terminate the lease with three months notice period.`
        : i === 7
          ? "The lease may be ended by either party with a notice of three months."
          : `Schedule ${i} lists the maintenance charges and parking allotment for block ${i % 5}.`,
  }));

const idsOf = async (ctx: KernelContext) =>
  db.kernel.read(
    ctx,
    async (tx) =>
      new Set((await tx.query<{ id: string }>("select id from ai.chunk")).rows.map((r) => r.id)),
  );

beforeAll(async () => {
  db = await startPostgres();
  await runSeed({
    kernel: db.kernel,
    audit: db.audit,
    env: { APP_ENV: "test", SEED_ENABLED: true },
    product: "LD",
    profile: "demo",
    modules: [platformSeedModule],
    randomSeed: 20261027,
    runDate: new Date("2026-10-01T00:00:00Z"),
  } as never);
  approvals = new ApprovalsEngine({ kernel: db.kernel, audit: db.audit, product: "LD" });
  registry = new ModelRegistry({
    kernel: db.kernel,
    audit: db.audit,
    product: "LD",
    outbox: new PgOutbox(),
    approvals,
    cacheSeconds: 0,
  });
  await approveEmbed(MODEL_V1, 256, true);
  await approveEmbed(MODEL_V2, 384, false);
  const embeddings = new EmbeddingGateway({
    kernel: db.kernel,
    audit: db.audit,
    product: "LD",
    settings,
    registry,
    adapters: [fake],
    outbox: new PgOutbox(),
    kill: new KillSwitches(settings, { cacheSeconds: 0 }),
  });
  retrieval = new RetrievalService({
    kernel: db.kernel,
    audit: db.audit,
    embeddings,
    sealer: new FieldCrypto({ kms: fakeKms(), keyIdFor: localTenantKeyId }),
    authorize: async (_ctx, refs) => new Set(refs.filter((r) => !denied.has(r))),
  });
  for (const [ctx, t] of [
    [a, "a"],
    [b, "b"],
  ] as const) {
    const idx = await retrieval.createIndex(ctx, {
      name: "kb",
      embeddingModel: MODEL_V1,
      dims: 256,
      chunker: "paragraph/v1",
    });
    await retrieval.addChunks(ctx, idx.id, corpus(t));
    await retrieval.activate(ctx, idx.id);
  }
});
afterAll(async () => {
  await db?.end();
});

const ask = (ctx: KernelContext, query: string, over: Record<string, unknown> = {}) =>
  retrieval.search(ctx, {
    index: "kb",
    query,
    queryClass: "INTERNAL",
    maxDataClass: "CONFIDENTIAL",
    featureKey: "ld.grounded_answer",
    k: 8,
    ...over,
  });

describe("@IPB-03-AT-05 retrieval is tenant- and permission-scoped", () => {
  it("tenant A's question, whose best matches are in tenant B, returns zero chunks of tenant B", async () => {
    const mine = await idsOf(a);
    const theirs = await idsOf(b);
    expect(mine.size).toBe(100);
    expect(theirs.size).toBe(100);
    const r = await ask(a, "What is the lease termination notice period?");
    expect(r.chunks.length).toBeGreaterThan(0);
    expect(r.chunks.every((c) => mine.has(c.chunkId))).toBe(true);
    expect(r.chunks.some((c) => theirs.has(c.chunkId))).toBe(false);
    expect(r.chunks[0]!.text).toMatch(/notice of three months/);
    expect(r.blocks.every((x) => x.kind === "retrieved" && mine.has(x.sourceId))).toBe(true);
    // Tenant B sees its own and nothing of A.
    const rb = await ask(b, "maintenance charges and parking allotment");
    expect(rb.chunks.every((c) => theirs.has(c.chunkId))).toBe(true);
  });

  it("the product's AUTHZ check removes resources the caller may not read", async () => {
    const idx = await retrieval.activeIndex(a, "kb");
    await retrieval.addChunks(a, idx.id, [
      {
        resourceRef: "doc:a:board-minutes",
        dataClass: "CONFIDENTIAL",
        acl: "board",
        text: "Board minutes: the lease termination notice period was discussed.",
      },
    ]);
    const r = await ask(a, "board minutes lease termination notice period");
    expect(r.chunks.map((c) => c.resourceRef)).not.toContain("doc:a:board-minutes");
  });

  it("chunks above the feature's data-class ceiling are never returned", async () => {
    const idx = await retrieval.activeIndex(a, "kb");
    await retrieval.addChunks(a, idx.id, [
      {
        resourceRef: "doc:a:kyc",
        dataClass: "REGULATED",
        acl: "matter:a",
        text: "KYC note: borrower PAN ABCPE1234F verified for the lease guarantee.",
      },
    ]);
    const low = await ask(a, "KYC note borrower verified lease guarantee");
    expect(low.chunks.map((c) => c.resourceRef)).not.toContain("doc:a:kyc");
    const high = await ask(a, "KYC note borrower verified lease guarantee", {
      maxDataClass: "REGULATED",
    });
    const kyc = high.chunks.find((c) => c.resourceRef === "doc:a:kyc")!;
    expect(kyc.text).toContain("ABCPE1234F");
    expect(high.dataClass).toBe("REGULATED");
  });

  it("vectors and the lexical index are built from scrubbed text; the original is sealed", async () => {
    expect(JSON.stringify(fake.calls)).not.toContain("ABCPE1234F");
    const row = await db.admin.query<{ tsv: string; text_enc: Buffer }>(
      "select tsv::text as tsv, text_enc from ai.chunk where resource_ref = 'doc:a:kyc'",
    );
    expect(row.rows[0]!.tsv).not.toMatch(/abcpe1234f/i);
    expect(row.rows[0]!.text_enc.toString("latin1")).not.toContain("ABCPE1234F");
    const runs = await db.admin.query(
      "select 1 from ai.run where operation = 'embed' and outcome = 'ok' and tenant_id = 'tnt_rag_a'",
    );
    expect(runs.rowCount).toBeGreaterThan(0);
  });
});

describe("re-embedding (IPB-03-32)", () => {
  it("builds a new version in resumable batches while searches read the active one, then switches", async () => {
    const before = await retrieval.activeIndex(b, "kb");
    const step = () =>
      retrieval.reembedBatch(b, {
        name: "kb",
        embeddingModel: MODEL_V2,
        dims: 384,
        chunker: "paragraph/v1",
        batch: 60,
      });
    const first = await step();
    expect(first).toMatchObject({ copied: 60, remaining: 40 });
    expect((await retrieval.activeIndex(b, "kb")).id).toBe(before.id);
    expect((await ask(b, "lease termination notice period")).chunks.length).toBeGreaterThan(0);
    expect(await step()).toMatchObject({ copied: 40, remaining: 0 });
    expect(await step()).toMatchObject({ copied: 0, remaining: 0 });
    await retrieval.activate(b, first.indexId);
    const after = await retrieval.activeIndex(b, "kb");
    expect(after).toMatchObject({ id: first.indexId, version: 2, dims: 384 });
    const r = await ask(b, "lease termination notice period");
    const v2 = await db.kernel.read(b, async (tx) =>
      (
        await tx.query<{ id: string }>("select id from ai.chunk where index_id = $1", [after.id])
      ).rows.map((x) => x.id),
    );
    expect(r.chunks.every((c) => v2.includes(c.chunkId))).toBe(true);
  });
});

const chunkCount = async (tenant: string, ref: string) =>
  Number(
    (
      await db.admin.query<{ n: string }>(
        "select count(*) as n from ai.chunk where tenant_id = $1 and resource_ref = $2",
        [tenant, ref],
      )
    ).rows[0]!.n,
  );
const ledger = async (action: string, resourceId?: string) =>
  (
    await db.admin.query(
      "select 1 from audit.ledger where action = $1 and ($2::text is null or resource_id = $2)",
      [action, resourceId ?? null],
    )
  ).rowCount;

describe("erasure and retired versions (OWNER-QUESTIONS #34)", () => {
  it("deleting a resource deletes its chunks in every index version, ledgered", async () => {
    // After re-embedding, tenant B's kb has version 1 (retired) and version 2 (active).
    expect(await chunkCount("tnt_rag_b", "doc:b:3")).toBe(20);
    const r = await retrieval.deleteResource(b, "doc:b:3");
    expect(r.chunks).toBe(20);
    expect(r.indexIds).toHaveLength(2);
    expect(await chunkCount("tnt_rag_b", "doc:b:3")).toBe(0);
    expect(await chunkCount("tnt_rag_a", "doc:a:3")).toBe(10);
    expect(await ledger("ai.retrieval.erase", "doc:b:3")).toBe(1);
    const found = await ask(b, "lease termination notice period clause 3", { k: 50 });
    expect(found.chunks.some((c) => c.resourceRef === "doc:b:3")).toBe(false);
    // A resource with no chunks is still recorded, so nothing in flight can copy it back.
    expect(await retrieval.deleteResource(b, "doc:b:absent")).toEqual({ chunks: 0, indexIds: [] });
  });

  it("an agent may not erase; PostgreSQL refuses any other delete of chunks or versions", async () => {
    await expect(
      retrieval.deleteResource(agentContext("tnt_rag_b"), "doc:b:4"),
    ).rejects.toMatchObject({ code: "IPB-SEC-004" });
    const active = await retrieval.activeIndex(b, "kb");
    const n = await db.kernel.mutate(
      b,
      async (tx) => {
        const c = await tx.query("delete from ai.chunk where resource_ref = 'doc:b:4'");
        const i = await tx.query("delete from ai.retrieval_index where id = $1", [active.id]);
        await db.audit.record(tx, {
          action: "ai.index.purge",
          resourceType: "retrieval_index",
          resourceId: active.id,
          after: { attempted: true },
        });
        return (c.rowCount ?? 0) + (i.rowCount ?? 0);
      },
      { action: "ai.index.purge" },
    );
    expect(n).toBe(0);
    expect(await chunkCount("tnt_rag_b", "doc:b:4")).toBe(20);
  });

  it("a re-embedding copy read before an erasure is dropped, not stored", async () => {
    const idx = await retrieval.createIndex(a, {
      name: "kb_copy",
      embeddingModel: MODEL_V1,
      dims: 256,
      chunker: "paragraph/v1",
    });
    const readAt = new Date(Date.now() - 1000);
    await retrieval.deleteResource(a, "doc:a:9");
    const ingest = (
      retrieval as unknown as {
        ingest: (...x: unknown[]) => Promise<string[]>;
      }
    ).ingest.bind(retrieval);
    const copy = (ref: string) => ({
      resourceRef: ref,
      dataClass: "CONFIDENTIAL",
      text: `copied text of ${ref}`,
      aclHash: "0".repeat(64),
    });
    const stored = await ingest(
      a,
      idx.id,
      [copy("doc:a:9"), copy("doc:a:8")],
      "ai.retrieval.reembed",
      readAt,
    );
    expect(stored).toHaveLength(1);
    const kept = await db.admin.query<{ resource_ref: string }>(
      "select resource_ref from ai.chunk where index_id = $1",
      [idx.id],
    );
    expect(kept.rows.map((x) => x.resource_ref)).toEqual(["doc:a:8"]);
  });

  it("a retired version is deleted 30 days after retirement, chunks first, ledgered", async () => {
    const retention = new RetrievalRetention({ kernel: db.kernel, audit: db.audit });
    const retired = await db.admin.query<{ id: string; retired_at: Date | null }>(
      "select id, retired_at from ai.retrieval_index where tenant_id = 'tnt_rag_b' and name = 'kb' and state = 'retired'",
    );
    const old = retired.rows[0]!;
    expect(old.retired_at).toBeInstanceOf(Date);
    // Not yet due.
    expect(await retention.sweep()).toEqual({ versions: 0, chunks: 0 });
    // Nobody writes retired_at, not even through the sweep's context.
    await expect(
      db.kernel.mutate(
        indexSweepContext("tnt_rag_b"),
        async (tx) => {
          await db.audit.record(tx, {
            action: "ai.index.purge",
            resourceType: "retrieval_index",
            resourceId: old.id,
            after: { attempted: true },
          });
          await tx.query(
            "update ai.retrieval_index set retired_at = now() - interval '40 days' where id = $1",
            [old.id],
          );
        },
        { action: "ai.index.purge" },
      ),
    ).rejects.toThrow(/set by the database/);
    // Age it (fixtures bypass triggers), then sweep in small batches.
    await db.admin.query("begin");
    await db.admin.query("set local session_replication_role = replica");
    await db.admin.query(
      "update ai.retrieval_index set retired_at = now() - interval '31 days' where id = $1",
      [old.id],
    );
    await db.admin.query("commit");
    const before = Number(
      (
        await db.admin.query<{ n: string }>(
          "select count(*) as n from ai.chunk where index_id = $1",
          [old.id],
        )
      ).rows[0]!.n,
    );
    expect(before).toBe(90);
    expect(await retention.sweep({ batch: 30 })).toEqual({ versions: 1, chunks: 90 });
    expect(
      (await db.admin.query("select 1 from ai.retrieval_index where id = $1", [old.id])).rowCount,
    ).toBe(0);
    expect(await ledger("ai.index.purge_chunks", old.id)).toBe(3);
    expect(await ledger("ai.index.purge", old.id)).toBe(1);
    expect((await retrieval.activeIndex(b, "kb")).version).toBe(2);
    expect(await retention.sweep()).toEqual({ versions: 0, chunks: 0 });
  });

  it("a version brought back within the 30 days loses its retirement date", async () => {
    const v1 = await retrieval.activeIndex(a, "kb");
    const v2 = await retrieval.createIndex(a, {
      name: "kb",
      embeddingModel: MODEL_V1,
      dims: 256,
      chunker: "paragraph/v2",
    });
    await retrieval.activate(a, v2.id);
    await retrieval.activate(a, v1.id);
    const rows = await db.admin.query<{ id: string; state: string; retired_at: Date | null }>(
      "select id, state, retired_at from ai.retrieval_index where id = any($1)",
      [[v1.id, v2.id]],
    );
    const byId = new Map(rows.rows.map((r) => [r.id, r]));
    expect(byId.get(v1.id)).toMatchObject({ state: "active", retired_at: null });
    expect(byId.get(v2.id)!.state).toBe("retired");
    expect(byId.get(v2.id)!.retired_at).toBeInstanceOf(Date);
  });
});
