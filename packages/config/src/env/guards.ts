// Production guard-rails (IPB-11-14 … IPB-11-20) and supabase-guard (IPB-01 §01.4.11), as a table.
// Guard groups follow IPB-11 §11.2: pre-prod gets prod rules; pre-prod and demo get staging rules.
// This is the only place environment-specific branches live (IPB-11-04).
import {
  NO_SUPABASE_ENVS,
  SECRET_REF_ENVS,
  isProdGuarded,
  isStagingGuarded,
  type AppEnv,
} from "@infrabyx/contracts/env";
import type { IpbErrorCode } from "@infrabyx/contracts/errors";
import { isSecretRef } from "@infrabyx/contracts/ports";
import { matchesDevKey } from "@infrabyx/crypto";
import type { EnvVarInfo } from "./schema.js";

export interface GuardFailure {
  name: string;
  code: IpbErrorCode;
  reason: string;
}

export interface GuardInput {
  env: AppEnv;
  vars: readonly EnvVarInfo[];
  /** Raw strings from the process environment (undeclared variables included). */
  raw: Readonly<Record<string, string | undefined>>;
  /** Registered public hosts for the product (brand pack host map, IPB-11-18). */
  hostMap?: readonly string[];
}

export interface Guard {
  id: string;
  source: string;
  /** "raw" guards run before secret resolution; "resolved" guards see resolved secret values. */
  phase: "raw" | "resolved";
  applies(env: AppEnv): boolean;
  check(input: GuardInput): GuardFailure[];
}

const val = (i: GuardInput, n: string): string | undefined => {
  const v = i.raw[n];
  return v === undefined || v === "" ? undefined : v;
};

const FORBIDDEN_HOSTS = [
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "host.docker.internal",
  "[::1]",
  "::1",
];
const FORBIDDEN_SUFFIXES = [".local", ".test", ".localhost"];

/** Hosts of every URL-shaped value (comma lists included). */
function urls(v: string): URL[] {
  return v
    .split(",")
    .filter((p) => /^[a-z][a-z0-9+.-]*:\/\//i.test(p))
    .flatMap((p) => (URL.canParse(p) ? [new URL(p)] : []));
}

// Literal values from the local template and common defaults; checked on secrets only.
const DEV_LITERALS = [
  "dev-secret",
  "postgres",
  "minioadmin",
  "changeme",
  "password",
  "admin123",
  "secret",
  "app",
  "migrator",
];
/** Payment-gateway test credentials (Razorpay, Cashfree, PayU test merchant). */
const TEST_KEY_PREFIXES = ["rzp_test_", "TEST", "gtKFFx"];
const KEY_NAME = /(?:_KEY|_SECRET|_TOKEN|JWT|ENCRYPTION)(?:_|$)/;

export const GUARDS: readonly Guard[] = [
  {
    id: "node-env",
    source: "IPB-11-14",
    phase: "raw",
    applies: isProdGuarded,
    check: (i) =>
      val(i, "NODE_ENV") === "production"
        ? []
        : [{ name: "NODE_ENV", code: "IPB-ENV-006", reason: "must be production" }],
  },
  {
    id: "seed-refused",
    source: "IPB-11-14",
    phase: "raw",
    applies: isProdGuarded,
    check: (i) => {
      const f: GuardFailure[] = [];
      if (val(i, "SEED_PROFILE") !== undefined)
        f.push({
          name: "SEED_PROFILE",
          code: "IPB-ENV-001",
          reason: "seed profile refused in production",
        });
      const en = val(i, "SEED_ENABLED");
      if (en !== undefined && en !== "false")
        f.push({
          name: "SEED_ENABLED",
          code: "IPB-ENV-001",
          reason: "seeding refused in production",
        });
      return f;
    },
  },
  {
    id: "literal-secret",
    source: "IPB-11-15",
    phase: "raw",
    applies: (e) => SECRET_REF_ENVS.includes(e),
    check: (i) =>
      i.vars
        .filter(
          (v) =>
            v.meta.sens === "S" &&
            val(i, v.name) !== undefined &&
            !isSecretRef(val(i, v.name) as string),
        )
        .map((v) => ({ name: v.name, code: "IPB-ENV-003", reason: "literal secret" })),
  },
  {
    id: "forbidden-host",
    source: "IPB-11-16",
    phase: "raw",
    applies: isProdGuarded,
    check: (i) => {
      const f: GuardFailure[] = [];
      const otlpInsecure = val(i, "OBS_OTLP_INSECURE") === "true";
      for (const v of i.vars) {
        const raw = val(i, v.name);
        if (raw === undefined || v.meta.sens === "S") continue;
        for (const u of urls(raw)) {
          const h = u.hostname.toLowerCase();
          if (FORBIDDEN_HOSTS.includes(h) || FORBIDDEN_SUFFIXES.some((s) => h.endsWith(s))) {
            f.push({ name: v.name, code: "IPB-ENV-004", reason: "forbidden host" });
            break;
          }
          if (u.protocol === "http:" && !(v.name === "OBS_OTLP_ENDPOINT" && otlpInsecure)) {
            f.push({ name: v.name, code: "IPB-ENV-004", reason: "forbidden http:// URL" });
            break;
          }
        }
      }
      return f;
    },
  },
  {
    id: "known-dev-value",
    source: "IPB-11-17",
    phase: "resolved",
    applies: isStagingGuarded,
    check: (i) => {
      const f: GuardFailure[] = [];
      for (const v of i.vars) {
        const raw = val(i, v.name);
        if (raw === undefined) continue;
        const secret = v.meta.sens === "S";
        const known =
          /:\/\/(?:postgres:postgres|minioadmin:minioadmin)@/i.test(raw) ||
          (secret && DEV_LITERALS.includes(raw.toLowerCase())) ||
          (secret &&
            v.name.startsWith("PAYMENTS_") &&
            TEST_KEY_PREFIXES.some((p) => raw.startsWith(p))) ||
          (secret && raw.startsWith("rzp_test_")) ||
          (secret && matchesDevKey(raw));
        if (known) f.push({ name: v.name, code: "IPB-ENV-005", reason: "known development value" });
        else if (secret && KEY_NAME.test(v.name) && Buffer.byteLength(raw) < 32) {
          f.push({ name: v.name, code: "IPB-ENV-005", reason: "key shorter than 32 bytes" });
        }
      }
      return f;
    },
  },
  {
    // P-03: no live payment credential outside prod and dr (Razorpay live key ids start rzp_live_;
    // Cashfree's production host is refused by its adapter). Any variable, declared or not.
    id: "payments-live-key",
    source: "PL2 plan §8 P-03",
    phase: "resolved",
    applies: (env) => env !== "prod" && env !== "dr",
    check: (i) =>
      Object.entries(i.raw)
        .filter(([, v]) => typeof v === "string" && v.startsWith("rzp_live_"))
        .map(([name]) => ({
          name,
          code: "IPB-ENV-005" as const,
          reason: "live payment credential outside prod/dr (P-03)",
        })),
  },
  {
    id: "public-url-host-map",
    source: "IPB-11-18",
    phase: "raw",
    applies: isProdGuarded,
    check: (i) => {
      const f: GuardFailure[] = [];
      for (const name of ["APP_BASE_URL", "APP_PUBLIC_URL", "AUTH_ISSUER_URL"]) {
        const raw = val(i, name);
        if (raw === undefined) continue;
        const u = URL.canParse(raw) ? new URL(raw) : null;
        if (!u || u.protocol !== "https:")
          f.push({ name, code: "IPB-ENV-010", reason: "must use https://" });
        else if (!i.hostMap)
          f.push({ name, code: "IPB-ENV-010", reason: "no registered host map supplied" });
        else if (!i.hostMap.includes(u.hostname.toLowerCase()))
          f.push({ name, code: "IPB-ENV-010", reason: "host not in the registered host map" });
      }
      return f;
    },
  },
  {
    id: "db-tls",
    source: "IPB-11-19",
    phase: "raw",
    applies: (e) => isProdGuarded(e) || e === "staging",
    check: (i) => {
      const f: GuardFailure[] = [];
      if (i.vars.some((v) => v.name === "DB_SSL_MODE") && val(i, "DB_SSL_MODE") !== "verify-full") {
        f.push({ name: "DB_SSL_MODE", code: "IPB-ENV-007", reason: "must be verify-full" });
      }
      const db = val(i, "DB_URL");
      if (db && URL.canParse(db) && new URL(db).password !== "")
        f.push({ name: "DB_URL", code: "IPB-ENV-003", reason: "password in URL; use DB_PASSWORD" });
      return f;
    },
  },
  {
    id: "ai-india-region",
    source: "IPB-11-20",
    phase: "raw",
    applies: () => true,
    check: (i) => {
      const rules: Array<[RegExp, string]> = [
        [/^AI_BEDROCK_REGION$/, "ap-south-1"],
        [/^AI_AZURE_[A-Z_]*REGION$/, "centralindia"],
        [/^AI_VERTEX_REGION$/, "asia-south1"],
      ];
      const f: GuardFailure[] = [];
      for (const [re, want] of rules) {
        for (const name of Object.keys(i.raw).filter((n) => re.test(n))) {
          const raw = val(i, name);
          if (raw !== undefined && raw !== want)
            f.push({ name, code: "IPB-ENV-008", reason: `region must be ${want}` });
        }
      }
      return f;
    },
  },
  {
    id: "supabase-guard",
    source: "IPB-01 §01.4.11",
    phase: "raw",
    applies: (e) => NO_SUPABASE_ENVS.includes(e),
    check: (i) =>
      Object.entries(i.raw)
        .filter(
          ([, v]) =>
            v !== undefined &&
            /(?:^|[/@.])[a-z0-9-]*\.?supabase\.(?:co|com|net)(?:[:/]|$)/i.test(v),
        )
        .map(([name]) => ({
          name,
          code: "IPB-ENV-002",
          reason: "Supabase host is not allowed in this environment",
        })),
  },
];

export function runGuards(
  input: GuardInput,
  phase: Guard["phase"],
  guards: readonly Guard[] = GUARDS,
): { failures: GuardFailure[]; passed: string[] } {
  const failures: GuardFailure[] = [];
  const passed: string[] = [];
  for (const g of guards) {
    if (g.phase !== phase || !g.applies(input.env)) continue;
    const f = g.check(input);
    if (f.length) failures.push(...f);
    else passed.push(g.id);
  }
  return { failures, passed };
}
