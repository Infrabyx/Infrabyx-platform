// The API's environment (IPB-11 §11.4; PL6 plan §8.3). Read once through `@infrabyx/config/env`,
// which applies the production guards; no other file reads the process environment. Below staging
// the adapters' credentials are plain values of the local environment (`.env.local`, PL6-D-03); from
// staging up every `sens: S` variable must be a `secret://` reference, resolved through the SECRETS
// port (IPB-02-28).
import { z } from "zod";
import { AppEnv, ProductCode } from "@infrabyx/contracts/env";
import {
  envBool,
  envInt,
  envUrl,
  envVar,
  loadAndValidate,
  secretsResolver,
  validateEnv,
  type SecretResolver,
} from "@infrabyx/config/env";
import { VaultSecrets } from "@infrabyx/connectors/secrets";

/** Environments where fixture adapters may run (never demo, staging or above). */
export const FIXTURE_ENVS = ["local", "dev", "test", "preview"] as const;

const opt = (desc: string, example: string, port: string) =>
  envVar(z.string().min(1).optional(), { desc, example, required: "opt", sens: "C", port });

/** An optional secret (`sens: S`): a literal below staging, a `secret://` reference from staging up. */
const optionalSecret = (meta: { desc: string; example: string; required: "opt"; port: string }) =>
  envVar(z.string().min(1).optional(), { ...meta, sens: "S" });

export const apiEnvSchema = z.object({
  APP_ENV: envVar(AppEnv, {
    desc: "Deployment environment",
    example: "local",
    required: "all",
    sens: "C",
    port: "APP",
  }),
  APP_PRODUCT: envVar(ProductCode.default("LD"), {
    desc: "The product this instance of the template stands in for (events, seeds, personas)",
    example: "LD",
    required: "opt",
    sens: "C",
    port: "APP",
  }),
  APP_BASE_URL: envVar(envUrl(), {
    desc: "Canonical origin of the API (the OIDC redirect URI is <origin>/auth/callback)",
    example: "https://api.example.test",
    required: "all",
    sens: "C",
    port: "APP",
  }),
  APP_WEB_URL: envVar(envUrl().optional(), {
    desc: "Origin of the web app the browser returns to after sign-in; the API's own origin when unset",
    example: "https://app.example.test",
    required: "opt",
    sens: "C",
    port: "APP",
  }),
  APP_PORT: envVar(envInt({ min: 1024, max: 65535 }).default(3000), {
    desc: "Listening port (the image sets PORT for its HEALTHCHECK; both default to 3000)",
    example: "3000",
    required: "opt",
    sens: "C",
    port: "APP",
  }),
  DB_URL: envVar(envUrl(), {
    desc: "PostgreSQL URL of the platform database (read through the kernel as app_rw)",
    example: "postgres://app@localhost:5432/product",
    required: "all",
    sens: "C",
    port: "DB",
  }),
  APP_FIXTURE_ADAPTERS: envVar(envBool().default(false), {
    desc: "Fixture IDENTITY, AUTHZ, STORAGE and QUEUE adapters; refused from staging upwards",
    example: "true",
    required: "opt",
    sens: "C",
    port: "APP",
  }),
  AUTH_BASE_URL: envVar(envUrl().optional(), {
    desc: "Keycloak base URL (without /realms/<realm>)",
    example: "https://id.example.test",
    required: "opt",
    sens: "C",
    port: "IDENTITY",
  }),
  AUTH_REALM: opt("Keycloak realm", "infrabyx-local", "IDENTITY"),
  AUTH_CLIENT_ID: opt(
    "The API's OIDC client (authorisation code with PKCE)",
    "reference-api",
    "IDENTITY",
  ),
  AUTH_CLIENT_SECRET: optionalSecret({
    desc: "Secret of the API client",
    example: "secret://vault/identity/keycloak#client_secret",
    required: "opt",
    port: "IDENTITY",
  }),
  AUTH_ADMIN_CLIENT_ID: opt(
    "Service account the adapter uses for the Admin API",
    "reference-admin",
    "IDENTITY",
  ),
  AUTH_ADMIN_CLIENT_SECRET: optionalSecret({
    desc: "Secret of the admin service account",
    example: "secret://vault/identity/keycloak#admin_client_secret",
    required: "opt",
    port: "IDENTITY",
  }),
  AUTH_AUDIENCE: opt("Audience the API accepts (`aud`)", "reference-api", "IDENTITY"),
  AUTHZ_CERBOS_URL: envVar(envUrl().optional(), {
    desc: "Cerbos PDP address",
    example: "https://cerbos.internal:3592",
    required: "opt",
    sens: "C",
    port: "AUTHZ",
  }),
  STORAGE_ENDPOINT: envVar(envUrl().optional(), {
    desc: "S3 endpoint (MinIO locally); AWS S3 when unset",
    example: "https://minio.internal:9000",
    required: "opt",
    sens: "C",
    port: "STORAGE",
  }),
  STORAGE_REGION: envVar(z.string().min(1).default("ap-south-1"), {
    desc: "Bucket region (ap-south-1 or ap-south-2)",
    example: "ap-south-1",
    required: "opt",
    sens: "C",
    port: "STORAGE",
  }),
  STORAGE_BUCKET_PREFIX: opt(
    "Bucket name prefix: <prefix>-<class> per bucket class",
    "ipb-local",
    "STORAGE",
  ),
  STORAGE_ACCESS_KEY: opt("Access key id (MinIO)", "ipb-local", "STORAGE"),
  STORAGE_SECRET_KEY: optionalSecret({
    desc: "Secret access key (MinIO)",
    example: "secret://vault/storage/minio#secret_key",
    required: "opt",
    port: "STORAGE",
  }),
  QUEUE_REDIS_URL: optionalSecret({
    desc: "Redis URL of the BullMQ queues (carries the AUTH password)",
    example: "secret://vault/queue/redis#url",
    required: "opt",
    port: "QUEUE",
  }),
  SECRETS_VAULT_ADDR: envVar(envUrl().optional(), {
    desc: "Vault or OpenBao address the secret:// references resolve against (staging and above)",
    example: "https://vault.internal:8200",
    required: "opt",
    sens: "C",
    port: "SECRETS",
  }),
  SECRETS_VAULT_ROLE: opt("Kubernetes auth role of this workload", "reference-api", "SECRETS"),
  SECRETS_VAULT_MOUNT: opt("KV v2 mount (default secret)", "secret", "SECRETS"),
});
export type ApiEnv = z.output<typeof apiEnvSchema>;

/** The variables a real (non-fixture) adapter set needs. */
const REAL_ADAPTER_VARS = [
  "AUTH_BASE_URL",
  "AUTH_REALM",
  "AUTH_CLIENT_ID",
  "AUTH_CLIENT_SECRET",
  "AUTH_ADMIN_CLIENT_ID",
  "AUTH_ADMIN_CLIENT_SECRET",
  "AUTH_AUDIENCE",
  "AUTHZ_CERBOS_URL",
  "STORAGE_BUCKET_PREFIX",
  "QUEUE_REDIS_URL",
] as const;

/** Refusals after parsing: fixtures only where allowed, every real adapter configured otherwise. */
export function checkApiEnv(v: ApiEnv): ApiEnv {
  const fixtures = (FIXTURE_ENVS as readonly string[]).includes(v.APP_ENV);
  if (!fixtures && v.APP_FIXTURE_ADAPTERS)
    throw new Error(
      `APP_FIXTURE_ADAPTERS is refused in ${v.APP_ENV} (fixtures run in ${FIXTURE_ENVS.join(", ")} only)`,
    );
  if (!v.APP_FIXTURE_ADAPTERS) {
    const missing = REAL_ADAPTER_VARS.filter((k) => v[k] === undefined);
    if (missing.length)
      throw new Error(
        `without APP_FIXTURE_ADAPTERS the adapters need ${missing.join(", ")} (IPB-01 §01.4.5)`,
      );
  }
  return v;
}

const vaultSchema = z.object({
  SECRETS_VAULT_ADDR: apiEnvSchema.shape.SECRETS_VAULT_ADDR,
  SECRETS_VAULT_ROLE: apiEnvSchema.shape.SECRETS_VAULT_ROLE,
  SECRETS_VAULT_MOUNT: apiEnvSchema.shape.SECRETS_VAULT_MOUNT,
});

/** The `secret://vault/...` resolver, when a Vault address is configured (staging and above). */
async function vaultResolver(): Promise<SecretResolver | undefined> {
  const r = await validateEnv(vaultSchema, { guards: [] });
  if (!r.ok || !r.values.SECRETS_VAULT_ADDR) return undefined;
  return secretsResolver({
    vault: new VaultSecrets({
      address: r.values.SECRETS_VAULT_ADDR,
      auth: { kind: "kubernetes", role: r.values.SECRETS_VAULT_ROLE ?? "reference-api" },
      ...(r.values.SECRETS_VAULT_MOUNT ? { mount: r.values.SECRETS_VAULT_MOUNT } : {}),
    }),
  });
}

let cached: Promise<ApiEnv> | undefined;

/** The validated environment; exits with code 78 on a missing or refused value (IPB-11-08). */
export function apiEnv(): Promise<ApiEnv> {
  cached ??= (async () => {
    const secrets = await vaultResolver();
    return checkApiEnv(await loadAndValidate(apiEnvSchema, secrets ? { secrets } : {}));
  })();
  return cached;
}
