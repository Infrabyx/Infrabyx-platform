// Shared table handling for the RULES engine adapters (PL3 plan §4.2): input validation, row
// lowering, output assembly and the time limit. Engines decide only which rows match; outputs are
// always assembled here from the platform table, so no engine ever prints an output literal.
import type {
  AdapterDescriptor,
  CompiledRuleSet,
  DecisionOutcome,
  PortHealth,
  RuleEngine,
  RuleField,
  RuleSetBody,
} from "@infrabyx/contracts/ports";
import { RuleSetBody as RuleSetBodySchema } from "@infrabyx/contracts/ports";
import {
  celEnvironment,
  DEFAULT_CEL_LIMITS,
  isValidDate,
  lowerWhen,
  RESERVED_FIELD_NAMES,
  RuleCompileError,
  type CelLimits,
  type Cond,
} from "./cel.js";

/** Largest accepted input, as JSON (bounds evaluation time with the CEL limits, PL3-D-15). */
export const MAX_INPUT_BYTES = 64 * 1024;
const MAX_LIST_INPUT = 1000;
const MAX_STRING_INPUT = 4096;

export interface PreparedRow {
  index: number;
  id: string;
  when: string;
  cond: Cond;
}

export interface PreparedTable {
  body: RuleSetBody;
  fields: ReadonlyMap<string, RuleField>;
  rows: readonly PreparedRow[];
  limits: CelLimits;
}

export type EvalResult = Awaited<ReturnType<CompiledRuleSet["evaluate"]>>;

/** Validate the body and lower every row; throws `RuleCompileError` on the first refusal. */
export function prepareTable(
  raw: RuleSetBody,
  limits: CelLimits = DEFAULT_CEL_LIMITS,
): PreparedTable {
  const parsed = RuleSetBodySchema.safeParse(raw);
  if (!parsed.success)
    throw new RuleCompileError(null, "schema", parsed.error.issues[0]?.message ?? "invalid body");
  const body = parsed.data;
  const fields = new Map<string, RuleField>();
  for (const f of body.inputs) {
    if (RESERVED_FIELD_NAMES.has(f.name))
      throw new RuleCompileError(null, "reserved_name", `input name ${f.name} is reserved`);
    if (fields.has(f.name))
      throw new RuleCompileError(null, "duplicate_input", `duplicate input ${f.name}`);
    fields.set(f.name, f);
  }
  const env = celEnvironment(body.inputs, limits);
  const rows = body.rows.map((r, index) => ({
    index,
    id: r.id,
    when: r.when,
    cond: lowerWhen(r.id, r.when, fields, env),
  }));
  return { body, fields, rows, limits };
}

export type InputCheck =
  { ok: true; values: Record<string, unknown> } | { ok: false; detail: string };

/**
 * Every declared input must be present with its declared type, and nothing else may be sent: ZEN
 * reads a missing input as false without an error, so the input is checked before any engine runs.
 */
export function checkRuleInput(t: Pick<PreparedTable, "fields">, input: unknown): InputCheck {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return { ok: false, detail: "input must be an object" };
  let size: number;
  try {
    size = Buffer.byteLength(JSON.stringify(input));
  } catch {
    return { ok: false, detail: "input is not JSON" };
  }
  if (size > MAX_INPUT_BYTES) return { ok: false, detail: "input too large" };
  const rec = input as Record<string, unknown>;
  for (const k of Object.keys(rec))
    if (!t.fields.has(k)) return { ok: false, detail: `undeclared input ${k}` };
  const values: Record<string, unknown> = {};
  for (const f of t.fields.values()) {
    const v = rec[f.name];
    if (!typeOk(f, v)) return { ok: false, detail: `input ${f.name} is not a valid ${f.type}` };
    values[f.name] = v;
  }
  return { ok: true, values };
}

function typeOk(f: RuleField, v: unknown): boolean {
  switch (f.type) {
    case "string":
      return typeof v === "string" && v.length <= MAX_STRING_INPUT;
    case "number":
      return typeof v === "number" && Number.isFinite(v);
    case "integer":
      return typeof v === "number" && Number.isSafeInteger(v);
    case "boolean":
      return typeof v === "boolean";
    case "date":
      return typeof v === "string" && isValidDate(v);
    case "list":
      return (
        Array.isArray(v) &&
        v.length <= MAX_LIST_INPUT &&
        v.every(
          (x) =>
            (typeof x === "string" && x.length <= MAX_STRING_INPUT) ||
            (typeof x === "number" && Number.isFinite(x)),
        )
      );
  }
}

/** Outputs from the matched rows (indexes in any order): `first` takes the lowest, `collect` all. */
export function assemble(t: PreparedTable, matched: readonly number[]): EvalResult {
  const idx = [...new Set(matched)].sort((a, b) => a - b);
  if (idx.length === 0) return { outcome: "NO_MATCH", outputs: {}, ruleIds: [], reason: "no_row" };
  const rows = t.body.rows;
  if (t.body.hit_policy === "first") {
    const r = rows[idx[0] as number];
    if (!r) return undetermined("engine_error");
    return { outcome: "MATCHED", outputs: { ...r.then }, ruleIds: [r.id], reason: "matched" };
  }
  const outputs: Record<string, unknown[]> = {};
  const ruleIds: string[] = [];
  for (const i of idx) {
    const r = rows[i];
    if (!r) return undetermined("engine_error");
    ruleIds.push(r.id);
    for (const [k, v] of Object.entries(r.then)) (outputs[k] ??= []).push(v);
  }
  return { outcome: "MATCHED", outputs, ruleIds, reason: "matched" };
}

export const undetermined = (reason: string): EvalResult => ({
  outcome: "UNDETERMINED" as DecisionOutcome,
  outputs: {},
  ruleIds: [],
  reason,
});

/**
 * Run an engine's match step under the input check and the time limit. Any engine error or
 * timeout is `UNDETERMINED`: a decision never defaults to allow (IPB-01 RULES).
 */
export function compiled(
  t: PreparedTable,
  match: (values: Record<string, unknown>) => Promise<number[]> | number[],
): CompiledRuleSet {
  return {
    async evaluate(input, { timeoutMs }) {
      const c = checkRuleInput(t, input);
      if (!c.ok) return undetermined("input_invalid");
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), Math.max(1, timeoutMs));
      });
      try {
        const r = await Promise.race([Promise.resolve().then(() => match(c.values)), timeout]);
        if (r === "timeout") return undetermined("timeout");
        return assemble(t, r);
      } catch {
        return undetermined("engine_error");
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** The table every adapter evaluates for its health check (PL3 plan §4.4, "Health"). */
export const CANARY_TABLE: RuleSetBody = {
  format: "ipb.decision_table.v1",
  hit_policy: "first",
  inputs: [
    { name: "amount", type: "integer", dataClass: "INTERNAL" },
    { name: "segment", type: "string", dataClass: "INTERNAL" },
  ],
  outputs: [{ name: "band", type: "string", dataClass: "INTERNAL", statutory: false }],
  rows: [
    {
      id: "high",
      when: 'amount >= 100000 && segment in ["retail", "msme"]',
      then: { band: "high" },
      verify: false,
    },
    { id: "other", when: "true", then: { band: "standard" }, verify: false },
  ],
};

/** Base for the in-process engine adapters: descriptor, canary health, prepare then compile. */
export abstract class InProcessRuleEngine implements RuleEngine {
  abstract readonly name: string;
  readonly limits: CelLimits;
  constructor(opts: { limits?: CelLimits } = {}) {
    this.limits = opts.limits ?? DEFAULT_CEL_LIMITS;
  }

  get descriptor(): AdapterDescriptor {
    // In process: data never leaves the service, so the adapter accepts what the service may
    // hold. SECRET never enters a rule input (IPB-02 §02.2).
    return { port: "RULES", adapter: this.name, residency: "IN", maxDataClass: "REGULATED" };
  }

  async compile(body: RuleSetBody): Promise<CompiledRuleSet> {
    return this.compilePrepared(prepareTable(body, this.limits));
  }

  protected abstract compilePrepared(t: PreparedTable): Promise<CompiledRuleSet>;

  async health(): Promise<PortHealth> {
    const started = performance.now();
    let status: PortHealth["status"];
    try {
      const c = await this.compile(CANARY_TABLE);
      const [a, b] = await Promise.all([
        c.evaluate({ amount: 150000, segment: "msme" }, { timeoutMs: 1000 }),
        c.evaluate({ amount: 10, segment: "retail" }, { timeoutMs: 1000 }),
      ]);
      status = a.ruleIds[0] === "high" && b.ruleIds[0] === "other" ? "up" : "degraded";
    } catch {
      status = "down";
    }
    return {
      status,
      latency_ms: Math.round(performance.now() - started),
      checked_at: new Date().toISOString(),
    };
  }
}
