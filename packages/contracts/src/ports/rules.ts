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
export type RuleParameterType = (typeof RULE_PARAMETER_TYPES)[number];

/** A parameter's type and bounds: what a value of it is checked against. */
export interface ParameterBounds {
  type: RuleParameterType;
  min?: number | undefined;
  max?: number | undefined;
  values?: readonly string[] | undefined;
}

/** Dotted lower-case key of a setting or a parameter schedule, e.g. `stat.companies.audit_threshold`. */
const DOTTED_KEY = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;

const parameterShape = {
  name: z.string().regex(/^[a-z][a-zA-Z0-9_]*$/),
  type: z.enum(RULE_PARAMETER_TYPES),
  /** Bounds for `number` and `integer`. */
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  /** Allowed values for `string`. */
  values: z.array(z.string().min(1).max(200)).min(1).max(100).optional(),
  help_key: z.string().optional(),
};

function checkParameterShape(p: ParameterBounds, ctx: z.RefinementCtx): void {
  const numeric = p.type === "number" || p.type === "integer";
  if ((p.min !== undefined || p.max !== undefined) && !numeric)
    ctx.addIssue({ code: "custom", path: ["min"], message: "bounds apply to numbers only" });
  if (p.values && p.type !== "string")
    ctx.addIssue({ code: "custom", path: ["values"], message: "values apply to strings only" });
  if (p.min !== undefined && p.max !== undefined && p.min > p.max)
    ctx.addIssue({ code: "custom", path: ["max"], message: "max is below min" });
}

/**
 * A tenant parameter of a rule set (PR-LDC-21 (a), R1-D-88): a row compares an input with it as
 * with a literal. Its value is the tenant's value of a registered setting (so a change goes
 * through settings' maker-checker and history), else `default`, bound when the table is compiled
 * for that tenant. An invalid value makes the decision UNDETERMINED.
 */
export const SettingRuleParameter = z
  .object({
    ...parameterShape,
    /** The registered settings key (IPB-07) that holds the tenant's value. */
    setting: z.string().regex(DOTTED_KEY),
    default: z.union([z.string(), z.number(), z.boolean()]),
  })
  .strict()
  .superRefine((p, ctx) => {
    checkParameterShape(p, ctx);
    const err = ruleParameterValueError(p, p.default);
    if (err) ctx.addIssue({ code: "custom", path: ["default"], message: err });
  });
export type SettingRuleParameter = z.infer<typeof SettingRuleParameter>;

/**
 * A dated parameter (PR-LDC-57, R1-D-146, R1-D-175): its value is the entry in force at the
 * decision's instant of a platform-owned, versioned and cited parameter schedule. It is locked:
 * no setting overrides it and it has no default, so a decision with no entry in force is
 * UNDETERMINED (`parameter_not_in_force`), never decided on a guess.
 */
export const ScheduleRuleParameter = z
  .object({
    ...parameterShape,
    /** The parameter schedule's key (published in `tnt_platform`). */
    schedule: z.string().regex(DOTTED_KEY),
  })
  .strict()
  .superRefine((p, ctx) => checkParameterShape(p, ctx));
export type ScheduleRuleParameter = z.infer<typeof ScheduleRuleParameter>;

export const RuleParameter = z.union([SettingRuleParameter, ScheduleRuleParameter]);
export type RuleParameter = z.infer<typeof RuleParameter>;

/** Whether a parameter is dated (takes its value from a parameter schedule). */
export function isScheduleParameter(p: RuleParameter): p is ScheduleRuleParameter {
  return "schedule" in p && typeof p.schedule === "string";
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Why `value` is not a valid value of the parameter, or null when it is. */
export function ruleParameterValueError(p: ParameterBounds, value: unknown): string | null {
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

/** Most entries one parameter schedule version may hold (PR-LDC-57 plan §2). */
export const PARAMETER_SCHEDULE_MAX_ENTRIES = 500;

const PRINTABLE = (min: number, max: number) =>
  z
    .string()
    .min(min)
    .max(max)
    .refine((v) => v.trim().length >= min && !/\p{Cc}/u.test(v), "printable characters only");

/** Where a dated value comes from: the instrument's own reference and section (PR-LDC-57). */
export const ParameterCitation = z
  .object({
    /** The instrument's own reference (a statute, regulation, circular or notification). */
    instrumentRef: PRINTABLE(1, 128),
    section: PRINTABLE(1, 64),
    /** The published text, https only. */
    url: z
      .string()
      .max(2048)
      .refine((u) => {
        try {
          return new URL(u).protocol === "https:";
        } catch {
          return false;
        }
      }, "url must be https")
      .optional(),
  })
  .strict();
export type ParameterCitation = z.infer<typeof ParameterCitation>;

export const ParameterScheduleEntry = z
  .object({
    value: z.union([z.string(), z.number(), z.boolean()]),
    /**
     * The first calendar day the value is in force (YYYY-MM-DD), compared with the decision's day
     * in Asia/Kolkata (R1-D-175). It stays in force until the next entry's `effectiveFrom`; the
     * last entry is open-ended.
     */
    effectiveFrom: z.string(),
    citation: ParameterCitation,
  })
  .strict();
export type ParameterScheduleEntry = z.infer<typeof ParameterScheduleEntry>;

/**
 * The body of a parameter schedule version (PR-LDC-57, R1-D-175): a platform-owned list of dated,
 * cited values, entered and approved by people and never fetched. Published through
 * `rules.ruleset.publish` (R4) and immutable once published; a correction is a new version with
 * its `reason`.
 */
export const ParameterScheduleBody = z
  .object({
    format: z.literal("ipb.parameter_schedule.v1"),
    /** Every entry's value has this type; a rule parameter naming the schedule has it too. */
    type: z.enum(RULE_PARAMETER_TYPES),
    entries: z.array(ParameterScheduleEntry).min(1).max(PARAMETER_SCHEDULE_MAX_ENTRIES),
    /** Why this version replaces the previous one; required from version 2 on. */
    reason: PRINTABLE(3, 500).optional(),
  })
  .strict()
  .superRefine((b, ctx) => {
    let prev: string | null = null;
    for (const [i, e] of b.entries.entries()) {
      if (ruleParameterValueError({ type: "date" }, e.effectiveFrom))
        ctx.addIssue({
          code: "custom",
          path: ["entries", i, "effectiveFrom"],
          message: "not a date (YYYY-MM-DD)",
        });
      else if (prev !== null && e.effectiveFrom <= prev)
        ctx.addIssue({
          code: "custom",
          path: ["entries", i, "effectiveFrom"],
          message: "entries must be in strictly ascending effectiveFrom order, without overlap",
        });
      else prev = e.effectiveFrom;
      const err = ruleParameterValueError({ type: b.type }, e.value);
      if (err) ctx.addIssue({ code: "custom", path: ["entries", i, "value"], message: err });
    }
  });
export type ParameterScheduleBody = z.infer<typeof ParameterScheduleBody>;

/** The schedule entry a dated parameter took, as recorded in the decision log and `explain`. */
export interface ScheduleCitationTrace {
  key: string;
  version: number;
  /** The entry's first day in force (YYYY-MM-DD). */
  effectiveFrom: string;
  citation: ParameterCitation;
}

export interface ParameterScheduleSummary {
  key: string;
  /** The version in force now (published, or retired with its cut-over still ahead). */
  publishedVersion: number | null;
  draftVersion: number | null;
  /** A version published with a future cut-over, and that instant. */
  scheduledVersion: number | null;
  scheduledFrom: string | null;
}

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
   * with `version`. Setting-backed parameters still take the tenant's current values; a dated
   * parameter takes the schedule entry in force at this instant (PR-LDC-57).
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
   * `parameter_invalid`, `parameter_not_in_force` (a dated parameter has no entry in force).
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
  /**
   * Input names read; values only for INTERNAL or PUBLIC inputs, and for the one CONFIDENTIAL input
   * an entitled reveal names (`revealed: true`; PR-LDC-59, R1-D-173).
   */
  inputs: { name: string; value?: unknown; revealed?: true }[];
  help_keys: string[];
  /**
   * Parameter values and where each came from (R1-D-88): a dated parameter (`source: "schedule"`)
   * also cites the schedule version and entry it took (PR-LDC-57).
   */
  parameters?: {
    name: string;
    value: unknown;
    source: "setting" | "default" | "schedule";
    schedule?: ScheduleCitationTrace;
  }[];
  /** The instant whose version was evaluated, when the decision was made with `asOf`. */
  asOf?: string;
  /** Always "rules": an AI source never produces a decision (IPB-07-16, @IPB-07-AT-11). */
  source: "rules";
}

/** Purpose of a reveal: 3 to 200 printable characters, recorded in the ledger (R1-D-173). */
export const REVEAL_PURPOSE_MIN = 3;
export const REVEAL_PURPOSE_MAX = 200;
/** How long a reveal grant stays usable, in milliseconds (R1-D-173, single use). */
export const REVEAL_GRANT_TTL_MS = 60_000;

/** A request to see one CONFIDENTIAL input of one decision (PR-LDC-59, #130, R1-D-157 (1)). */
export interface RevealRequest {
  decisionId: string;
  /** The input's name, as declared in the decision's rule set version. */
  input: string;
  /** Why the value is needed, for the ledger (never personal data). */
  purpose: string;
}

declare const revealEntitlementBrand: unique symbol;
/**
 * An opaque, single-use grant from `entitleReveal`, valid for 60 seconds, for the principal that
 * asked, in its tenant, for one input of one decision. It is an in-process object: a copy, a
 * serialised form or a look-alike is refused, and so is a grant from another service instance.
 */
export interface RevealEntitlement {
  readonly [revealEntitlementBrand]: true;
  /** `rvg_…`, recorded in the ledger entry of the reveal. */
  readonly id: string;
  readonly decisionId: string;
  readonly input: string;
  /** ISO 8601 instant after which the grant is refused. */
  readonly expiresAt: string;
}

export interface ExplainOptions {
  /** Return the value of the one CONFIDENTIAL input this grant names; ledgered (R1-D-173). */
  reveal?: RevealEntitlement;
}

/** Why `entitleReveal` or `explain` refused a reveal (`IPB-RULE-004` `meta.reason`). */
export const REVEAL_REFUSALS = [
  "no_reveal_rule",
  "context_not_allowed",
  "decision_not_found",
  "unknown_input",
  "class_not_revealable",
  "inputs_not_recorded",
  "purpose_invalid",
  "rule_refused",
  "grant_invalid",
  "grant_expired",
  "grant_used",
  "grant_mismatch",
] as const;
export type RevealRefusal = (typeof REVEAL_REFUSALS)[number];

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
  explain(ctx: KernelContext, decisionId: string, opts?: ExplainOptions): Promise<Explanation>;
  /**
   * Ask the product's reveal rule for a grant to see one CONFIDENTIAL input of one decision
   * (PR-LDC-59, R1-D-173). Optional: an implementation without it never reveals a value.
   */
  entitleReveal?(ctx: KernelContext, req: RevealRequest): Promise<RevealEntitlement>;
}

/**
 * The engine binding behind the port (PL3 plan §4.2, A-01): adapters in `connectors/rules`
 * compile the platform table; the store, publish flow and decision log live in `@infrabyx/rules`.
 */
export interface RuleEngine {
  readonly name: string;
  /**
   * `parameters` binds the body's parameters to values (default: their defaults; R1-D-88). A dated
   * parameter has no default, so it must be bound (PR-LDC-57).
   */
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
