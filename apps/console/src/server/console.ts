// The console's services, built once per process (PL5 plan §9.6). Every Studio screen reads and
// writes through these package services and the kernel; the console adds no table access of its
// own. Fixture adapters (AUTHZ, CRM, billing, OH desk, trust feed, directory storage) run only
// where `consoleEnv` allows them; elsewhere the ports are unconfigured and answer IPB-PORT-001.
import pg from "pg";
import { PgAuditSink } from "@infrabyx/audit";
import { BrandStudio } from "@infrabyx/brand";
import {
  CmsStudio,
  MediaLibrary,
  PolicyStudio,
  PricingService,
  ResourceService,
  TRANSITIONS,
} from "@infrabyx/cms";
import { ConsentTexts, PgConsentLedger } from "@infrabyx/consent";
import { IpbError } from "@infrabyx/contracts/errors";
import { PLATFORM_TENANT_ID } from "@infrabyx/contracts/ids";
import type {
  AuthzPort,
  BacklogPort,
  BillingCataloguePort,
  CrmPort,
  StoragePort,
  SupportPort,
  TrustPort,
} from "@infrabyx/contracts/ports";
import { FeedbackService } from "@infrabyx/feedback";
import { PgKernel, PgOutbox } from "@infrabyx/tenancy";
import { FakeCatalogue, FakeCrm, FakeOhDesk, FakeTrustFeed } from "@infrabyx/testing";
import { TrustMirror } from "@infrabyx/trust";
import { FixtureStudioAuthz } from "./authz.ts";
import { DirStorage } from "./dir-storage.ts";
import { consoleEnv, type ConsoleEnv } from "./env.ts";

/** A port whose every call answers IPB-PORT-001 (no adapter wired in this environment). */
function missingPort<T extends object>(port: string): T {
  return new Proxy({} as T, {
    get: (_t, prop) =>
      prop === "descriptor"
        ? { port, adapter: "unconfigured", residency: "IN", maxDataClass: "INTERNAL" }
        : () => {
            throw new IpbError("IPB-PORT-001", { detail: `${port} is not configured` });
          },
  });
}

async function build() {
  const env: ConsoleEnv = await consoleEnv();
  const fixtures = env.APP_FIXTURE_ADAPTERS;
  const pool = new pg.Pool({ connectionString: env.DB_URL, max: 10 });
  const kernel = new PgKernel({ pool });
  const audit = new PgAuditSink();
  const outbox = new PgOutbox();
  const product = "OH";
  const base = { kernel, audit, product, outbox };
  const storage: StoragePort = env.STORAGE_DIR
    ? new DirStorage(env.STORAGE_DIR)
    : missingPort<StoragePort>("STORAGE");
  const desk = fixtures ? new FakeOhDesk() : null;
  const texts = new ConsentTexts({ kernel, audit });
  const policies = new PolicyStudio(base);
  const brand = new BrandStudio({
    ...base,
    storage,
    hooks: {
      // NOTIFY's sender verification is not wired in the reference console.
      emailIdentityVerified: async () => false,
      policySetPublished: policies.policySetHook(),
    },
  });
  const billing: BillingCataloguePort = fixtures
    ? new FakeCatalogue()
    : missingPort<BillingCataloguePort>("BILLING");
  const pricing = new PricingService({ billing, product });
  return {
    env,
    authz: fixtures ? new FixtureStudioAuthz() : missingPort<AuthzPort>("AUTHZ"),
    brand,
    cms: new CmsStudio({
      ...base,
      extraLint: async (item, body) =>
        item.type === "pricing_copy" ? pricing.lintCopy(item.packId, body) : [],
    }),
    media: new MediaLibrary({ kernel, audit, storage }),
    policies,
    texts,
    pricing,
    resources: new ResourceService({
      ...base,
      storage,
      crm: fixtures ? new FakeCrm() : missingPort<CrmPort>("CRM"),
      consent: new PgConsentLedger({
        kernel,
        audit,
        texts,
        product,
        outbox,
        defaultTenantId: PLATFORM_TENANT_ID,
      }),
      author: async (packId) =>
        (await brand.published(PLATFORM_CONTEXT, packId))?.body.legal_entity.name ?? "Infrabyx",
      base: async () => env.APP_SITE_URL,
    }),
    feedback: new FeedbackService({
      ...base,
      support: desk ?? missingPort<SupportPort>("SUPPORT"),
      backlog: desk ?? missingPort<BacklogPort>("BACKLOG"),
    }),
    mirror: new TrustMirror({
      ...base,
      trust: fixtures ? new FakeTrustFeed() : missingPort<TrustPort>("TRUST"),
    }),
    transitions: TRANSITIONS,
    /** One round trip to the database, for `/health/ready` (IPB-01 §01.4.8.2). */
    ping: async () => {
      await pool.query("select 1");
    },
  };
}

/** The platform context of the console's own reads (no person). */
const PLATFORM_CONTEXT = {
  tenantId: PLATFORM_TENANT_ID,
  scope: "platform" as const,
  principal: { id: "svc_console", type: "service" as const, roles: [] },
};

export type Console = Awaited<ReturnType<typeof build>>;
let one: Promise<Console> | undefined;
export const getConsole = (): Promise<Console> => (one ??= build());
