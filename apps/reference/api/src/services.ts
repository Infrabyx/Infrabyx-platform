// The API's services, built once per process (PL6 plan §8.1, §8.3): the kernel, the ledger and
// the outbox from the platform packages; the IDENTITY, AUTHZ, STORAGE and QUEUE adapters from
// `@infrabyx/connectors`, or the fixtures where `apiEnv` allows them; the settings and approvals
// services; the hello module and its Vidhi skill; and the gate services (CMS content, export,
// the trust mirror). Every HTTP handler and every worker job reaches the database only through
// these. The LLM, KMS and TRUST ports have fixtures below staging and no adapter above it until a
// product wires its own (PL6-D-09): their calls answer IPB-PORT-001 there.
import pg from "pg";
import { KillSwitches, type SettingsReader as AiSettingsReader } from "@infrabyx/ai";
import { PgAuditSink } from "@infrabyx/audit";
import { PublicContent } from "@infrabyx/cms";
import { PgSettingsStore, SettingsService } from "@infrabyx/config/settings";
import { CerbosAuthz } from "@infrabyx/connectors/authz";
import { KeycloakIdentity, PgRevocationStore } from "@infrabyx/connectors/identity";
import { BullmqQueue } from "@infrabyx/connectors/queue";
import { MinioStorage, S3Storage } from "@infrabyx/connectors/storage";
import type { KernelContext } from "@infrabyx/contracts/kernel";
import {
  BUCKET_CLASSES,
  type AuthzPort,
  type IdentityPort,
  type KmsPort,
  type LlmPort,
  type QueuePort,
  type StoragePort,
  type TrustPort,
} from "@infrabyx/contracts/ports";
import type { VidhiProduct } from "@infrabyx/contracts/vidhi";
import { randomBytes, SecretKey } from "@infrabyx/crypto";
import { ExportService, kmsArchiveSigner, REF_EXPORT_MAP } from "@infrabyx/export";
import { HelpRegistry, loadRegistry, PLATFORM_REGISTRY_DIR } from "@infrabyx/hlp";
import { ApprovalsEngine, PgKernel, PgOutbox } from "@infrabyx/tenancy";
import { FakeLlm, FakeTrustFeed, fakeKms, MemoryStorage } from "@infrabyx/testing";
import { TrustMirror } from "@infrabyx/trust";
import { Autonomy, SkillRegistry, TaskRuntime } from "@infrabyx/vidhi";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { apiEnv, FIXTURE_ENVS, type ApiEnv } from "./env.js";
import { FixtureHelloAuthz, FixtureIdentity, MemoryQueue, missingPort } from "./fixtures.js";
import { KeycloakFlow, type IdentityFlow } from "./identity.js";
import {
  deterministicSummary,
  HelloService,
  helloSkillTools,
  HelloSummarise,
  helloSummariseManifest,
  llmSummariser,
  summariseSkillKey,
} from "./modules/hello/index.js";

/** The help registry of this app, beside the platform one. */
export const APP_REGISTRY_DIR = join(fileURLToPath(new URL("..", import.meta.url)), "help");

/** The queue the worker runs export jobs from (`{ tenantId, jobId }`, ids only). */
export const EXPORT_QUEUE = "export";
/** What the export manifest records as the producing release. */
export const EXPORT_RELEASE = "reference-api/0.0.0";
/** The fixture LLM's model name (no registry row: the fixture is not a routed model). */
export const FIXTURE_MODEL = "fixture-deterministic";
/** The KMS key the fixture signs archives with (C-22). */
export const FIXTURE_EXPORT_KEY = "local:sign:export";

/** The service context the API's own background reads use for a tenant (no person). */
export const serviceContext = (tenantId: string): KernelContext => ({
  tenantId,
  principal: { id: "svc_reference_api", type: "service", roles: [] },
});

export interface Services {
  env: ApiEnv;
  product: ApiEnv["APP_PRODUCT"];
  kernel: PgKernel;
  audit: PgAuditSink;
  outbox: PgOutbox;
  identity: IdentityPort;
  flow: IdentityFlow;
  authz: AuthzPort;
  storage: StoragePort;
  queue: QueuePort;
  llm: LlmPort;
  kms: KmsPort;
  trust: TrustPort;
  settings: SettingsService;
  approvals: ApprovalsEngine;
  hello: HelloService;
  summarise: HelloSummarise;
  vidhi: TaskRuntime;
  content: PublicContent;
  exports: ExportService;
  mirror: TrustMirror;
  help: HelpRegistry;
  /** One round trip to the database, for `/health/ready` (IPB-01 §01.4.8.2). */
  ping: () => Promise<void>;
  close: () => Promise<void>;
}

export interface BuildOptions {
  env?: ApiEnv;
  /** A pool the caller owns (tests); the services then never end it. */
  pool?: pg.Pool;
}

function realAdapters(env: ApiEnv, kernel: PgKernel, audit: PgAuditSink) {
  // Plain HTTP to loopback is allowed only where fixtures are (the Compose stack).
  const loopback = (FIXTURE_ENVS as readonly string[]).includes(env.APP_ENV);
  const identity = new KeycloakIdentity({
    baseUrl: env.AUTH_BASE_URL!,
    realm: env.AUTH_REALM!,
    clientId: env.AUTH_CLIENT_ID!,
    clientSecret: env.AUTH_CLIENT_SECRET!,
    adminClientId: env.AUTH_ADMIN_CLIENT_ID!,
    adminClientSecret: env.AUTH_ADMIN_CLIENT_SECRET!,
    audience: env.AUTH_AUDIENCE!,
    revocations: new PgRevocationStore({ kernel, audit, context: serviceContext }),
    allowLoopbackHttp: loopback,
  });
  const flow = new KeycloakFlow({
    baseUrl: env.AUTH_BASE_URL!,
    realm: env.AUTH_REALM!,
    clientId: env.AUTH_CLIENT_ID!,
  });
  const authz = new CerbosAuthz({ url: env.AUTHZ_CERBOS_URL!, allowLoopbackHttp: loopback });
  const buckets = Object.fromEntries(
    BUCKET_CLASSES.map((c) => [
      c,
      `${env.STORAGE_BUCKET_PREFIX}-${c.toLowerCase().replace(/_/g, "-")}`,
    ]),
  );
  const credentials =
    env.STORAGE_ACCESS_KEY && env.STORAGE_SECRET_KEY
      ? { accessKeyId: env.STORAGE_ACCESS_KEY, secretAccessKey: env.STORAGE_SECRET_KEY }
      : undefined;
  const storage: StoragePort = env.STORAGE_ENDPOINT
    ? new MinioStorage({
        buckets,
        region: env.STORAGE_REGION,
        endpoint: env.STORAGE_ENDPOINT,
        ...(credentials ? { credentials } : {}),
        allowLoopbackHttp: loopback,
      })
    : new S3Storage({ buckets, region: env.STORAGE_REGION });
  const queue = new BullmqQueue({
    url: env.QUEUE_REDIS_URL!,
    prefix: `ibx-${env.APP_PRODUCT.toLowerCase()}`,
  });
  return {
    identity,
    flow,
    authz,
    storage,
    queue,
    // A product wires its LLM gateway, its KMS adapter and the OH trust feed here.
    llm: missingPort<LlmPort>("LLM"),
    kms: missingPort<KmsPort>("KMS"),
    trust: missingPort<TrustPort>("TRUST"),
  };
}

function fixtureAdapters(env: ApiEnv) {
  const identity = new FixtureIdentity({ callbackUrl: `${env.APP_BASE_URL}/auth/callback` });
  return {
    identity,
    flow: identity,
    authz: new FixtureHelloAuthz(),
    storage: new MemoryStorage(),
    queue: new MemoryQueue(),
    llm: new FakeLlm({
      adapterKey: "fixture_deterministic",
      aiResidency: "SELF",
      replies: [(req) => ({ text: deterministicSummary(req.messages[0]?.content ?? "") })],
    }),
    kms: fakeKms(),
    trust: new FakeTrustFeed(),
  };
}

async function build(o: BuildOptions): Promise<Services> {
  const env = o.env ?? (await apiEnv());
  const owned = !o.pool;
  const pool = o.pool ?? new pg.Pool({ connectionString: env.DB_URL, max: 10 });
  const kernel = new PgKernel({ pool });
  const audit = new PgAuditSink();
  const outbox = new PgOutbox();
  const product = env.APP_PRODUCT;
  const settings = new SettingsService({
    store: new PgSettingsStore(),
    kernel,
    audit,
    outbox,
    product,
  });
  const approvals = new ApprovalsEngine({ kernel, audit, product, outbox });
  // All fixtures, all real adapters, or real adapters with the named ports still on fixtures (the
  // Compose stack: Keycloak, Cerbos, MinIO and Redis are real; LLM, KMS and TRUST are not yet).
  const adapters = env.APP_FIXTURE_ADAPTERS
    ? fixtureAdapters(env)
    : (() => {
        const real = realAdapters(env, kernel, audit);
        const keep = new Set(env.APP_FIXTURE_PORTS ?? []);
        if (keep.size === 0) return real;
        const fx = fixtureAdapters(env);
        return {
          ...real,
          ...(keep.has("LLM") ? { llm: fx.llm } : {}),
          ...(keep.has("KMS") ? { kms: fx.kms } : {}),
          ...(keep.has("TRUST") ? { trust: fx.trust } : {}),
        };
      })();
  const fixtureKms = env.APP_FIXTURE_ADAPTERS || (env.APP_FIXTURE_PORTS ?? []).includes("KMS");
  const hello = new HelloService({ kernel, audit, outbox, settings, product, approvals });

  // The Vidhi kernel for the hello skill (IPB-03 §03.4.6, §03.4.7).
  const aiSettings: AiSettingsReader = {
    get: (ctx, key) => settings.get(ctx, key as never) as Promise<unknown>,
  };
  const vidhiProduct = product as VidhiProduct;
  const skills = new SkillRegistry().load([helloSummariseManifest(vidhiProduct)]);
  if (skills.issues.length)
    throw new Error(`hello skill manifest: ${skills.issues.map((i) => i.reason).join("; ")}`);
  const autonomy = new Autonomy({
    kernel,
    audit,
    product: vidhiProduct,
    skills,
    settings: aiSettings,
    approvals,
    outbox,
  });
  const vidhi = new TaskRuntime({
    kernel,
    audit,
    product: vidhiProduct,
    skills,
    autonomy,
    approvals,
    kill: new KillSwitches(aiSettings),
    outbox,
    tools: helloSkillTools({ hello, summariser: llmSummariser(adapters.llm, FIXTURE_MODEL) }),
  });
  const summarise = new HelloSummarise({
    kernel,
    runtime: vidhi,
    approvals,
    hello,
    skillKey: summariseSkillKey(vidhiProduct),
  });

  // The gate services: content, export and the trust mirror (PL6 plan §8.2).
  const content = new PublicContent({ kernel });
  const exports = new ExportService({
    kernel,
    audit,
    storage: adapters.storage,
    product,
    release: EXPORT_RELEASE,
    map: REF_EXPORT_MAP,
    signer: fixtureKms
      ? await kmsArchiveSigner(adapters.kms, FIXTURE_EXPORT_KEY)
      : lazySigner(adapters.kms),
    pseudonymKey: new SecretKey("export-pseudonym", "hmac-sha-256", randomBytes(32)),
    outbox,
    approvals,
    enqueue: async (tenantId, jobId) => {
      await adapters.queue.enqueue(
        EXPORT_QUEUE,
        { name: "run", data: { tenantId, jobId } },
        { idempotencyKey: `export:${jobId}` },
      );
    },
  });
  const mirror = new TrustMirror({ kernel, audit, product, trust: adapters.trust, outbox });
  const registry = loadRegistry([PLATFORM_REGISTRY_DIR, APP_REGISTRY_DIR]);
  return {
    env,
    product,
    kernel,
    audit,
    outbox,
    ...adapters,
    settings,
    approvals,
    hello,
    summarise,
    vidhi,
    content,
    exports,
    mirror,
    help: new HelpRegistry(registry.entries),
    ping: async () => {
      await pool.query("select 1");
    },
    close: async () => {
      if ("close" in adapters.queue && typeof adapters.queue.close === "function")
        await (adapters.queue as { close(): Promise<void> }).close();
      if (owned) await pool.end();
    },
  };
}

/** Without a KMS adapter the signer refuses at use, not at boot: the API still serves everything else. */
function lazySigner(
  kms: KmsPort,
): ReturnType<typeof kmsArchiveSigner> extends Promise<infer S> ? S : never {
  const refuse = (): never => {
    void kms;
    throw new Error("KMS is not configured: the export signer needs the platform signing key");
  };
  return {
    kid: "unconfigured",
    sign: () => Promise.reject(new Error("KMS is not configured")),
    get publicJwk() {
      return refuse();
    },
  };
}

let one: Promise<Services> | undefined;

/** The process's services (built on first use). */
export const getServices = (): Promise<Services> => (one ??= build({}));

/** Services for a given environment and pool (tests and the worker share the same wiring). */
export const buildServices = (o: BuildOptions): Promise<Services> => build(o);
