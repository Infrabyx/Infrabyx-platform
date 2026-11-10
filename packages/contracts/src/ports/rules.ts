// RULES port (IPB-01 RULES; PL3 plan §4). Rule sets are data: an engine-neutral decision table,
// versioned and immutable once published, published through maker-checker at R4 (PL3-D-09).
// An engine error, timeout or CEL limit overrun is `UNDETERMINED`, routed to a human queue; a
// decision never defaults to allow or approve.
import { z } from "zod";
import { DataClass } from "../data-class.js";
import type { KernelContext } from "../kernel.js";
import type { Port, PortCall } from "./common.js";

/** Dotted rule-set key, e.g. `fbx.los.nba.sanction_ready`. */
export const RuleSetKey = z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/);

export const RULE_FIELD_TYPES = ["string", "number", "integer", "boolean", "date", "list"] as const;

export const RuleField = z
  .object({
    name: z.string().regex(/^[a-z][a-zA-Z0-9_]*$/),
    type: z.enum(RULE_FIELD_TYPES),
    dataClass: DataClass.default("INTERNAL"),
  })
  .strict();
export type RuleField = z.infer<typeof RuleField>;

export const RuleOutput = RuleField.extend({
  /** A statutory output may never be driven by a row still marked `verify` (Ecosystem §12.3). */
  statutory: z.boolean().default(false),
}).strict();
export type RuleOutput = z.infer<typeof RuleOutput>;

export const RuleRow = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9_.-]*$/),
    /** CEL boolean expression over the inputs. */
    when: z.string().min(1).max(4096),
    /** Output values by output name. */
    then: z.record(z.string(), z.unknown()),
    /** Help key shown by "Why this?" (IPB-07-16). */
    help_key: z.string().optional(),
    citation: z.string().optional(),
    /** `[VERIFY]` row: cannot drive a statutory output (evaluates to UNDETERMINED). */
    verify: z.boolean().default(false),
  })
  .strict();
export type RuleRow = z.infer<typeof RuleRow>;

export const RULE_PARAMETER_TYPES = ["string", "number", "integer", "boolean", "date"] as const;

/**
 * A tenant parameter of a rule set (PR-LDC-21 (a), R1-D-88): a row compares an input with it as
 * with a literal. Its value is the tenant's value of a registered setting (so a change goes
 * through settings' maker-checker and history), else `default`, bound when the table is compiled
 * for that tenant. An invalid value makes the decision UNDETERMINED.
 */
export const RuleParameter = z
  .object({
    name: z.string().regex(/^[a-z][a-zA-Z0-9_]*$/),
    type: z.enum(RULE_PARAMETER_TYPES),
    /** The registered settings key (IPB-07) that holds the tenant's value. */
    setting: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/),
    default: z.union([z.string(), z.number(), z.boolean()]),
    /** Bounds for `number` and `integer`. */
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    /** Allowed values for `string`. */
    values: z.array(z.string().min(1).max(200)).min(1).max(100).optional(),
    help_key: z.string().optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    const numeric = p.type === "number" || p.type === "integer";
    if ((p.min !== undefined || p.max !== undefined) && !numeric)
      ctx.addIssue({ code: "custom", path: ["min"], message: "bounds apply to numbers only" });
    if (p.values && p.type !== "string")
      ctx.addIssue({ code: "custom", path: ["values"], message: "values apply to strings only" });
    if (p.min !== undefined && p.max !== undefined && p.min > p.max)
      ctx.addIssue({ code: "custom", path: ["max"], message: "max is below min" });
    const err = ruleParameterValueError(p, p.default);
    if (err) ctx.addIssue({ code: "custom", path: ["default"], message: err });
  });
export type RuleParameter = z.infer<typeof RuleParameter>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Why `value` is not a valid value of the parameter, or null when it is. */
export function ruleParameterValueError(
  p: Pick<RuleParameter, "type" | "min" | "max" | "values">,
  value: unknown,
): string | null {
  switch (p.type) {
    case "boolean":
      return typeof value === "boolean" ? null : "not a boolean";
    case "string":
      if (typeof value !== "string") return "not a string";
      return p.values && !p.values.includes(value) ? "not an allowed value" : null;
    case "date":
      return typeof value === "string" &&
        ISO_DATE.test(value) &&
        new Date(`${value}T00:00:00Z`).toISOString().startsWith(value)
        ? null
        : "not a date (YYYY-MM-DD)";
    case "number":
    case "integer":
      if (typeof value !== "number" || !Number.isFinite(value)) return "not a number";
      if (p.type === "integer" && !Number.isInteger(value)) return "not an integer";
      if (p.min !== undefined && value < p.min) return `below ${p.min}`;
      if (p.max !== undefined && value > p.max) return `above ${p.max}`;
      return null;
  }
}

/** Platform decision table, the body of a rule-set version. */
export const RuleSetBody = z
  .object({
    format: z.literal("ipb.decision_table.v1"),
    hit_policy: z.enum(["first", "collect"]),
    inputs: z.array(RuleField).min(1),
    outputs: z.array(RuleOutput).min(1),
    rows: z.array(RuleRow).min(1).max(5000),
    /** Tenant parameters (R1-D-88); rows read them like inputs. */
    parameters: z.array(RuleParameter).max(50).optional(),
  })
  .strict()
  .superRefine((b, ctx) => {
    const names = new Set(b.inputs.map((i) => i.name));
    for (const [i, p] of (b.parameters ?? []).entries()) {
      if (names.has(p.name))
        ctx.addIssue({
          code: "custom",
          path: ["parameters", i, "name"],
          message: "a parameter shares its name with an input or another parameter",
        });
      names.add(p.name);
    }
    const outs = new Set(b.outputs.map((o) => o.name));
    const ids = new Set<string>();
    for (const [i, r] of b.rows.entries()) {
      if (ids.has(r.id))
        ctx.addIssue({ code: "custom", path: ["rows", i, "id"], message: "duplicate row id" });
      ids.add(r.id);
      for (const k of Object.keys(r.then))
        if (!outs.has(k))
          ctx.addIssue({ code: "custom", path: ["rows", i, "then", k], message: "unknown output" });
    }
  });
export type RuleSetBody = z.infer<typeof RuleSetBody>;

export const RULE_SET_STATES = ["draft", "pending_approval", "published", "retired"] as const;
export type RuleSetState = (typeof RULE_SET_STATES)[number];

export const DECISION_OUTCOMES = ["MATCHED", "NO_MATCH", "UNDETERMINED"] as const;
export type DecisionOutcome = (typeof DECISION_OUTCOMES)[number];

export interface RuleSetRef {
  ruleSetId: string;
  /** Pinned version; omitted means the version effective now (or at `asOf`). */
  version?: number;
  /**
   * Evaluate the version that was in force at this past instant (PR-LDC-22 (b), R1-D-88); never
   * with `version`. Parameters still take the tenant's current values.
   */
  asOf?: Date | string;
}

export interface Decision {
  /** `dcs_…` decision-log id. */
  id: string;
  outcome: DecisionOutcome;
  outputs: Record<string, unknown>;
  /** Matched row ids (one for `first`, any number for `collect`). */
  ruleIds: string[];
  ruleSetId: string;
  version: number;
  /**
   * Machine reason, e.g. `matched`, `no_row`, `engine_error`, `timeout`, `cel_limit`, `verify_row`,
   * `parameter_invalid`.
   */
  reason: string;
  /** The parameter values the decision used (R1-D-88). */
  parameters?: Record<string, unknown>;
  /** The instant whose version was evaluated, when `asOf` was given (ISO 8601). */
  asOf?: string;
}

export interface CelResult {
  ok: boolean;
  value?: unknown;
  /** `parse`, `type`, `limit`, `eval` when `ok` is false. */
  error?: "parse" | "type" | "limit" | "eval";
}

export interface RuleSetSummary {
  ruleSetId: string;
  key: string;
  ownerModule: string;
  /** The version in force now (published, or retired with its cut-over still ahead). */
  publishedVersion: number | null;
  draftVersion: number | null;
  /** A version published with a future cut-over, and that instant (PR-LDC-34). */
  scheduledVersion?: number | null;
  scheduledFrom?: string | null;
}

/** Publication options (PR-LDC-34): a future cut-over instant, carried on `RuleSetPublished`. */
export interface PublishOptions {
  /**
   * When the version comes into force: now or later, at most 366 days ahead. The product computes
   * it (for example 00:00 in the entity's time zone); the approver sees it in the request. If the
   * request is approved after this instant, the version comes into force at approval.
   */
  effectiveFrom?: Date | string;
}

export interface SimulationReport {
  runId: string;
  inputCount: number;
  /** Inputs whose outcome or outputs differ between the published and the simulated version. */
  changed: {
    index: number;
    before: DecisionOutcome;
    after: DecisionOutcome;
    rowBefore?: string;
    rowAfter?: string;
  }[];
}

export interface Explanation {
  decisionId: string;
  outcome: DecisionOutcome;
  ruleIds: string[];
  /** CEL condition of each matched row. */
  conditions: string[];
  /** Input names read; values only for INTERNAL or PUBLIC inputs. */
  inputs: { name: string; value?: unknown }[];
  help_keys: string[];
  /** Parameter values and where each came from (R1-D-88). */
  parameters?: { name: string; value: unknown; source: "setting" | "default" }[];
  /** The instant whose version was evaluated, when the decision was made with `asOf`. */
  asOf?: string;
  /** Always "rules": an AI source never produces a decision (IPB-07-16, @IPB-07-AT-11). */
  source: "rules";
}

/**
 * The RULES service runs inside tenancy, so every method takes the verified `KernelContext` first
 * (PL3-D-18). Evaluation writes the decision log through the kernel; reads are RLS-scoped.
 */
export interface RulesPort extends Port {
  evaluate(ctx: KernelContext, ref: RuleSetRef, input: unknown, call?: PortCall): Promise<Decision>;
  evaluateCel(expr: string, input: unknown, opts?: { maxAstNodes?: number }): Promise<CelResult>;
  /** The tenant's rule sets and the platform's (`tnt_platform`), RLS-scoped. */
  listRuleSets(ctx: KernelContext): Promise<RuleSetSummary[]>;
  /** Creates the R4 approval request `rules.ruleset.publish`; the version is published on execute. */
  publish(
    ctx: KernelContext,
    ruleSetId: string,
    version: number,
    opts?: PublishOptions,
  ): Promise<{ approvalId: string }>;
  simulate(
    ctx: KernelContext,
    ref: Required<Pick<RuleSetRef, "ruleSetId" | "version">>,
    inputs: unknown[],
  ): Promise<SimulationReport>;
  explain(ctx: KernelContext, decisionId: string): Promise<Explanation>;
}

/**
 * The engine binding behind the port (PL3 plan §4.2, A-01): adapters in `connectors/rules`
 * compile the platform table; the store, publish flow and decision log live in `@infrabyx/rules`.
 */
export interface RuleEngine {
  readonly name: string;
  /** `parameters` binds the body's parameters to values (default: their defaults; R1-D-88). */
  compile(
    body: RuleSetBody,
    parameters?: Readonly<Record<string, unknown>>,
  ): Promise<CompiledRuleSet>;
}

export interface CompiledRuleSet {
  evaluate(
    input: Record<string, unknown>,
    opts: { timeoutMs: number },
  ): Promise<{
    outcome: DecisionOutcome;
    outputs: Record<string, unknown>;
    ruleIds: string[];
    reason: string;
  }>;
}
