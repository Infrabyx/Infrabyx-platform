#!/usr/bin/env node
// infrabyx-seed --profile <dev|demo|test|load> [--modules <module>]
// infrabyx-seed purge --profile <profile> [--db <owner url>]
// infrabyx-seed credentials --adapters <module> [--rotate] [--no-file]
// Refusal comes first: in prod/dr/pre-prod, or without SEED_ENABLED=true, the CLI exits 1 with
// IPB-SEED-001 and emits SeedRefused before any other configuration is read (@IPB-11-AT-02).
import { dirname, join, resolve } from "node:path";
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import pg from "pg";
import { z } from "zod";
import { ProductCode } from "@infrabyx/contracts/env";
import { isIpbError } from "@infrabyx/contracts/errors";
import type { IdentityProvisioning, SecretsPort } from "@infrabyx/contracts/ports";
import {
  envBool,
  envInt,
  envUrl,
  envVar,
  loadAndValidate,
  secretRef,
  validateEnv,
  type SecretResolver,
} from "@infrabyx/config/env";
import { internalEvent } from "@infrabyx/config/events";
import { PgAuditSink } from "@infrabyx/audit";
import { newId } from "@infrabyx/crypto";
import { PgKernel, PgOutbox } from "@infrabyx/tenancy";
import { generateCredentials } from "./credentials.js";
import { SEED_PRINCIPAL, SEED_TENANT_IDS, runSeed, type SeedModule } from "./framework.js";
import { SEED_PROFILES, assertSeedAllowed, type SeedProfile } from "./guard.js";
import { platformSeedModule } from "./platform.js";
import { purgeSeed } from "./purge.js";

const APP_ENV = envVar(
  z.enum(["local", "dev", "test", "preview", "staging", "pre-prod", "demo", "prod", "dr"]),
  { desc: "Deployment environment", example: "local", required: "all", sens: "C", port: "APP" },
);
const gateSchema = z.object({
  APP_ENV,
  SEED_ENABLED: envVar(envBool(), {
    desc: "Must be false/unset in prod/dr/pre-prod",
    example: "true",
    required: "opt",
    sens: "C",
    port: "SEED",
  }),
  SEED_LOAD_CONFIRM: envVar(z.string(), {
    desc: "Set to yes for the load profile",
    example: "",
    required: "opt",
    sens: "C",
    port: "SEED",
  }),
  APP_PRODUCT: envVar(ProductCode, {
    desc: "Product code",
    example: "LDC",
    required: "opt",
    sens: "C",
    port: "APP",
  }),
});

export const seedEnvSchema = gateSchema.extend({
  APP_PRODUCT: envVar(ProductCode, {
    desc: "Product code LD|LDC|EQ|FBX|UDF|OH",
    example: "LDC",
    required: "all",
    sens: "C",
    port: "APP",
  }),
  DB_URL: envVar(envUrl(), {
    desc: "PostgreSQL URL without password",
    example: "postgres://app@localhost:5432/ldc",
    required: "all",
    sens: "C",
    port: "DB",
  }),
  DB_PASSWORD: secretRef({
    desc: "PostgreSQL password",
    example: "app",
    required: "all",
    port: "DB",
  }),
  SEED_RANDOM_SEED: envVar(envInt({ min: 0 }), {
    desc: "Deterministic faker seed",
    example: "20261025",
    required: "nonprod",
    sens: "C",
    port: "SEED",
  }),
  SEED_CREDENTIALS_PATH: envVar(z.string().min(1), {
    desc: "Output path (gitignored)",
    example: "./SEED_CREDENTIALS.md",
    required: "nonprod",
    sens: "C",
    port: "SEED",
  }),
  AUTH_SUPER_ADMIN_EMAIL: envVar(z.email(), {
    desc: "Super-admin address (IPB-11-32); set in the product repository's local environment only",
    example: "super.admin@example.test",
    required: "opt",
    sens: "C",
    port: "AUTH",
  }),
  SEED_VAULT_PREFIX: envVar(z.string().min(1), {
    desc: "Seed vault path",
    example: "secret://env/infrabyx/ldc/local/seed",
    required: "nonprod",
    sens: "C",
    port: "SEED",
  }),
});

/**
 * The product a scaffolded repository records in its root `package.json`
 * (`"infrabyx": { "product": "<code>" }`), from the nearest one up from `from` that has it.
 */
export function scaffoldedProduct(from: string = process.cwd()): string | undefined {
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    try {
      const v = (
        JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
          infrabyx?: { product?: unknown };
        }
      ).infrabyx?.product;
      if (v !== undefined) return ProductCode.safeParse(v).success ? String(v) : undefined;
    } catch {
      // no package.json here, or not JSON
    }
    if (dirname(dir) === dir) return undefined;
  }
}

/**
 * The pg connection for `DB_URL` and `DB_PASSWORD`. pg lets a URL's empty password override a
 * separate `password` option, so the password goes into the URL, percent-encoded (PR-FBX-07).
 */
export function connectionConfig(url: string, password?: string): { connectionString: string } {
  if (!password) return { connectionString: url };
  const u = new URL(url);
  u.password = encodeURIComponent(password);
  return { connectionString: u.toString() };
}

async function importNamed<T>(path: string, name: string): Promise<T> {
  const mod = (await import(pathToFileURL(resolve(path)).href)) as Record<string, unknown>;
  if (!(name in mod)) throw new Error(`${path} does not export ${name}`);
  return mod[name] as T;
}

/** `source` overrides the process environment (tests); config reads process.env otherwise (IPB-01-19). */
export async function main(
  argv: string[],
  source?: Readonly<Record<string, string | undefined>>,
): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      profile: { type: "string" },
      modules: { type: "string" },
      adapters: { type: "string" },
      db: { type: "string" },
      rotate: { type: "boolean", default: false },
      "no-file": { type: "boolean", default: false },
    },
  });
  const command = positionals[0] ?? "run";
  const profile = (values.profile ?? (command === "credentials" ? "dev" : undefined)) as
    SeedProfile | undefined;
  if (!profile || !(SEED_PROFILES as readonly string[]).includes(profile)) {
    process.stderr.write(
      `usage: infrabyx-seed [run|purge|credentials] --profile <${SEED_PROFILES.join("|")}>\n`,
    );
    return 2;
  }
  const gate = await validateEnv(gateSchema, { ...(source ? { source } : {}), guards: [] });
  if (!gate.ok) {
    for (const f of gate.failures) process.stderr.write(`  ${f.code} ${f.name}: ${f.reason}\n`);
    return 78;
  }
  try {
    assertSeedAllowed(gate.values, command === "run" ? profile : undefined);
  } catch (e) {
    // The refusal comes before the rest of the configuration is read, so APP_PRODUCT may be unset.
    const product = gate.values.APP_PRODUCT ?? scaffoldedProduct() ?? "unknown";
    const ev = internalEvent({
      product,
      event: "SeedRefused",
      tenantId: SEED_TENANT_IDS.platform,
      data: { env: gate.values.APP_ENV, actor: SEED_PRINCIPAL.id, profile },
    });
    process.stderr.write(`${JSON.stringify({ msg: "event", event: ev })}\n`);
    process.stderr.write(`${isIpbError(e) ? e.message : String(e)}\n`);
    return 1;
  }

  let adapters: {
    secrets?: SecretsPort;
    identity?: IdentityProvisioning;
    resolveSecret?: SecretResolver;
  } = {};
  if (values.adapters) adapters = await importNamed(values.adapters, "seedAdapters");
  const env = await loadAndValidate(seedEnvSchema, {
    ...(source ? { source } : {}),
    ...(adapters.resolveSecret ? { secrets: adapters.resolveSecret } : {}),
  });
  const connectionString = values.db ?? env.DB_URL;
  const product = env.APP_PRODUCT;

  if (command === "purge") {
    const client = new pg.Client(connectionConfig(connectionString, env.DB_PASSWORD));
    await client.connect();
    try {
      const r = await purgeSeed(client, env, profile);
      process.stdout.write(`purged ${r.deleted} rows seeded by profile ${profile}\n`);
      return 0;
    } finally {
      await client.end();
    }
  }

  if (command === "credentials") {
    if (!adapters.secrets || !adapters.identity) {
      process.stderr.write(
        "credentials need --adapters <module> exporting seedAdapters = { secrets, identity }\n",
      );
      return 2;
    }
    await generateCredentials({
      env,
      product,
      ...(env.AUTH_SUPER_ADMIN_EMAIL ? { superAdminEmail: env.AUTH_SUPER_ADMIN_EMAIL } : {}),
      secrets: adapters.secrets,
      identity: adapters.identity,
      vaultPrefix: env.SEED_VAULT_PREFIX ?? "",
      hashListPath: "infrabyx/_seed/password-hashes",
      filePath: env.SEED_CREDENTIALS_PATH ?? "./SEED_CREDENTIALS.md",
      runId: newId("run"),
      noFile: values["no-file"],
      rotate: values.rotate,
      repoRoot: process.cwd(),
    });
    return 0;
  }

  const modules: SeedModule[] = [
    platformSeedModule,
    ...(values.modules ? await importNamed<SeedModule[]>(values.modules, "seedModules") : []),
  ];
  const pool = new pg.Pool(connectionConfig(connectionString, env.DB_PASSWORD));
  try {
    const report = await runSeed({
      kernel: new PgKernel({ pool }),
      audit: new PgAuditSink(),
      outbox: new PgOutbox(),
      env,
      product,
      profile,
      modules,
      randomSeed: env.SEED_RANDOM_SEED ?? 0,
      ...(env.AUTH_SUPER_ADMIN_EMAIL ? { superAdminEmail: env.AUTH_SUPER_ADMIN_EMAIL } : {}),
    });
    const t = report.totals;
    process.stdout.write(
      `seed ${profile}: ${t.inserted} inserted / ${t.updated} updated / ${t.unchanged} unchanged (run ${report.runId})\n`,
    );
    return 0;
  } finally {
    await pool.end();
  }
}

// pnpm and npm run a bin through a symlink; Node resolves the module to its real path (PR-UDF-005).
const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(realpathSync(entry)).href) {
  main(process.argv.slice(2)).then(
    (c) => process.exit(c),
    (e: unknown) => {
      process.stderr.write(`${(e as Error).message}\n`);
      process.exit(1);
    },
  );
}
