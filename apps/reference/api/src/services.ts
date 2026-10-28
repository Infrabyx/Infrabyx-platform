// The API's services, built once per process (PL6 plan §8.1, §8.3): the kernel, the ledger and
// the outbox from the platform packages; the IDENTITY, AUTHZ, STORAGE and QUEUE adapters from
// `@infrabyx/connectors`, or the fixtures where `apiEnv` allows them; the settings and approvals
// services; and the hello module. Every HTTP handler and every worker job reaches the database only
// through these.
import pg from "pg";
import { PgAuditSink } from "@infrabyx/audit";
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
  type QueuePort,
  type StoragePort,
} from "@infrabyx/contracts/ports";
import { HelpRegistry, loadRegistry, PLATFORM_REGISTRY_DIR } from "@infrabyx/hlp";
import { ApprovalsEngine, PgKernel, PgOutbox } from "@infrabyx/tenancy";
import { MemoryStorage } from "@infrabyx/testing";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { apiEnv, FIXTURE_ENVS, type ApiEnv } from "./env.js";
import { FixtureHelloAuthz, FixtureIdentity, MemoryQueue } from "./fixtures.js";
import { KeycloakFlow, type IdentityFlow } from "./identity.js";
import { HelloService } from "./modules/hello/index.js";

/** The help registry of this app, beside the platform one. */
export const APP_REGISTRY_DIR = join(fileURLToPath(new URL("..", import.meta.url)), "help");

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
  settings: SettingsService;
  approvals: ApprovalsEngine;
  hello: HelloService;
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
  return { identity, flow, authz, storage, queue };
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
  const fixtures = env.APP_FIXTURE_ADAPTERS;
  const fixtureIdentity = fixtures
    ? new FixtureIdentity({ callbackUrl: `${env.APP_BASE_URL}/auth/callback` })
    : null;
  const adapters = fixtureIdentity
    ? {
        identity: fixtureIdentity,
        flow: fixtureIdentity,
        authz: new FixtureHelloAuthz(),
        storage: new MemoryStorage(),
        queue: new MemoryQueue(),
      }
    : realAdapters(env, kernel, audit);
  const hello = new HelloService({ kernel, audit, outbox, settings, product, approvals });
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

let one: Promise<Services> | undefined;

/** The process's services (built on first use). */
export const getServices = (): Promise<Services> => (one ??= build({}));

/** Services for a given environment and pool (tests and the worker share the same wiring). */
export const buildServices = (o: BuildOptions): Promise<Services> => build(o);
