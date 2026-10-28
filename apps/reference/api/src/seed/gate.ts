// The reference app's gate seed (PL6 plan §8.2; PL6-D-12). Run with the hello seed through
//   infrabyx-seed --profile dev --modules apps/reference/api/dist/seed/index.js
// It seeds what the gate journey reads, through the packages' own services as `apps/public` does:
// the product's default brand pack with one published page (`welcome`; an editor makes, a checker
// approves and publishes), and the trust mirror filled from the fixture feed (a public sub-processor
// list and accessibility statement, and a gated report the Trust Centre only counts). The seed never
// runs in prod, dr or pre-prod (`assertSeedAllowed`, PL1-D-06). A second run changes nothing.
import { BrandStudio, type BrandProduct } from "@infrabyx/brand";
import { CmsStudio } from "@infrabyx/cms";
import { PLATFORM_TENANT_ID } from "@infrabyx/contracts/ids";
import type { KernelContext } from "@infrabyx/contracts/kernel";
import type { VadDocument } from "@infrabyx/contracts/ports";
import { defineSeedModule, type SeedModule, type SeedModuleContext } from "@infrabyx/seed";
import { FakeTrustFeed, MemoryStorage } from "@infrabyx/testing";
import { TrustMirror } from "@infrabyx/trust";
import { fixtureTrustDocumentsFor } from "../services.js";

const staff = (id: string, roles: string[]): KernelContext => ({
  tenantId: PLATFORM_TENANT_ID,
  scope: "platform",
  principal: { id, type: "service", roles },
});
const SEED_EDITOR = staff("svc_seed_editor", ["PLT_CONTENT_EDITOR"]);
const SEED_CHECKER = staff("svc_seed_checker", ["PLT_SUPER_ADMIN"]);

/** The page the journey opens at `/pages/welcome`. */
export const WELCOME_PAGE = {
  title: "Welcome",
  slug: "welcome",
  text: "The reference application shows how a product uses the platform packages: sign-in, content, the assistant, the tenant export and the Trust Centre.",
} as const;

const para = (text: string) => ({
  _type: "block",
  style: "normal",
  children: [{ _type: "span", text }],
  markDefs: [],
});

/** The `VendorAssuranceDocumentPublished` payload of a fixture document. */
const announced = (d: VadDocument) =>
  Object.fromEntries(
    Object.entries(d).filter(([k]) => !["type_key", "state", "issuer_name"].includes(k)),
  );

/** Seed the gate's content and trust mirror. Exported for the app's own tests. */
export async function seedGate(
  ctx: Pick<SeedModuleContext, "product" | "services">,
): Promise<{ packId: string; skipped: boolean }> {
  const { kernel, audit, outbox } = ctx.services;
  const product = ctx.product as BrandProduct;
  const base = { kernel, audit, product, ...(outbox ? { outbox } : {}) };
  const existing = await kernel.read(SEED_CHECKER, async (tx) => {
    const r = await tx.query<{ id: string }>(
      "select id from brand.pack where product = $1 and is_default",
      [product],
    );
    return r.rows[0]?.id;
  });
  if (existing) return { packId: existing, skipped: true };

  const brand = new BrandStudio({
    ...base,
    storage: new MemoryStorage(),
    hooks: {
      emailIdentityVerified: async () => false,
      policySetPublished: async () => false,
    },
  });
  const { id: packId } = await brand.createPack(SEED_CHECKER, {
    product,
    label: "Reference application",
    isDefault: true,
  });
  const cms = new CmsStudio(base);
  const { item } = await cms.createItem(SEED_EDITOR, {
    type: "page",
    packId,
    source: "seed",
    title: WELCOME_PAGE.title,
    slug: WELCOME_PAGE.slug,
    body: {
      template: "article",
      blocks: [{ type: "rich_text", slot: "body", content: [para(WELCOME_PAGE.text)] }],
    },
  });
  await cms.submit(SEED_EDITOR, item.id);
  await cms.approve(SEED_CHECKER, item.id);
  await cms.publishNow(SEED_CHECKER, item.id);

  const docs = fixtureTrustDocumentsFor(product);
  const mirror = new TrustMirror({ ...base, trust: new FakeTrustFeed(docs) });
  for (const d of docs)
    await mirror.onPublished({ eventId: `evt_seed_${d.vad_id}_${d.version}`, data: announced(d) });
  return { packId, skipped: false };
}

export const referenceGateSeedModule: SeedModule = defineSeedModule({
  module: "reference_gate",
  profiles: ["dev", "demo", "test"],
  dependsOn: ["platform"],
  async run(ctx) {
    await seedGate(ctx);
  },
});
