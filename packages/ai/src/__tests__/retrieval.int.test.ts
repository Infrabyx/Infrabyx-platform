// Retrieval on PostgreSQL with pgvector and every platform migration applied (PL4 plan §4.9,
// session 4). Embeddings come from FakeEmbedding (hashed bag of words): no provider is called (O-6).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localTenantKeyId } from "@infrabyx/crypto";
import type { KernelContext } from "@infrabyx/contracts/kernel";
import { platformSeedModule, runSeed } from "@infrabyx/seed";
import { ApprovalsEngine, FieldCrypto, PgOutbox } from "@infrabyx/tenancy";
import {
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
