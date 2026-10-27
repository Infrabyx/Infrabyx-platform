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

/** Platform decision table, the body of a rule-set version. */
export const RuleSetBody = z
  .object({
    format: z.literal("ipb.decision_table.v1"),
    hit_policy: z.enum(["first", "collect"]),
    inputs: z.array(RuleField).min(1),
    outputs: z.array(RuleOutput).min(1),
    rows: z.array(RuleRow).min(1).max(5000),
  })
  .strict()
  .superRefine((b, ctx) => {
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
  /** Pinned version; omitted means the version effective now. */
  version?: number;
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
  /** Machine reason, e.g. `matched`, `no_row`, `engine_error`, `timeout`, `cel_limit`, `verify_row`. */
  reason: string;
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
  publishedVersion: number | null;
  draftVersion: number | null;
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
  publish(ctx: KernelContext, ruleSetId: string, version: number): Promise<{ approvalId: string }>;
  simulate(
    ctx: KernelContext,
    ref: Required<RuleSetRef>,
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
  compile(body: RuleSetBody): Promise<CompiledRuleSet>;
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
