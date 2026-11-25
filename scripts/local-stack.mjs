// The local stack's layout from one product setting (DEV-LOCAL-01, R1-D-290): the Compose project
// name, the host ports, the apps the `apps` profile builds and runs, and the realm's redirect URIs.
// Read by scripts/dev-up.mjs; the scaffold copies this file into each product unchanged. No
// dependency, so a product runs it before its install has the platform packages built.
//
// The setting lives in the repository's root package.json (the stable names products align with):
//   "infrabyx": {
//     "product": "UDF",                         // the product code: project name and port block
//     "local": {
//       "project": "infrabyx-platform",         // optional: overrides `infrabyx-<code>`
//       "portOffset": 0,                        // optional: overrides the product's block
//       "apps": [{ "name": "web", "dir": "apps/web", "kind": "web", "slot": 7, "api": "api" }]
//     }
//   }
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The product codes a local stack may carry (IPB-14 §14.2's six products). */
export const LOCAL_PRODUCTS = ["LD", "LDC", "EQ", "FBX", "UDF", "OH"];

/**
 * Each product's port block: every host port is its default plus the offset. Finbyx keeps today's
 * ports and Udofin the block it already uses (+100); the others are chosen so that no two blocks
 * share a port (`portBlocksOverlap` is empty, a test holds it).
 */
export const PRODUCT_PORT_OFFSETS = Object.freeze({
  FBX: 0,
  UDF: 100,
  LDC: 500,
  EQ: 600,
  LD: 1200,
  OH: 1300,
});

/** The services' host ports at offset 0, by the variable that moves each one in .env.local. */
export const PORT_DEFAULTS = Object.freeze({
  PG_PORT: 55432,
  REDIS_PORT: 56379,
  MINIO_PORT: 59000,
  MAILPIT_SMTP_PORT: 51025,
  MAILPIT_UI_PORT: 58025,
  KEYCLOAK_PORT: 58080,
  TEMPORAL_PORT: 57233,
  TEMPORAL_UI_PORT: 58233,
  GOTENBERG_PORT: 53000,
  UNLEASH_PORT: 54242,
  CERBOS_PORT: 53592,
  LIVEKIT_PORT: 57880,
  LIVEKIT_RTC_TCP_PORT: 57881,
  OPENSEARCH_PORT: 59200,
  OLLAMA_PORT: 51434,
  GRAFANA_PORT: 53300,
  OTLP_GRPC_PORT: 54317,
  OTLP_HTTP_PORT: 54318,
});

/** The apps' host ports at offset 0: 53120 + slot, slots 0 to 19. */
export const APP_PORT_BASE = 53120;
export const APP_SLOTS = 20;

export const APP_KINDS = ["api", "worker", "web", "public", "console"];

/** The secrets dev:up generates into infra/compose/.env.local on first run. */
export const GENERATED_SECRETS = [
  "POSTGRES_PASSWORD",
  "KEYCLOAK_DB_PASSWORD",
  "KEYCLOAK_ADMIN_PASSWORD",
  "UNLEASH_DB_PASSWORD",
  "UNLEASH_ADMIN_TOKEN",
  "UNLEASH_CLIENT_TOKEN",
  "REDIS_PASSWORD",
  "MINIO_ROOT_USER",
  "MINIO_ROOT_PASSWORD",
  "MINIO_KMS_SECRET_KEY",
  "OPENSEARCH_ADMIN_PASSWORD",
  "LIVEKIT_API_SECRET",
];

/** Written to .env.local once the realm is applied. */
export const REALM_SECRETS = ["AUTH_CLIENT_SECRET", "AUTH_ADMIN_CLIENT_SECRET"];

/**
 * Every variable dev:up, the migrations and the seeds read or pass, for infra/compose/.env.example
 * (no values there: dev:up generates the secrets and computes the rest).
 */
export const LOCAL_ENV_KEYS = [
  ...GENERATED_SECRETS,
  ...REALM_SECRETS,
  ...Object.keys(PORT_DEFAULTS),
  "APP_ENV",
  "APP_PRODUCT",
  "APP_BASE_URL",
  "APP_FIXTURE_ADAPTERS",
  "DB_URL",
  "DB_PASSWORD",
  "STORAGE_DIR",
  "SEED_ENABLED",
  "SEED_RANDOM_SEED",
  "SEED_VAULT_PREFIX",
  "SEED_CREDENTIALS_PATH",
  "AUTH_BASE_URL",
  "AUTH_REALM",
  "AUTH_CLIENT_ID",
  "AUTH_ADMIN_CLIENT_ID",
  "AUTH_AUDIENCE",
  "AUTHZ_CERBOS_URL",
  "STORAGE_ENDPOINT",
  "STORAGE_BUCKET_PREFIX",
  "STORAGE_ACCESS_KEY",
  "STORAGE_SECRET_KEY",
  "QUEUE_REDIS_URL",
  "WORKFLOW_TEMPORAL_ADDRESS",
];

/** Seeds never run here (PL1-D-06; `SEED_REFUSED_ENVS` of `@infrabyx/contracts/env`, a test holds them equal). */
export const SEED_REFUSED_ENVS = ["prod", "dr", "pre-prod"];

/** The local realm and its clients (one Keycloak per project, so the names need not differ). */
export const LOCAL_REALM = {
  realm: "infrabyx-local",
  apiClientId: "reference-api",
  adminClientId: "reference-admin",
};

const NAME = /^[a-z][a-z0-9-]{0,31}$/;
const PROJECT = /^[a-z][a-z0-9_-]{0,62}$/;
const PATH = /^\/[A-Za-z0-9._~\-/]*$/;
const DIR = /^apps\/[A-Za-z0-9._\-/]+$/;

/** The root package.json's `infrabyx` block. */
export function readLocalSetting(root) {
  const pj = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  if (!pj.infrabyx || typeof pj.infrabyx !== "object")
    throw new Error("local stack: package.json has no `infrabyx` block (infrabyx.product)");
  return pj.infrabyx;
}

/** Every port two blocks share, as `A/B:port` (empty when the blocks are apart). */
export function portBlocksOverlap(offsets = PRODUCT_PORT_OFFSETS) {
  const base = [
    ...Object.values(PORT_DEFAULTS),
    ...Array.from({ length: APP_SLOTS }, (_, i) => APP_PORT_BASE + i),
  ];
  const seen = new Map();
  const out = [];
  for (const [code, off] of Object.entries(offsets))
    for (const p of base) {
      const port = p + off;
      const other = seen.get(port);
      if (other && other !== code) out.push(`${other}/${code}:${port}`);
      else seen.set(port, code);
    }
  return out;
}

/**
 * The stack from the setting: validated, with every port computed. `overrides` holds the port
 * variables a developer set in .env.local (they win over the block).
 */
export function localStack(setting, overrides = {}) {
  const product = setting?.product;
  if (!LOCAL_PRODUCTS.includes(product))
    throw new Error(`local stack: infrabyx.product must be one of ${LOCAL_PRODUCTS.join(", ")}`);
  const local = setting.local ?? {};
  const project = local.project ?? `infrabyx-${product.toLowerCase()}`;
  if (!PROJECT.test(project))
    throw new Error(
      "local stack: infrabyx.local.project must be lower case letters, digits, - or _",
    );
  const offset = local.portOffset ?? PRODUCT_PORT_OFFSETS[product];
  if (!Number.isInteger(offset) || offset < 0 || offset > 5000)
    throw new Error("local stack: infrabyx.local.portOffset must be an integer from 0 to 5000");
  const port = (key, def) => {
    const v = overrides[key];
    if (v === undefined || v === "") return def + offset;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1024 || n > 65535)
      throw new Error(`local stack: ${key} must be a port from 1024 to 65535`);
    return n;
  };
  const ports = Object.fromEntries(Object.entries(PORT_DEFAULTS).map(([k, d]) => [k, port(k, d)]));

  const declared = local.apps ?? [];
  if (!Array.isArray(declared)) throw new Error("local stack: infrabyx.local.apps must be a list");
  const names = new Set();
  const slots = new Set();
  const apps = declared.map((a, i) => {
    const where = `infrabyx.local.apps[${i}]`;
    if (!a || typeof a !== "object") throw new Error(`local stack: ${where} must be an object`);
    if (!NAME.test(a.name ?? "")) throw new Error(`local stack: ${where}.name is invalid`);
    if (names.has(a.name)) throw new Error(`local stack: app ${a.name} is declared twice`);
    names.add(a.name);
    if (!APP_KINDS.includes(a.kind))
      throw new Error(`local stack: ${where}.kind must be one of ${APP_KINDS.join(", ")}`);
    if (!DIR.test(a.dir ?? "") || a.dir.split("/").includes(".."))
      throw new Error(`local stack: ${where}.dir must be a folder under apps/`);
    if (!Number.isInteger(a.slot) || a.slot < 0 || a.slot >= APP_SLOTS)
      throw new Error(`local stack: ${where}.slot must be an integer from 0 to ${APP_SLOTS - 1}`);
    if (slots.has(a.slot)) throw new Error(`local stack: slot ${a.slot} is declared twice`);
    slots.add(a.slot);
    if (a.product !== undefined && !LOCAL_PRODUCTS.includes(a.product))
      throw new Error(`local stack: ${where}.product must be one of ${LOCAL_PRODUCTS.join(", ")}`);
    if (a.migrationName !== undefined && !NAME.test(a.migrationName))
      throw new Error(`local stack: ${where}.migrationName is invalid`);
    for (const f of ["callbackPath", "postLogoutPath"])
      if (a[f] !== undefined && (typeof a[f] !== "string" || !PATH.test(a[f])))
        throw new Error(`local stack: ${where}.${f} must be a path starting with /`);
    const key = `${a.name.toUpperCase().replace(/-/g, "_")}_PORT`;
    // An app named like a service (`redis`, `keycloak`) would take that service's port variable.
    if (key in PORT_DEFAULTS)
      throw new Error(`local stack: app name ${a.name} is a service's name; choose another`);
    const appPort = port(key, APP_PORT_BASE + a.slot);
    const callbackPath =
      a.callbackPath ?? (a.kind === "web" || a.kind === "api" ? "/auth/callback" : undefined);
    const postLogoutPath = a.postLogoutPath ?? (a.kind === "web" ? "/" : undefined);
    return {
      name: a.name,
      dir: a.dir,
      kind: a.kind,
      slot: a.slot,
      portKey: key,
      port: appPort,
      url: `http://localhost:${appPort}`,
      product: a.product ?? product,
      api: a.api,
      site: a.site,
      callbackPath,
      postLogoutPath,
      migrationName: a.migrationName,
    };
  });
  // The name an api's own migrations are recorded under: `reference` for a single api, as every
  // copy of dev-up recorded them so far (renaming would re-run them), else the app's name.
  const apis = apps.filter((a) => a.kind === "api");
  for (const a of apis) a.migrationName ??= apis.length === 1 ? "reference" : a.name;
  for (const a of apps) {
    for (const [field, kind] of [
      ["api", "api"],
      ["site", "public"],
    ])
      if (a[field] !== undefined && !apps.some((b) => b.name === a[field] && b.kind === kind))
        throw new Error(`local stack: app ${a.name}'s ${field} is not a declared ${kind} app`);
    if ((a.kind === "web" || a.kind === "worker") && a.api === undefined) {
      const only = apps.filter((b) => b.kind === "api");
      if (only.length !== 1)
        throw new Error(`local stack: app ${a.name} must name its api (\`api\`)`);
      a.api = only[0].name;
    }
  }
  return { product, project, offset, ports, apps };
}

/** The realm's lists for the declared apps: every web (and api) callback and post-logout URI. */
export function realmRedirects(stack) {
  const redirectUris = [];
  const postLogoutRedirectUris = [];
  for (const a of stack.apps) {
    if ((a.kind === "web" || a.kind === "api") && a.callbackPath)
      redirectUris.push(`${a.url}${a.callbackPath}`);
    if (a.kind === "web" && a.postLogoutPath)
      postLogoutRedirectUris.push(`${a.url}${a.postLogoutPath}`);
  }
  return { redirectUris, postLogoutRedirectUris };
}

/** The Dockerfile build argument: the app's folder under apps/. */
const appArg = (dir) => dir.replace(/^apps\//, "");

const HARDENED = { cap_drop: ["ALL"], security_opt: ["no-new-privileges:true"] };

/**
 * The `apps` profile's services for the declared apps (infra/compose/.apps.local, JSON, which
 * Compose reads as YAML). Paths are relative to infra/compose, as in docker-compose.yml.
 * `existing(dir)` says whether an app's folder exists; an app whose folder is missing is left out.
 */
export function composeApps(stack, existing = () => true) {
  const p = stack.ports;
  const byName = new Map(stack.apps.map((a) => [a.name, a]));
  const services = {};
  const apiEnv = (a) => {
    const web = stack.apps.find((w) => w.kind === "web" && w.api === a.name);
    return {
      APP_ENV: "local",
      APP_PRODUCT: a.product,
      APP_BASE_URL: a.url,
      ...(web ? { APP_WEB_URL: web.url } : {}),
      APP_PORT: String(a.port),
      PORT: String(a.port),
      DB_URL: `postgres://postgres:\${POSTGRES_PASSWORD}@127.0.0.1:${p.PG_PORT}/infrabyx`,
      APP_FIXTURE_ADAPTERS: "false",
      APP_FIXTURE_PORTS: "LLM,KMS,TRUST",
      AUTH_BASE_URL: `http://127.0.0.1:${p.KEYCLOAK_PORT}`,
      AUTH_REALM: LOCAL_REALM.realm,
      AUTH_CLIENT_ID: LOCAL_REALM.apiClientId,
      AUTH_CLIENT_SECRET: "${AUTH_CLIENT_SECRET}",
      AUTH_ADMIN_CLIENT_ID: LOCAL_REALM.adminClientId,
      AUTH_ADMIN_CLIENT_SECRET: "${AUTH_ADMIN_CLIENT_SECRET}",
      AUTH_AUDIENCE: LOCAL_REALM.apiClientId,
      AUTHZ_CERBOS_URL: `http://127.0.0.1:${p.CERBOS_PORT}`,
      STORAGE_ENDPOINT: `http://127.0.0.1:${p.MINIO_PORT}`,
      STORAGE_REGION: "ap-south-1",
      STORAGE_BUCKET_PREFIX: "ipb-local",
      STORAGE_ACCESS_KEY: "${MINIO_ROOT_USER}",
      STORAGE_SECRET_KEY: "${MINIO_ROOT_PASSWORD}",
      QUEUE_REDIS_URL: `redis://:\${REDIS_PASSWORD}@127.0.0.1:${p.REDIS_PORT}`,
      WORKFLOW_TEMPORAL_ADDRESS: `127.0.0.1:${p.TEMPORAL_PORT}`,
      WORKFLOW_TEMPORAL_NAMESPACE: "default",
      WORKFLOW_TASK_QUEUE_PREFIX: "ipb-",
      WORKFLOW_CODEC_KEY_ID: "local:workflow",
    };
  };
  const onStack = {
    postgres: { condition: "service_healthy" },
    keycloak: { condition: "service_healthy" },
    cerbos: { condition: "service_healthy" },
    minio: { condition: "service_healthy" },
    redis: { condition: "service_healthy" },
    temporal: { condition: "service_healthy" },
  };
  for (const a of stack.apps) {
    if (!existing(a.dir)) continue;
    const node = {
      context: "../..",
      dockerfile: "infra/docker/node/Dockerfile",
      args: { APP: appArg(a.dir) },
    };
    const next = {
      context: "../..",
      dockerfile: "infra/docker/next/Dockerfile",
      args: { APP: appArg(a.dir) },
    };
    const image = `${stack.project}/${a.name}:local`;
    const nextTmp = ["/tmp", "/app/.next/cache:uid=10001"];
    if (a.kind === "api" || a.kind === "worker") {
      const api = a.kind === "worker" ? byName.get(a.api) : a;
      // The api and worker join the host network and reach the services at their loopback ports:
      // the adapters allow plain HTTP to loopback only (IPB-SEC-018), never to a service name.
      services[a.name] = {
        profiles: ["apps"],
        ...HARDENED,
        build: node,
        image,
        read_only: true,
        tmpfs: ["/tmp"],
        network_mode: "host",
        depends_on: onStack,
        environment: {
          ...apiEnv(api),
          APP_PRODUCT: a.product,
          APP_PORT: String(a.port),
          PORT: String(a.port),
        },
      };
    } else if (a.kind === "web") {
      const api = byName.get(a.api);
      services[a.name] = {
        profiles: ["apps"],
        ...HARDENED,
        build: next,
        image,
        read_only: true,
        tmpfs: nextTmp,
        network_mode: "host",
        ...(existing(api.dir)
          ? { depends_on: { [api.name]: { condition: "service_healthy" } } }
          : {}),
        environment: {
          APP_ENV: "local",
          APP_PRODUCT: a.product,
          APP_BASE_URL: a.url,
          APP_API_URL: `http://127.0.0.1:${api.port}`,
          PORT: String(a.port),
        },
      };
    } else {
      const site =
        a.kind === "console"
          ? a.site
            ? byName.get(a.site)
            : stack.apps.find((s) => s.kind === "public")
          : undefined;
      services[a.name] = {
        profiles: ["apps"],
        ...HARDENED,
        build: next,
        image,
        read_only: true,
        tmpfs: nextTmp,
        // The files the dev seed wrote; the site only reads them, the console uploads (UID 10001).
        volumes: [a.kind === "public" ? "../../.storage:/storage:ro" : "../../.storage:/storage"],
        depends_on: { postgres: { condition: "service_healthy" } },
        environment: {
          APP_ENV: "local",
          APP_PRODUCT: a.product,
          APP_BASE_URL: a.url,
          ...(site ? { APP_SITE_URL: site.url } : {}),
          DB_URL: "postgres://postgres:${POSTGRES_PASSWORD}@postgres:5432/infrabyx",
          STORAGE_DIR: "/storage",
          APP_FIXTURE_ADAPTERS: "true",
        },
        ports: [`127.0.0.1:${a.port}:3000`],
      };
    }
  }
  return { services };
}

/** The declared app of a kind whose folder exists (`existsSync` under the repository root). */
export const appExists = (root) => (dir) => existsSync(join(root, dir, "package.json"));
