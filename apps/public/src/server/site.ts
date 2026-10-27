// The site's services, built once per process (PL5 plan §9.1). Content is read in-process through
// the public readers; nothing here writes except the consent, form and feedback endpoints, each
// through its package's service and the kernel. Fixture adapters (CRM, HR, the OH desk, the trust
// feed) run only where `siteEnv` allows them; elsewhere the ports are unconfigured and a form
// answers `IPB-PORT-001` until the real adapters are wired.
import pg from "pg";
import { PgAuditSink } from "@infrabyx/audit";
import { BrandStudio, type BrandProduct, type Revision } from "@infrabyx/brand";
import { FormService, PublicContent, PublicPolicies, type PublishedContent } from "@infrabyx/cms";
import { ConsentTexts, PgConsentLedger } from "@infrabyx/consent";
import { IpbError } from "@infrabyx/contracts/errors";
import { PLATFORM_TENANT_ID } from "@infrabyx/contracts/ids";
import type {
  BacklogPort,
  CrmPort,
  HrPort,
  StoragePort,
  SupportPort,
  TrustPort,
} from "@infrabyx/contracts/ports";
import { FeedbackService } from "@infrabyx/feedback";
import { HelpRegistry, loadRegistry, PLATFORM_REGISTRY_DIR } from "@infrabyx/hlp";
import { PgKernel, PgOutbox } from "@infrabyx/tenancy";
import { FakeCrm, FakeHr, FakeOhDesk, FakeTrustFeed, MemoryStorage } from "@infrabyx/testing";
import { TrustMirror } from "@infrabyx/trust";
import { DirStorage } from "./dir-storage.ts";
import { siteEnv, type SiteEnv } from "./env.ts";

const unconfigured = (port: string) => () => {
  throw new IpbError("IPB-PORT-001", { detail: `${port} is not configured for this site` });
};

/** A port whose every call answers IPB-PORT-001 (no adapter wired in this environment). */
function missingPort<T extends object>(port: string): T {
  return new Proxy({} as T, {
    get: (_t, prop) =>
      prop === "descriptor"
        ? { port, adapter: "unconfigured", residency: "IN", maxDataClass: "INTERNAL" }
        : unconfigured(port),
  });
}

export interface Site {
  env: SiteEnv;
  /** The product code events carry (OH hosts the group CMS, Ecosystem §6.35). */
  product: "OH";
  brandProduct: BrandProduct;
  kernel: PgKernel;
  content: PublicContent;
  policies: PublicPolicies;
  brand: BrandStudio;
  storage: StoragePort;
  texts: ConsentTexts;
  consent: PgConsentLedger;
  forms: FormService;
  feedback: FeedbackService;
  mirror: TrustMirror;
  help: HelpRegistry;
}

async function build(): Promise<Site> {
  const env = await siteEnv();
  const pool = new pg.Pool({ connectionString: env.DB_URL, max: 10 });
  const kernel = new PgKernel({ pool });
  const audit = new PgAuditSink();
  const outbox = new PgOutbox();
  const product = "OH" as const;
  const fixtures = env.APP_FIXTURE_ADAPTERS;
  const storage: StoragePort = env.STORAGE_DIR
    ? new DirStorage(env.STORAGE_DIR)
    : missingPort<StoragePort>("STORAGE");
  const desk = fixtures ? new FakeOhDesk() : null;
  const texts = new ConsentTexts({ kernel, audit });
  const consent = new PgConsentLedger({
    kernel,
    audit,
    texts,
    product,
    outbox,
    defaultTenantId: PLATFORM_TENANT_ID,
  });
  const registry = loadRegistry([PLATFORM_REGISTRY_DIR]);
  return {
    env,
    product,
    brandProduct: env.APP_BRAND_PRODUCT,
    kernel,
    content: new PublicContent({ kernel }),
    policies: new PublicPolicies({ kernel }),
    brand: new BrandStudio({
      kernel,
      audit,
      product,
      storage,
      // The site only reads packs; publishing happens in Studio.
      hooks: {
        emailIdentityVerified: async () => false,
        policySetPublished: async () => false,
      },
    }),
    storage,
    texts,
    consent,
    forms: new FormService({
      kernel,
      audit,
      product,
      outbox,
      consent,
      crm: fixtures ? new FakeCrm() : missingPort<CrmPort>("CRM"),
      hr: fixtures ? new FakeHr() : missingPort<HrPort>("HR"),
      textVersion: async (key) => (await texts.current(key))?.version ?? "1.0",
    }),
    feedback: new FeedbackService({
      kernel,
      audit,
      product,
      outbox,
      support: desk ?? missingPort<SupportPort>("SUPPORT"),
      backlog: desk ?? missingPort<BacklogPort>("BACKLOG"),
    }),
    mirror: new TrustMirror({
      kernel,
      audit,
      product,
      trust: fixtures ? new FakeTrustFeed() : missingPort<TrustPort>("TRUST"),
    }),
    help: new HelpRegistry(registry.entries),
  };
}

let site: Promise<Site> | undefined;
export const getSite = (): Promise<Site> => (site ??= build());

/** The brand pack for a request: published hosts, the product default otherwise (with noindex). */
export async function packFor(
  s: Site,
  host: string | null,
): Promise<{ packId: string; rev: Revision; noindex: boolean }> {
  const ctx = {
    tenantId: PLATFORM_TENANT_ID,
    principal: { id: "svc_site_public", type: "service" as const, roles: [] },
  };
  const res = await s.brand.resolve(ctx, s.brandProduct, { host });
  const rev = await s.brand.published(ctx, res.packId);
  if (!rev) throw new Error(`brand pack ${res.packId} has no published revision`);
  return { packId: res.packId, rev, noindex: res.noindex };
}

/** Published items of one type for a pack (menus, offices, the footer, companies). */
export const listed = (s: Site, packId: string, type: PublishedContent["type"]) =>
  s.content.list(packId, { type, locale: "en-IN" });

export { MemoryStorage };
