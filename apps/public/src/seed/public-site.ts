// The public-site seed module (PL5 plan §9.5; PL5-D-13). Run with
//   infrabyx-seed --profile test --modules apps/public/src/seed/public-site.ts
// It seeds through the packages' own services, not table rows, so every publish passes the same
// maker-checker, legal review and claims lint as Studio: a seed editor makes, a seed checker
// approves, a seed legal reviewer signs off legal-class items, and a seed DPO drafts the consent
// texts. The seed never runs in prod, dr or pre-prod (`assertSeedAllowed`, PL1-D-06), so the
// placeholder policies it creates can never exist there. Running it twice changes nothing.
import { BrandStudio } from "@infrabyx/brand";
import { CmsStudio, MANDATORY_POLICY_KEYS, PolicyStudio, type ContentType } from "@infrabyx/cms";
import { validateEnv } from "@infrabyx/config/env";
import { ConsentTexts } from "@infrabyx/consent";
import { PLATFORM_TENANT_ID } from "@infrabyx/contracts/ids";
import type { KernelContext } from "@infrabyx/contracts/kernel";
import type { StoragePort, VadDocument } from "@infrabyx/contracts/ports";
import { defineSeedModule, type SeedModuleContext } from "@infrabyx/seed";
import { FakeTrustFeed, MemoryStorage, fixtureTrustDocuments } from "@infrabyx/testing";
import { TrustMirror } from "@infrabyx/trust";
import { z } from "zod";
import { DirStorage } from "../server/dir-storage.ts";
import { siteEnvSchema } from "../server/env.ts";
import {
  aboutPage,
  blogPost,
  brandBody,
  careersForm,
  careersPage,
  contactForm,
  contactPage,
  footer,
  GROUP_COMPANIES,
  groupCompaniesPage,
  homePage,
  investorsPage,
  LOGO_SVG,
  menus,
  offices,
  para,
  PLACEHOLDER_DESCRIPTION,
  trustPage,
} from "./content.ts";
import { groupSeedEnvSchema, type GroupSeedEnv } from "./env.ts";

const staff = (id: string, roles: string[]): KernelContext => ({
  tenantId: PLATFORM_TENANT_ID,
  scope: "platform",
  principal: { id, type: "service", roles },
});
export const SEED_EDITOR = staff("svc_seed_editor", ["PLT_CONTENT_EDITOR"]);
export const SEED_CHECKER = staff("svc_seed_checker", ["PLT_SUPER_ADMIN"]);
export const SEED_LEGAL = staff("svc_seed_legal", ["PLT_LEGAL_REVIEWER"]);
export const SEED_DPO = staff("svc_seed_dpo", ["PLT_DPO"]);

/** Only the reserved example domain counts as a verified sending identity in a seeded site. */
const RESERVED_EMAIL_DOMAINS = new Set(["example.org"]);

export interface PublicSiteSeedResult {
  packId: string | null;
  skipped: boolean;
  published: Partial<Record<ContentType, number>>;
}

async function readEnv(): Promise<{ group: GroupSeedEnv; storageDir?: string }> {
  const g = await validateEnv(groupSeedEnvSchema, { guards: [] });
  if (!g.ok) throw new Error(`SEED_GROUP_* refused: ${g.failures.map((f) => f.name).join(", ")}`);
  const s = await validateEnv(z.object({ STORAGE_DIR: siteEnvSchema.shape.STORAGE_DIR }), {
    guards: [],
  });
  return {
    group: g.values,
    ...(s.ok && s.values.STORAGE_DIR ? { storageDir: s.values.STORAGE_DIR } : {}),
  };
}

/** Seed the group site through the services. Exported for the site's own tests. */
export async function seedPublicSite(
  ctx: Pick<SeedModuleContext, "product" | "services">,
  o: { group: GroupSeedEnv; storage: StoragePort },
): Promise<PublicSiteSeedResult> {
  const { kernel, audit, outbox } = ctx.services;
  const base = { kernel, audit, product: ctx.product, ...(outbox ? { outbox } : {}) };
  const existing = await kernel.read(
    SEED_CHECKER,
    async (tx) =>
      (
        await tx.query<{ id: string; status: string }>(
          "select id, status from brand.pack where product = 'GRP' and is_default",
        )
      ).rows[0],
  );
  if (existing?.status === "published")
    return { packId: existing.id, skipped: true, published: {} };
  if (existing)
    throw new Error(
      `the group pack ${existing.id} exists but is not published: an earlier seed run stopped part-way; seed a fresh database`,
    );

  const policies = new PolicyStudio(base);
  const brand = new BrandStudio({
    ...base,
    storage: o.storage,
    hooks: {
      emailIdentityVerified: async (_c, domain) => RESERVED_EMAIL_DOMAINS.has(domain),
      policySetPublished: policies.policySetHook(),
    },
  });
  const cms = new CmsStudio(base);
  const published: Partial<Record<ContentType, number>> = {};

  // Brand pack and its policy set: placeholders only, never real legal text (PL5 plan §9.5).
  const { id: packId } = await brand.createPack(SEED_CHECKER, {
    product: "GRP",
    label: "Infrabyx Group",
    isDefault: true,
  });
  const { id: setId } = await policies.createSet(SEED_LEGAL, packId);
  const domain = o.group.SEED_GROUP_HOSTS.split(",")[0]!;
  await policies.proposeParams(SEED_LEGAL, setId, {
    entity_name: o.group.SEED_GROUP_ENTITY_NAME,
    product_name: "Infrabyx Group",
    cin: o.group.SEED_GROUP_CIN,
    registered_office: o.group.SEED_GROUP_REGISTERED_OFFICE,
    domain,
    grievance_officer: o.group.SEED_GROUP_GRIEVANCE_NAME,
    grievance_email: o.group.SEED_GROUP_GRIEVANCE_EMAIL,
    grievance_address: o.group.SEED_GROUP_REGISTERED_OFFICE,
    dpo_name: o.group.SEED_GROUP_DPO_NAME,
    dpo_email: o.group.SEED_GROUP_DPO_EMAIL,
    support_email: o.group.SEED_GROUP_EMAIL,
    security_email: o.group.SEED_GROUP_EMAIL,
    status_page_url: o.group.SEED_GROUP_STATUS_URL,
  });
  await policies.approveParams(SEED_CHECKER, setId);
  for (const key of MANDATORY_POLICY_KEYS)
    await policies.seedPlaceholder(SEED_LEGAL, {
      setId,
      key,
      seedAllowed: ctx.services.seedAllowed,
    });
  const logo = await brand.uploadLogo(SEED_EDITOR, packId, LOGO_SVG);
  const hosts = o.group.SEED_GROUP_HOSTS.split(",").map((host, i) => ({
    host,
    role: "PUBLIC",
    verified: i === 0,
  }));
  const rev = await brand.saveDraft(SEED_EDITOR, packId, {
    body: brandBody(o.group, { svg: logo.ref, png: logo.png }, setId),
    hosts,
  });
  await brand.submit(SEED_EDITOR, rev.id);
  await brand.legalReview(SEED_LEGAL, rev.id);
  await brand.approve(SEED_CHECKER, rev.id);

  /** Create, submit, sign off (legal-class types) and publish one item, as Studio does. */
  const publish = async (
    type: ContentType,
    input: { title: string; slug?: string; body: unknown; parentId?: string },
  ): Promise<string> => {
    const { item } = await cms.createItem(SEED_EDITOR, {
      type,
      packId,
      source: "seed",
      ...input,
    });
    const sub = await cms.submit(SEED_EDITOR, item.id);
    if (sub.status === "legal_review" || sub.needsLegal)
      await cms.legalApprove(SEED_LEGAL, item.id);
    await cms.approve(SEED_CHECKER, item.id);
    await cms.publishNow(SEED_CHECKER, item.id);
    published[type] = (published[type] ?? 0) + 1;
    return item.id;
  };

  const contactFormId = await publish("form", { title: "Contact", body: contactForm });
  const careersFormId = await publish("form", { title: "Careers application", body: careersForm });
  for (const office of offices(o.group))
    await publish("office", { title: office.label, body: office });
  await publish("footer", { title: "Group footer", body: footer(o.group) });
  for (const m of menus) await publish("nav_menu", { title: m.title, body: m.body });
  for (const c of GROUP_COMPANIES)
    await publish("group_company", {
      title: c.name,
      slug: c.slug,
      body: {
        name: c.name,
        description: [para(PLACEHOLDER_DESCRIPTION)],
        legal_entity_name: o.group.SEED_GROUP_ENTITY_NAME,
      },
    });
  await publish("page", { title: "Infrabyx Group", slug: "home", body: homePage });
  await publish("page", { title: "About the group", slug: "about", body: aboutPage });
  await publish("page", {
    title: "Group companies",
    slug: "group-companies",
    body: groupCompaniesPage,
  });
  await publish("page", { title: "Careers", slug: "careers", body: careersPage(careersFormId) });
  await publish("page", { title: "Trust Centre", slug: "trust", body: trustPage });
  await publish("page", { title: "Contact us", slug: "contact", body: contactPage(contactFormId) });

  // Blog and Investors are off for the group site (O-1): drafts only, so their routes are 404.
  await cms.createItem(SEED_EDITOR, {
    type: "page",
    packId,
    title: "Investors",
    slug: "investors",
    body: investorsPage,
    source: "seed",
  });
  await cms.createItem(SEED_EDITOR, {
    type: "blog_post",
    packId,
    title: "Placeholder post",
    slug: "placeholder-post",
    body: blogPost,
    source: "seed",
  });

  // Consent texts: the template 18 defaults, drafted by the DPO and approved by the legal reviewer.
  const texts = new ConsentTexts({ kernel, audit });
  await texts.seedDefaults(SEED_DPO);
  for (const t of await texts.drafts(SEED_LEGAL)) await texts.approve(SEED_LEGAL, t.id);

  // The trust mirror from the fixture feed: a sub-processor list and an accessibility statement
  // (public), and a gated report that the public Trust Centre never shows.
  const feed = new FakeTrustFeed();
  const mirror = new TrustMirror({ ...base, trust: feed });
  for (const d of fixtureTrustDocuments())
    await mirror.onPublished({ eventId: `evt_seed_${d.vad_id}_${d.version}`, data: announced(d) });

  return { packId, skipped: false, published };
}

/** The `VendorAssuranceDocumentPublished` payload of a fixture document. */
const announced = (d: VadDocument) =>
  Object.fromEntries(
    Object.entries(d).filter(([k]) => !["type_key", "state", "issuer_name"].includes(k)),
  );

export const publicSiteSeedModule = defineSeedModule({
  module: "public_site",
  profiles: ["dev", "demo", "test"],
  dependsOn: ["platform"],
  async run(ctx) {
    const env = await readEnv();
    const storage = env.storageDir ? new DirStorage(env.storageDir) : new MemoryStorage();
    await seedPublicSite(ctx, { group: env.group, storage });
  },
});

/** `infrabyx-seed --modules` loads this export. */
export const seedModules = [publicSiteSeedModule];
