import { describe, expect, it } from "vitest";
import { z } from "zod";
import { devKeyFingerprints } from "@infrabyx/crypto";
import { generateEnvExample, exampleDrift } from "./example.js";
import { loadAndValidate, validateEnv, type SecretResolver } from "./load.js";
import { REDACTED, redact, redactionMap } from "./redact.js";
import { envBool, envInt, envList, envUrl, envVar, secretRef, describeSchema } from "./schema.js";

const schema = z.object({
  APP_ENV: envVar(
    z.enum(["local", "dev", "test", "preview", "staging", "pre-prod", "demo", "prod", "dr"]),
    { desc: "Deployment environment", example: "local", required: "all", sens: "C", port: "APP" },
  ),
  NODE_ENV: envVar(z.enum(["development", "test", "production"]), {
    desc: "Node framework mode",
    example: "development",
    required: "all",
    sens: "C",
    port: "APP",
  }),
  APP_BASE_URL: envVar(envUrl(), {
    desc: "API base URL",
    example: "http://localhost:4000",
    required: "all",
    sens: "C",
    port: "APP",
  }),
  APP_PORT: envVar(envInt({ min: 1, max: 65535 }), {
    desc: "HTTP listen port",
    example: "4000",
    required: "all",
    sens: "C",
    port: "APP",
  }),
  APP_CORS_ORIGINS: envVar(envList(), {
    desc: "Comma list",
    example: "http://localhost:3000",
    required: "opt",
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
    prodExample: "secret://aws-sm/infrabyx/ldc/prod/db#password",
    required: "all",
    port: "DB",
  }),
  DB_SSL_MODE: envVar(z.enum(["disable", "require", "verify-full"]), {
    desc: "TLS mode",
    example: "disable",
    required: "all",
    sens: "C",
    port: "DB",
  }),
  AUTH_CLIENT_SECRET: secretRef({
    desc: "OIDC client secret",
    example: "dev-secret",
    required: "all",
    port: "AUTH",
  }),
  AI_BEDROCK_REGION: envVar(z.string(), {
    desc: "Must be ap-south-1",
    example: "ap-south-1",
    required: "opt",
    sens: "C",
    port: "AI",
  }),
  SEED_ENABLED: envVar(envBool(), {
    desc: "Must be false/unset in prod/dr/pre-prod",
    example: "true",
    required: "nonprod",
    sens: "C",
    port: "SEED",
  }),
  SEED_PROFILE: envVar(z.enum(["dev", "demo", "test", "load"]), {
    desc: "Seed profile",
    example: "dev",
    required: "opt",
    sens: "C",
    port: "SEED",
  }),
});

const STRONG = "s3cr3t-value-that-is-long-enough-xyz";
const vault: Record<string, string> = {
  "infrabyx/ldc/prod/db": JSON.stringify({ password: STRONG }),
  "infrabyx/ldc/prod/auth": JSON.stringify({
    client_secret: "oidc-client-secret-which-is-long-enough",
  }),
  "infrabyx/ldc/prod/dev": JSON.stringify({ client_secret: "dev-secret" }),
};
const secrets: SecretResolver = async (ref) => {
  const v = vault[ref.path];
  if (!v) throw new Error("not found");
  return (JSON.parse(v) as Record<string, string>)[ref.key] as string;
};

const prodEnv = (over: Record<string, string | undefined> = {}) => ({
  APP_ENV: "prod",
  NODE_ENV: "production",
  APP_BASE_URL: "https://api.lawdocscomply.in",
  APP_PORT: "4000",
  DB_URL: "postgres://app@db.internal.lawdocscomply.in:5432/ldc",
  DB_PASSWORD: "secret://aws-sm/infrabyx/ldc/prod/db#password",
  DB_SSL_MODE: "verify-full",
  AUTH_CLIENT_SECRET: "secret://aws-sm/infrabyx/ldc/prod/auth#client_secret",
  ...over,
});
const hostMap = ["api.lawdocscomply.in"];

async function boot(source: Record<string, string | undefined>) {
  const err: string[] = [];
  const log: string[] = [];
  let exitCode: number | null = null;
  const values = await loadAndValidate(schema, {
    source,
    secrets,
    hostMap,
    stderr: (l) => err.push(l),
    log: (l) => log.push(l),
    exit: (c) => {
      exitCode = c;
      return undefined as never;
    },
  });
  return { values, err: err.join("\n"), log, exitCode };
}

// Every value except the environment catalogue words, which also occur in reasons ("in production").
const values = (s: Record<string, string | undefined>) =>
  Object.entries(s)
    .filter(([k, v]) => k !== "APP_ENV" && k !== "NODE_ENV" && !!v && v.length > 3)
    .map(([, v]) => v as string);

describe("@IPB-11-AT-01 @IPB-02-AT-07 @IPB-11-14 production refuses seed profiles and unsafe values", () => {
  it("SEED_PROFILE present in production → exit 78, names SEED_PROFILE, prints no value", async () => {
    const src = prodEnv({ SEED_PROFILE: "dev" });
    const r = await boot(src);
    expect(r.exitCode).toBe(78);
    expect(r.err).toContain("SEED_PROFILE");
    expect(r.err).toContain("IPB-ENV-001");
    for (const v of values(src)) expect(r.err).not.toContain(v);
  });
  it("localhost database URL in production → DB_URL forbidden host", async () => {
    const r = await boot(prodEnv({ DB_URL: "postgres://app@localhost:5432/ldc" }));
    expect(r.exitCode).toBe(78);
    expect(r.err).toMatch(/IPB-ENV-004 DB_URL: forbidden host/);
    expect(r.err).not.toContain("localhost");
  });
  it("literal secret in staging → DB_PASSWORD literal secret", async () => {
    const r = await boot({ ...prodEnv({ APP_ENV: "staging", DB_PASSWORD: "app" }) });
    expect(r.exitCode).toBe(78);
    expect(r.err).toMatch(/IPB-ENV-003 DB_PASSWORD: literal secret/);
  });
  it("development key in production → AUTH_CLIENT_SECRET known development value", async () => {
    const r = await boot(
      prodEnv({ AUTH_CLIENT_SECRET: "secret://aws-sm/infrabyx/ldc/prod/dev#client_secret" }),
    );
    expect(r.exitCode).toBe(78);
    expect(r.err).toMatch(/IPB-ENV-005 AUTH_CLIENT_SECRET: known development value/);
    expect(r.err).not.toContain("dev-secret");
  });
  it("NODE_ENV and SEED_ENABLED in pre-prod (production group, IPB-11 §11.2)", async () => {
    const r = await boot(
      prodEnv({ APP_ENV: "pre-prod", NODE_ENV: "development", SEED_ENABLED: "true" }),
    );
    expect(r.err).toMatch(/IPB-ENV-006 NODE_ENV/);
    expect(r.err).toMatch(/IPB-ENV-001 SEED_ENABLED/);
  });
  it("a clean production environment passes and logs config.guard.passed=true without values", async () => {
    const r = await boot(prodEnv());
    expect(r.exitCode).toBeNull();
    expect(r.values.DB_PASSWORD).toBe(STRONG);
    expect(r.values.APP_PORT).toBe(4000);
    const line = JSON.parse(r.log[0] as string) as { msg: string; checks: string[] };
    expect(line.msg).toBe("config.guard.passed=true");
    expect(line.checks).toEqual(
      expect.arrayContaining([
        "node-env",
        "seed-refused",
        "literal-secret",
        "forbidden-host",
        "known-dev-value",
        "public-url-host-map",
        "db-tls",
        "supabase-guard",
      ]),
    );
    expect(r.log[0]).not.toContain(STRONG);
  });
});

describe("IPB-11-02 schema failures", () => {
  it("missing DB_URL → exit 78 naming DB_URL (IPB-ENV-011)", async () => {
    const r = await boot({
      APP_ENV: "local",
      NODE_ENV: "development",
      APP_BASE_URL: "http://localhost:4000",
      APP_PORT: "4000",
      DB_PASSWORD: "app",
      DB_SSL_MODE: "disable",
      AUTH_CLIENT_SECRET: "dev-secret",
      SEED_ENABLED: "true",
    });
    expect(r.exitCode).toBe(78);
    expect(r.err).toMatch(/IPB-ENV-011 DB_URL: required/);
  });
  it("booleans are true/false only and lists have no spaces (IPB-11-06)", async () => {
    const r = await validateEnv(schema, {
      source: {
        ...prodEnv({
          APP_ENV: "local",
          NODE_ENV: "development",
          DB_PASSWORD: "app",
          AUTH_CLIENT_SECRET: "dev-secret",
        }),
        SEED_ENABLED: "yes",
        APP_CORS_ORIGINS: "a, b",
      },
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.failures.map((f) => f.name).sort()).toEqual([
      "APP_CORS_ORIGINS",
      "SEED_ENABLED",
    ]);
  });
  it("an unresolvable secret reference → IPB-ENV-009", async () => {
    const r = await boot(
      prodEnv({ DB_PASSWORD: "secret://aws-sm/infrabyx/ldc/prod/missing#password" }),
    );
    expect(r.err).toMatch(/IPB-ENV-009 DB_PASSWORD/);
  });
  it("public URLs need https and the host map (IPB-11-18), DB TLS verify-full (IPB-11-19)", async () => {
    const r = await boot(
      prodEnv({ APP_BASE_URL: "https://api.example.com", DB_SSL_MODE: "require" }),
    );
    expect(r.err).toMatch(/IPB-ENV-010 APP_BASE_URL/);
    expect(r.err).toMatch(/IPB-ENV-007 DB_SSL_MODE/);
  });
  it("refuses committed LocalKms dev keys in staging (IPB-11-17)", async () => {
    const devKey = devKeyFingerprints()[0]?.fingerprint as string;
    expect(devKey).toMatch(/^[0-9a-f]{64}$/);
    vault["infrabyx/ldc/staging/auth"] = JSON.stringify({ client_secret: devKey });
    const r = await boot(
      prodEnv({
        APP_ENV: "staging",
        SEED_ENABLED: "false",
        AUTH_CLIENT_SECRET: "secret://aws-sm/infrabyx/ldc/staging/auth#client_secret",
      }),
    );
    expect(r.err).toMatch(/IPB-ENV-005 AUTH_CLIENT_SECRET/);
  });
});

describe("@IPB-11-AT-07 India-resident AI adapter regions", () => {
  it("AI_BEDROCK_REGION=us-east-1 → exit 78 IPB-ENV-008 in any environment", async () => {
    const r = await boot({
      APP_ENV: "local",
      NODE_ENV: "development",
      APP_BASE_URL: "http://localhost:4000",
      APP_PORT: "4000",
      DB_URL: "postgres://app@localhost:5432/ldc",
      DB_PASSWORD: "app",
      DB_SSL_MODE: "disable",
      AUTH_CLIENT_SECRET: "dev-secret",
      SEED_ENABLED: "true",
      AI_BEDROCK_REGION: "us-east-1",
    });
    expect(r.exitCode).toBe(78);
    expect(r.err).toMatch(/IPB-ENV-008 AI_BEDROCK_REGION/);
  });
});

describe("@IPB-01-AT-12 supabase-guard", () => {
  it("a staging database URL containing .supabase.co fails with IPB-ENV-002", async () => {
    const r = await boot(
      prodEnv({ APP_ENV: "staging", DB_URL: "postgres://app@db.abcd.supabase.co:5432/postgres" }),
    );
    expect(r.err).toMatch(/IPB-ENV-002 DB_URL/);
  });
  it("dev may use Supabase for PostgreSQL", async () => {
    const r = await validateEnv(schema, {
      source: {
        APP_ENV: "dev",
        NODE_ENV: "development",
        APP_BASE_URL: "http://localhost:4000",
        APP_PORT: "4000",
        DB_URL: "postgres://app@db.abcd.supabase.co:5432/postgres",
        DB_PASSWORD: "x",
        DB_SSL_MODE: "require",
        AUTH_CLIENT_SECRET: "dev-secret",
        SEED_ENABLED: "true",
      },
    });
    expect(r.ok).toBe(true);
  });
});

describe("IPB-11-07 redaction from the schema", () => {
  it("every S value appears as ***", () => {
    expect([...redactionMap(schema)].sort()).toEqual(["AUTH_CLIENT_SECRET", "DB_PASSWORD"]);
    const dump = redact(schema, {
      DB_PASSWORD: "app",
      AUTH_CLIENT_SECRET: "dev-secret",
      DB_URL: "postgres://x",
    });
    expect(dump).toEqual({
      DB_PASSWORD: REDACTED,
      AUTH_CLIENT_SECRET: REDACTED,
      DB_URL: "postgres://x",
    });
  });
  it("schema metadata is mandatory and names follow IPB-11-05", () => {
    expect(() => describeSchema(z.object({ DB_URL: z.string() }))).toThrow(/envVar/);
    expect(() =>
      describeSchema(
        z.object({
          FOO_BAR: envVar(z.string(), {
            desc: "x",
            example: "x",
            required: "opt",
            sens: "C",
            port: "FOO",
          }),
        }),
      ),
    ).toThrow(/port prefix/);
  });
});

describe("@IPB-11-AT-06 schema and example stay in sync", () => {
  it("generates every variable with description, req and sens", () => {
    const text = generateEnvExample(schema, { product: "LDC" });
    expect(text).toMatch(
      /^DB_PASSWORD=app {2,}# PostgreSQL password · req:all · sens:S {2}\(prod: secret:\/\/aws-sm\/infrabyx\/ldc\/prod\/db#password\)$/m,
    );
    expect(text).toContain("# ---------- SEED_ ----------");
  });
  it("drift names the variable added without regenerating", () => {
    const committed = generateEnvExample(schema);
    const next = schema.extend({
      AI_NEW_KEY: envVar(z.string(), {
        desc: "new",
        example: "x",
        required: "opt",
        sens: "C",
        port: "AI",
      }),
    });
    expect(exampleDrift(committed, generateEnvExample(next))).toEqual(["AI_NEW_KEY"]);
    expect(exampleDrift(committed, committed)).toEqual([]);
  });
});
