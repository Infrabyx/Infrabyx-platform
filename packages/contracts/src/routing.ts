// provider_routing schema (IPB-01 §01.4.5, IPB-01-20) with the PL2 load-time rules:
// tighten-only residency and recipient delivery (IPB-DEV-05), unproven adapters refused in
// staging and above (IPB-DEV-04). Invalid files fail boot and CI with IPB-PORT-005.
import { z } from "zod";
import {
  DATA_CLASSES,
  DEFAULT_RESIDENCY_POLICY,
  DataClass,
  Residency,
  atLeast,
  residencyAllows,
} from "./data-class.js";
import { PortError } from "./errors.js";
import { MESSAGING_PORTS } from "./ports/common.js";
import { PORT_CATALOGUE } from "./ports/catalogue.js";

export const FAILOVER_MODES = ["read_only_failover", "active_failover", "none"] as const;
export const FailoverMode = z.enum(FAILOVER_MODES);

/** SECRETS path, never a literal (IPB-02 §02.4.4). */
export const SECRETS_PATH = /^secrets\/[a-z][a-z0-9-]*\/[a-z0-9_]+(\/[A-Za-z0-9_.-]+)*$/;

export const CircuitBreaker = z
  .object({
    failure_threshold: z.number().int().positive().default(5),
    error_rate_threshold: z.number().gt(0).lte(1).default(0.5),
    window_seconds: z.number().int().positive().default(60),
    open_seconds: z.number().int().positive().default(30),
    half_open_max_calls: z.number().int().positive().default(3),
  })
  .partial();

export const AdapterInstance = z.object({
  adapter: z.string().regex(/^[a-z][a-z0-9-]*$/),
  residency: Residency,
  max_data_class: DataClass,
  config: z.record(z.string(), z.unknown()).optional(),
  secrets: z.string().optional(),
  mode: FailoverMode.optional(),
  model: z.string().optional(),
  attestation: z.enum(["required", "optional"]).optional(),
  /** Vendor Assurance Room DPA reference (IPB-DEV-05). */
  dpa_ref: z.string().optional(),
});
export type AdapterInstance = z.infer<typeof AdapterInstance>;

export const ResidencyPolicy = z.partialRecord(DataClass, z.array(Residency));

export const FailoverRule = z.object({
  success_rate_below: z.number().gt(0).lt(1),
  over_minutes: z.number().int().positive(),
  /** Minimum attempts in the window before the rule may fire (P-08: 20). */
  min_attempts: z.number().int().positive().default(20),
});

export const PortRouting = z.object({
  primary: AdapterInstance.optional(),
  secondary: AdapterInstance.optional(),
  model_classes: z
    .record(
      z.string(),
      z.object({ primary: AdapterInstance, secondary: AdapterInstance.optional() }),
    )
    .optional(),
  circuit_breaker: CircuitBreaker.optional(),
  health_interval_seconds: z.number().int().positive().optional(),
  residency_policy: ResidencyPolicy.optional(),
  failover_rule: FailoverRule.optional(),
});
export type PortRouting = z.infer<typeof PortRouting>;

export const RoutingFile = z.object({
  version: z.literal(1),
  defaults: z
    .object({
      circuit_breaker: CircuitBreaker.optional(),
      timeout_ms: z.number().int().positive().optional(),
      retries: z.number().int().min(0).max(10).optional(),
      retry_backoff_ms: z.number().int().positive().optional(),
      residency_policy: ResidencyPolicy.optional(),
      recipient_delivery: z.object({ allow_global: z.boolean() }).optional(),
    })
    .optional(),
  ports: z.record(z.string(), PortRouting),
});
export type RoutingFile = z.infer<typeof RoutingFile>;

/** Environments in which an `unproven` adapter is refused (IPB-DEV-04 gate B). */
export const PROVEN_ONLY_ENVS = ["staging", "pre-prod", "prod", "dr"] as const;

export interface RoutingCheckOptions {
  /** Environment the file is for (from its name `<env>.routing.yaml`). */
  env: string;
  /** Ports the loaded modules declare; each must have a primary. */
  requiredPorts?: readonly string[];
  /** Adapters marked `unproven` in packages/connectors/sandbox-status.json. */
  unprovenAdapters?: ReadonlySet<string>;
  /** Platform residency policy; product files may only narrow it. */
  platformPolicy?: Readonly<Record<DataClass, readonly Residency[]>>;
}

/** Ports that may route to an LLM-style model-class table (IPB-01 §01.4.5). */
const MODEL_CLASS_PORTS = new Set(["LLM", "EMBEDDING", "IMAGE_GEN", "SPEECH", "TRANSLATE"]);

/**
 * Parse and validate a routing document. Throws PortError IPB-PORT-005 listing every problem.
 * Returns the parsed file and the effective residency policy per port.
 */
export function checkRouting(
  doc: unknown,
  opts: RoutingCheckOptions,
): { file: RoutingFile; policyFor(port: string): Record<DataClass, Residency[]> } {
  const parsed = RoutingFile.safeParse(doc);
  const problems: string[] = [];
  if (!parsed.success) {
    for (const i of parsed.error.issues)
      problems.push(`${i.path.join(".") || "(root)"}: ${i.message}`);
    throw routingError(problems, opts.env);
  }
  const file = parsed.data;
  const platform = opts.platformPolicy ?? DEFAULT_RESIDENCY_POLICY;

  const fileLevel = narrow(
    platform,
    file.defaults?.residency_policy,
    "defaults.residency_policy",
    problems,
  );
  const perPort = new Map<string, Record<DataClass, Residency[]>>();
  const allowGlobalRecipients = file.defaults?.recipient_delivery?.allow_global ?? true;

  for (const [port, r] of Object.entries(file.ports)) {
    if (!(port in PORT_CATALOGUE) && !MODEL_CLASS_PORTS.has(port))
      problems.push(`ports.${port}: not a catalogue port (IPB-01 §01.4.4)`);
    const policy = narrow(
      fileLevel,
      r.residency_policy,
      `ports.${port}.residency_policy`,
      problems,
    );
    perPort.set(port, policy);

    const pairs: Array<[string, AdapterInstance | undefined, AdapterInstance | undefined]> = [];
    if (r.model_classes) {
      if (!MODEL_CLASS_PORTS.has(port))
        problems.push(`ports.${port}: model_classes only for AI ports`);
      for (const [mc, p] of Object.entries(r.model_classes))
        pairs.push([`ports.${port}.model_classes.${mc}`, p.primary, p.secondary]);
    } else {
      if (!r.primary) problems.push(`ports.${port}: primary missing`);
      pairs.push([`ports.${port}`, r.primary, r.secondary]);
    }

    for (const [where, primary, secondary] of pairs) {
      for (const [role, inst] of [
        ["primary", primary],
        ["secondary", secondary],
      ] as const) {
        if (!inst) continue;
        const at = `${where}.${role}`;
        if (inst.secrets !== undefined) {
          if (!SECRETS_PATH.test(inst.secrets))
            problems.push(`${at}.secrets: must be a SECRETS path secrets/<env>/…, never a literal`);
          else if (inst.secrets.split("/")[1] !== opts.env)
            problems.push(
              `${at}.secrets: path is for env "${inst.secrets.split("/")[1]}", file is for "${opts.env}"`,
            );
        }
        if (!residencyAllows(inst.residency, inst.max_data_class, policy))
          problems.push(
            `${at}: residency ${inst.residency} cannot carry ${inst.max_data_class} under the residency policy`,
          );
        if (MESSAGING_PORTS.includes(port) && inst.residency === "GLOBAL") {
          if (!allowGlobalRecipients)
            problems.push(
              `${at}: GLOBAL ${port} adapter but recipient_delivery.allow_global is false (IPB-DEV-05)`,
            );
          else if (!inst.dpa_ref)
            problems.push(
              `${at}: GLOBAL ${port} adapter needs dpa_ref to receive recipients (IPB-DEV-05)`,
            );
        }
        if (
          opts.unprovenAdapters?.has(inst.adapter) &&
          (PROVEN_ONLY_ENVS as readonly string[]).includes(opts.env)
        )
          problems.push(
            `${at}: adapter ${inst.adapter} is unproven; not allowed in ${opts.env} (IPB-DEV-04 gate B)`,
          );
      }
      if (primary && secondary && (secondary.mode ?? "none") !== "none") {
        for (const c of DATA_CLASSES) {
          if (!atLeast(primary.max_data_class, c)) break;
          if (!residencyAllows(primary.residency, c, policy)) continue;
          if (!residencyAllows(secondary.residency, c, policy)) {
            problems.push(
              `${where}.secondary: failover from ${primary.residency} to ${secondary.residency} crosses residency for ${c}; set mode: none (IPB-01-18)`,
            );
            break;
          }
        }
      }
    }
  }
  for (const port of opts.requiredPorts ?? []) {
    if (!file.ports[port])
      problems.push(`ports.${port}: required by a loaded module but not routed`);
  }
  if (problems.length) throw routingError(problems, opts.env);
  return {
    file,
    policyFor: (port) => perPort.get(port) ?? cloneRecord(fileLevel),
  };
}

function narrow(
  base: Readonly<Record<DataClass, readonly Residency[]>>,
  override: Partial<Record<DataClass, Residency[]>> | undefined,
  where: string,
  problems: string[],
): Record<DataClass, Residency[]> {
  const out = cloneRecord(base);
  if (!override) return out;
  for (const c of DATA_CLASSES) {
    const want = override[c];
    if (!want) continue;
    const loosened = want.filter((r) => !base[c].includes(r));
    if (loosened.length)
      problems.push(
        `${where}.${c}: may only tighten; ${loosened.join(", ")} not allowed above (IPB-DEV-05)`,
      );
    out[c] = want.filter((r) => base[c].includes(r));
  }
  return out;
}

const cloneRecord = (
  p: Readonly<Record<DataClass, readonly Residency[]>>,
): Record<DataClass, Residency[]> =>
  Object.fromEntries(DATA_CLASSES.map((c) => [c, [...p[c]]])) as Record<DataClass, Residency[]>;

function routingError(problems: string[], env: string): PortError {
  return new PortError("IPB-PORT-005", "routing", {
    detail: `${problems.length} problem(s) in the ${env} routing file`,
    meta: { problems },
  });
}
