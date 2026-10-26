// Boot-time loader (IPB-11 §11.4.2): parse → raw guards → resolve secret:// → resolved guards →
// `config.guard.passed=true`. Failures print names and reasons only, never values, and exit 78.
import type { z } from "zod";
import { AppEnv, isProdGuarded, isStagingGuarded } from "@infrabyx/contracts/env";
import { EXIT_CONFIG } from "@infrabyx/contracts/errors";
import {
  isSecretRef,
  parseSecretRef,
  type SecretRef,
  type SecretsPort,
} from "@infrabyx/contracts/ports";
import { GUARDS, runGuards, type Guard, type GuardFailure } from "./guards.js";
import { describeSchema, type EnvSchema, type Required } from "./schema.js";

export type SecretResolver = (ref: SecretRef, name: string) => Promise<string>;

export interface ValidateOptions {
  /** Defaults to process.env. */
  source?: Readonly<Record<string, string | undefined>>;
  secrets?: SecretResolver;
  hostMap?: readonly string[];
  guards?: readonly Guard[];
}

export type ValidateResult<S extends EnvSchema> =
  | { ok: true; env: AppEnv; values: z.output<S>; checks: string[] }
  | { ok: false; env: AppEnv | null; failures: GuardFailure[] };

export interface LoadOptions extends ValidateOptions {
  exit?: (code: number) => never;
  stderr?: (line: string) => void;
  log?: (line: string) => void;
}

function requiredIn(r: Required, env: AppEnv): boolean {
  if (r === "all") return true;
  if (r === "nonprod") return !isProdGuarded(env);
  if (r === "prod") return isStagingGuarded(env);
  return false;
}

const issues = (e: z.ZodError): string => e.issues.map((i) => i.message).join("; ");

/** Validate without exiting; for tests and tooling. */
export async function validateEnv<S extends EnvSchema>(
  schema: S,
  opts: ValidateOptions = {},
): Promise<ValidateResult<S>> {
  // eslint-config exempts packages/config from ipb/no-process-env (IPB-11-01).
  const source = opts.source ?? process.env;
  const guards = opts.guards ?? GUARDS;
  const raw: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(source)) raw[k] = v === "" ? undefined : v;
  const appEnv = AppEnv.safeParse(raw.APP_ENV);
  if (!appEnv.success)
    return {
      ok: false,
      env: null,
      failures: [
        {
          name: "APP_ENV",
          code: "IPB-ENV-011",
          reason: "missing or not in the IPB-09 environment catalogue",
        },
      ],
    };
  const env = appEnv.data;
  const vars = describeSchema(schema);
  const failures: GuardFailure[] = [];
  const values: Record<string, unknown> = {};
  const deferred: Array<{ name: string; ref: SecretRef; schema: z.ZodType }> = [];

  for (const v of vars) {
    const s = raw[v.name];
    if (s === undefined) {
      if (requiredIn(v.meta.required, env))
        failures.push({ name: v.name, code: "IPB-ENV-011", reason: "required" });
      continue;
    }
    if (v.meta.sens === "S" && isSecretRef(s)) {
      deferred.push({ name: v.name, ref: parseSecretRef(s) as SecretRef, schema: v.schema });
      continue;
    }
    const r = v.schema.safeParse(s);
    if (r.success) values[v.name] = r.data;
    else failures.push({ name: v.name, code: "IPB-ENV-011", reason: issues(r.error) });
  }

  const pre = runGuards(
    { env, vars, raw, ...(opts.hostMap ? { hostMap: opts.hostMap } : {}) },
    "raw",
    guards,
  );
  failures.push(...pre.failures);
  if (failures.length) return { ok: false, env, failures };

  const resolvedRaw = { ...raw };
  for (const d of deferred) {
    let secret: string;
    try {
      if (!opts.secrets) throw new Error("no SECRETS resolver configured");
      secret = await opts.secrets(d.ref, d.name);
    } catch {
      failures.push({
        name: d.name,
        code: "IPB-ENV-009",
        reason: `secret reference could not be resolved (adapter ${d.ref.adapter})`,
      });
      continue;
    }
    const r = d.schema.safeParse(secret);
    if (r.success) {
      values[d.name] = r.data;
      resolvedRaw[d.name] = secret;
    } else
      failures.push({
        name: d.name,
        code: "IPB-ENV-011",
        reason: "resolved secret does not match the schema",
      });
  }
  if (failures.length) return { ok: false, env, failures };

  const post = runGuards(
    { env, vars, raw: resolvedRaw, ...(opts.hostMap ? { hostMap: opts.hostMap } : {}) },
    "resolved",
    guards,
  );
  if (post.failures.length) return { ok: false, env, failures: post.failures };
  return { ok: true, env, values: values as z.output<S>, checks: [...pre.passed, ...post.passed] };
}

/** The boot-time entry point: `export const env = await loadAndValidate(envSchema, { secrets })`. */
export async function loadAndValidate<S extends EnvSchema>(
  schema: S,
  opts: LoadOptions = {},
): Promise<z.output<S>> {
  const stderr = opts.stderr ?? ((l: string) => process.stderr.write(`${l}\n`));
  const log = opts.log ?? ((l: string) => process.stdout.write(`${l}\n`));
  const exit = opts.exit ?? ((c: number) => process.exit(c));
  const r = await validateEnv(schema, opts);
  if (!r.ok) {
    stderr(
      `config: environment refused (${r.failures.length} problem${r.failures.length === 1 ? "" : "s"}); values are never printed`,
    );
    for (const f of r.failures) stderr(`  ${f.code} ${f.name}: ${f.reason}`);
    return exit(EXIT_CONFIG);
  }
  log(
    JSON.stringify({
      msg: "config.guard.passed=true",
      "config.guard.passed": true,
      app_env: r.env,
      checks: r.checks,
    }),
  );
  return r.values;
}

/**
 * Resolver over SECRETS adapters keyed by reference adapter name (`secret://aws-sm/...`).
 * A JSON object secret yields its `#key` member; any other secret is returned whole.
 */
export function secretsResolver(adapters: Readonly<Record<string, SecretsPort>>): SecretResolver {
  return async (ref) => {
    const port = adapters[ref.adapter];
    if (!port) throw new Error(`no SECRETS adapter "${ref.adapter}"`);
    const { value } = await port.get(ref.path);
    try {
      const obj = JSON.parse(value) as unknown;
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        const member = (obj as Record<string, unknown>)[ref.key];
        if (typeof member !== "string") throw new Error(`secret has no member ${ref.key}`);
        return member;
      }
    } catch (e) {
      if (!(e instanceof SyntaxError)) throw e;
    }
    return value;
  };
}
