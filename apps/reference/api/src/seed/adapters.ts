// The adapters `infrabyx-seed credentials --adapters <this file>` uses to provision the seed
// personas into the real IDENTITY (Keycloak) of a local stack (`pnpm dev:up`; PL6 session 4c).
// The seed vault is the in-memory SECRETS fake here: the generated passwords go to the credentials
// file (`SEED_CREDENTIALS.md`, never committed) and into Keycloak; a product points this at its
// own SECRETS adapter so the vault keeps them and the password hash list persists (PL6-D-10).
import { validateEnv } from "@infrabyx/config/env";
import { KeycloakIdentity, MemoryRevocationStore } from "@infrabyx/connectors/identity";
import { MemorySecrets } from "@infrabyx/testing";
import { apiEnvSchema, checkApiEnv, FIXTURE_ENVS } from "../env.js";

const r = await validateEnv(apiEnvSchema, { guards: [] });
if (!r.ok)
  throw new Error(`seed adapters: ${r.failures.map((f) => `${f.name}: ${f.reason}`).join("; ")}`);
const env = checkApiEnv(r.values);
if (env.APP_FIXTURE_ADAPTERS || !env.AUTH_BASE_URL)
  throw new Error(
    "seed credentials need the real IDENTITY adapter (AUTH_* set, APP_FIXTURE_ADAPTERS=false)",
  );

export const seedAdapters = {
  secrets: new MemorySecrets(),
  identity: new KeycloakIdentity({
    baseUrl: env.AUTH_BASE_URL,
    realm: env.AUTH_REALM!,
    clientId: env.AUTH_CLIENT_ID!,
    clientSecret: env.AUTH_CLIENT_SECRET!,
    adminClientId: env.AUTH_ADMIN_CLIENT_ID!,
    adminClientSecret: env.AUTH_ADMIN_CLIENT_SECRET!,
    audience: env.AUTH_AUDIENCE!,
    revocations: new MemoryRevocationStore(),
    allowLoopbackHttp: (FIXTURE_ENVS as readonly string[]).includes(env.APP_ENV),
  }),
};
