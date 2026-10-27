// IMAGE_GEN through the gateway on PostgreSQL (PL4 plan §6, session 5; OWN-10). Images come from
// FakeImageGen: no provider is called (O-6).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { platformSeedModule, runSeed } from "@infrabyx/seed";
import { ApprovalsEngine, PgOutbox } from "@infrabyx/tenancy";
import {
  agentContext,
  FakeImageGen,
  MemoryStorage,
  platformContext,
  startPostgres,
  withTenant,
  type TestDatabase,
} from "@infrabyx/testing";
import { readXmp } from "../image-label.js";
import { forbiddenImageSubject, ImageService } from "../image.js";
import { KillSwitches, type SettingsReader } from "../kill.js";
import { ModelRegistry } from "../registry.js";

let db: TestDatabase;
let approvals: ApprovalsEngine;
let images: ImageService;
const storage = new MemoryStorage();
const values = new Map<string, unknown>();
const settings: SettingsReader = {
  async get(_ctx, key) {
    if (values.has(key)) return values.get(key);
    if (key === "ai.enabled") return true;
    if (key === "ai.cost.tenant_daily_token_cap") return 5_000_000;
    if (key.startsWith("ai.kill.")) return false;
    return null;
  },
};
const staff = platformContext(["PLT_SUPER_ADMIN"], "tnt_platform", "usr_staff");
const officer = platformContext(["PLT_SECURITY_OFFICER"], "tnt_platform", "usr_officer");
const maker = withTenant("tnt_demo", ["ORG_MEMBER"], { principal: { id: "usr_marketing" } });
const editor = withTenant("tnt_demo", ["LD_CONTENT_EDITOR"], { principal: { id: "usr_editor" } });
const imagen = new FakeImageGen({
  adapterKey: "gemini_imagen",
  aiResidency: "IN",
  region: "asia-south1",
});
const code = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { code?: string }) => e.code ?? String(e),
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
  const registry = new ModelRegistry({
    kernel: db.kernel,
    audit: db.audit,
    product: "LD",
    outbox: new PgOutbox(),
    approvals,
    cacheSeconds: 0,
  });
  const m = await registry.addCandidate(staff, {
    adapterKey: "gemini_imagen",
    providerModelName: "imagen-test",
    capabilities: ["image"],
    residency: "IN",
    retentionPolicy: "ZERO",
    notes: "[VERIFY] test fixture",
  });
  await registry.transition(staff, m.modelId, "EVALUATING", { reason: "eval" });
  await registry.recordEvidence(staff, m.modelId, {
    retentionEvidenceUrl: "https://example.org/retention",
    trainingOptOut: true,
    trainingEvidenceUrl: "https://example.org/training",
    evalScores: { quality: 1 },
  });
  const { approvalId } = await registry.requestPromotion(staff, m.modelId);
  await approvals.decide(officer, approvalId, "approve");
  await db.admin.query(
    "update tenancy.approval_request set delay_until = now() - interval '1 minute' where id = $1",
    [approvalId],
  );
  await approvals.execute(officer, approvalId);
  images = new ImageService({
    kernel: db.kernel,
    audit: db.audit,
    product: "LD",
    settings,
    registry,
    adapters: [imagen],
    storage,
    approvals,
    contentRoles: ["LD_CONTENT_EDITOR"],
    outbox: new PgOutbox(),
    kill: new KillSwitches(settings, { cacheSeconds: 0 }),
  });
});
afterAll(async () => {
  await db?.end();
});
beforeEach(() => {
  values.clear();
  imagen.calls.length = 0;
});

const draw = (over: Record<string, unknown> = {}) =>
  images.generate(maker, {
    featureKey: "ld.blog_images",
    use: "blog_hero",
    prompt: "A flat illustration of scales of justice beside an open ledger, teal palette.",
    size: "1024x576",
    n: 1,
    ...over,
  });

describe("@IPB-03-AT-10 generated images are labelled and published only with a human approval", () => {
  it("the stored image carries the visible band and XMP; the record says sgi_label", async () => {
    const [img] = await draw();
    const stored = await storage.get(img!.storageKey);
    expect(stored.meta).toMatchObject({ bucketClass: "GENERAL", contentType: "image/png" });
    expect(readXmp(stored.body)).toContain('infrabyx:SGI="true"');
    expect(readXmp(stored.body)).toContain("Infrabyx-SGI: true; model=gemini_imagen/imagen-test");
    expect(img!.height).toBeGreaterThan(128); // the fake draws at most 128 px; the band adds rows
    const row = await db.admin.query(
      "select sgi_label, xmp, state, prompt_sha256 from ai.image where id = $1",
      [img!.imageId],
    );
    expect(row.rows[0]).toMatchObject({ sgi_label: true, xmp: true, state: "generated" });
    const run = await db.admin.query(
      "select operation, outcome from ai.run where tenant_id = 'tnt_demo' and operation = 'image'",
    );
    expect(run.rows).toContainEqual({ operation: "image", outcome: "ok" });
  });

  it("assertPublishable refuses an unapproved image (IPB-AI-032), then passes after a content editor approves", async () => {
    const [img] = await draw();
    expect(await code(images.assertPublishable(maker, img!.imageId))).toBe("IPB-AI-032");
    const { approvalId } = await images.requestPublish(maker, img!.imageId);
    // The requester cannot approve their own request, and an agent can never approve.
    expect(await code(approvals.decide(maker, approvalId, "approve"))).not.toBeNull();
    expect(
      await code(approvals.decide(agentContext("tnt_demo"), approvalId, "approve")),
    ).not.toBeNull();
    expect(await code(images.assertPublishable(maker, img!.imageId))).toBe("IPB-AI-032");
    await approvals.decide(editor, approvalId, "approve");
    const r = await approvals.get(editor, approvalId);
    if (r.state === "approved") {
      await db.admin.query(
        "update tenancy.approval_request set delay_until = now() - interval '1 minute' where id = $1",
        [approvalId],
      );
      await approvals.execute(editor, approvalId);
    }
    await expect(images.assertPublishable(maker, img!.imageId)).resolves.toBeUndefined();
    // Asking again returns the same request.
    expect((await images.requestPublish(maker, img!.imageId)).approvalId).toBe(approvalId);
  });

  it("assertPublishable refuses an unlabelled image or one whose stored object changed (IPB-AI-031)", async () => {
    const [img] = await draw();
    await db.admin.query("update ai.image set sgi_label = false where id = $1", [img!.imageId]);
    expect(await code(images.assertPublishable(maker, img!.imageId))).toBe("IPB-AI-031");
    expect(await code(images.requestPublish(maker, img!.imageId))).toBe("IPB-AI-031");
    const [other] = await draw();
    await storage.put(other!.storageKey, new Uint8Array([1, 2, 3]), { bucketClass: "GENERAL" });
    expect(await code(images.assertPublishable(maker, other!.imageId))).toBe("IPB-AI-031");
  });

  it("an image that cannot be labelled is refused and nothing is stored", async () => {
    const before = (await db.admin.query("select count(*)::int as n from ai.image")).rows[0].n;
    imagen.script([{ bytes: new Uint8Array([255, 216, 255]), mimeType: "image/jpeg" }]);
    expect(await code(draw())).toBe("IPB-AI-031");
    expect((await db.admin.query("select count(*)::int as n from ai.image")).rows[0].n).toBe(
      before,
    );
  });
});

describe("permitted uses and forbidden subjects (IPB-03-05)", () => {
  it("refuses a use outside the enum, forbidden subjects and personal data with IPB-AI-030", async () => {
    expect(await code(draw({ use: "avatar" }))).toBe("IPB-AI-030");
    for (const prompt of [
      "A portrait of Mr. Sharma, our branch manager, smiling.",
      "A famous cricketer holding our product.",
      "Our customer's family at their new home.",
      "The RBI governor announcing a rate cut.",
      "A Supreme Court bench delivering a judgment.",
      "A realistic scan of a salary slip for March.",
      "An Aadhaar card with a sample name.",
      "A poster with the contact number 9876543210.",
    ])
      expect(await code(draw({ prompt }))).toBe("IPB-AI-030");
    expect(imagen.calls).toHaveLength(0);
  });

  it("lets ordinary marketing and diagram prompts through", () => {
    for (const p of [
      "A diagram of the invoice approval workflow with three boxes.",
      "A minimal hero image of a city skyline at dawn.",
      "An abstract illustration of a secure vault, blue and white.",
      "A placeholder pattern of soft geometric shapes.",
    ])
      expect(forbiddenImageSubject(p)).toBeNull();
  });

  it("ai.image.enabled off blocks generation (IPB-AI-001)", async () => {
    values.set("ai.image.enabled", false);
    expect(await code(draw())).toBe("IPB-AI-001");
  });
});
