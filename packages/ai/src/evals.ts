// Evaluations (IPB-03-40 to 03-44; PL4 plan §4.7). Every platform prompt version has a golden set
// in `packages/ai/evals/<prompt_key>/cases.jsonl` (≥ 30 cases; ≥ 100 when the prompt may see
// REGULATED data), a stored baseline and a versioned result per prompt version.
//
// In CI the model is a scripted fake: each case carries the reply the fake returns, and the case
// runs through the gateway's own text pipeline (template, data blocks, scrubber, output classifier,
// token restore, schema validation). The gate therefore proves the harness, the graders, the
// guardrails and the baseline comparison, not the quality of a real model. Real-model evals call
// paid providers and run only with the owner's approval for each run (O-6): `--live` refuses to
// start without `--approved-by`.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { DataClass } from "@infrabyx/contracts/data-class";
import type { ChatMessage, DataBlock, LlmPort, LlmPortResult } from "@infrabyx/contracts";
import { z } from "zod";
import { checkOutput } from "./guard.js";
import type { PromptFile } from "./prompt-files.js";
import { renderTemplate } from "./prompts.js";
import { Scrubber } from "./scrub.js";
import { DATA_INSTRUCTION, wrapDataBlocks } from "./separation.js";

export const MIN_CASES = 30;
export const MIN_CASES_REGULATED = 100;
export const DEFAULT_TOLERANCE = 0.02;
export const SCRIPTED_MODEL_ID = "fake/scripted";

export type Grader =
  | { grader: "exact"; value: string }
  | { grader: "contains"; value: string }
  | { grader: "not_contains"; value: string }
  | { grader: "schema" }
  | { grader: "citation"; min?: number }
  | { grader: "flag"; flag: string }
  | { grader: "no_flag"; flag: string }
  | { grader: "rubric"; criteria: string };
export const GRADERS = [
  "exact",
  "contains",
  "not_contains",
  "schema",
  "citation",
  "flag",
  "no_flag",
  "rubric",
] as const;

export interface EvalCase {
  id: string;
  tags?: string[];
  input: {
    variables?: Record<string, unknown>;
    messages: ChatMessage[];
    data_blocks?: {
      kind: DataBlock["kind"];
      source_id: string;
      resource_ref?: string;
      locator?: string;
      data_class: DataClass;
      text: string;
    }[];
    data_class?: DataClass;
  };
  /** The scripted reply (CI). Written in plain text; `<PII:…>` tokens may be used. */
  fake: { text: string };
  expect: Grader[];
}

export interface EvalOutput {
  text: string;
  data?: unknown;
  /** Known source ids the answer cites. */
  citations: string[];
  /** Guard flags on the output. */
  flags: string[];
}

export type EvalTarget = (prompt: PromptFile, c: EvalCase) => Promise<EvalOutput>;

/** A rubric judge. It must not be the model under test (IPB-03-43). */
export interface Judge {
  modelId: string;
  grade(criteria: string, output: EvalOutput, c: EvalCase): Promise<boolean>;
}

export interface EvalReport {
  prompt_key: string;
  version: string;
  content_sha256: string;
  model: string;
  live: boolean;
  total: number;
  passed: number;
  score: number;
  skipped_graders: number;
  failures: { id: string; grader: string; reason: string }[];
}

export interface Baseline {
  score: number;
  tolerance?: number;
}

/** `packages/ai/evals`. */
export const platformEvalsDir = (): string =>
  join(dirname(fileURLToPath(import.meta.url)), "..", "evals");

const toBlocks = (c: EvalCase): DataBlock[] =>
  (c.input.data_blocks ?? []).map((b) => ({
    kind: b.kind,
    sourceId: b.source_id,
    ...(b.resource_ref ? { resourceRef: b.resource_ref } : {}),
    ...(b.locator ? { locator: b.locator } : {}),
    dataClass: b.data_class,
    text: b.text,
  }));

/**
 * Runs a case through the gateway's text pipeline against `port` (default: a scripted fake that
 * returns `case.fake.text`). Nothing here reaches a network unless the caller passes a real port.
 */
export function pipelineTarget(o: { port?: LlmPort; model?: string; scrubber?: Scrubber } = {}): {
  modelId: string;
  target: EvalTarget;
} {
  const scrubber = o.scrubber ?? new Scrubber();
  const modelId = o.port
    ? `${o.port.descriptor.adapterKey}/${o.model ?? "model"}`
    : SCRIPTED_MODEL_ID;
  const target: EvalTarget = async (prompt, c) => {
    const blocks = toBlocks(c);
    let system = renderTemplate(prompt.template, c.input.variables ?? {});
    const messages = [...c.input.messages];
    if (blocks.length) {
      const w = wrapDataBlocks(blocks);
      const first = messages[0];
      if (first?.role === "user")
        messages[0] = { role: "user", content: `${w.text}\n\n${first.content}` };
      else messages.unshift({ role: "user", content: w.text });
      system = `${system}\n\n${DATA_INSTRUCTION}`;
    }
    const session = scrubber.session();
    system = session.scrub(system);
    const sent = messages.map((m) => ({ role: m.role, content: session.scrub(m.content) }));
    let res: Pick<LlmPortResult, "text">;
    if (o.port)
      res = await o.port.chat({
        model: o.model ?? "model",
        system,
        messages: sent,
        ...(prompt.outputSchema ? { schema: prompt.outputSchema } : {}),
        maxOutputTokens: 1024,
        timeoutMs: 60_000,
      });
    else res = { text: c.fake.text };
    const out = checkOutput(res.text, {
      scrubber,
      systemPrompt: system,
      sourceIds: blocks.length ? new Set(blocks.map((b) => b.sourceId)) : null,
      policy: "redact",
    });
    const text = session.restore(out.text);
    let data: unknown;
    if (prompt.outputSchema) {
      try {
        const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
        data = JSON.parse((fenced ? fenced[1] : text) ?? "");
      } catch {
        data = undefined;
      }
    }
    return {
      text,
      ...(data !== undefined ? { data } : {}),
      citations: out.cited,
      flags: out.flags,
    };
  };
  return { modelId, target };
}

async function grade(
  g: Grader,
  out: EvalOutput,
  prompt: PromptFile,
  c: EvalCase,
  judge: Judge | undefined,
): Promise<{ ok: boolean | null; reason: string }> {
  const lower = out.text.toLowerCase();
  switch (g.grader) {
    case "exact":
      return { ok: out.text.trim() === g.value.trim(), reason: "text differs" };
    case "contains":
      return { ok: lower.includes(g.value.toLowerCase()), reason: `missing "${g.value}"` };
    case "not_contains":
      return { ok: !lower.includes(g.value.toLowerCase()), reason: `contains "${g.value}"` };
    case "schema": {
      if (!prompt.outputSchema) return { ok: false, reason: "the prompt has no output_schema" };
      const v = z
        .fromJSONSchema(prompt.outputSchema as Parameters<typeof z.fromJSONSchema>[0])
        .safeParse(out.data);
      return { ok: out.data !== undefined && v.success, reason: "output fails the schema" };
    }
    case "citation":
      return {
        ok: out.citations.length >= (g.min ?? 1) && !out.flags.includes("citation_unknown"),
        reason: "missing or unknown citations",
      };
    case "flag":
      return { ok: out.flags.includes(g.flag), reason: `flag ${g.flag} not raised` };
    case "no_flag":
      return { ok: !out.flags.includes(g.flag), reason: `flag ${g.flag} raised` };
    case "rubric":
      if (!judge) return { ok: null, reason: "no judge configured" };
      return { ok: await judge.grade(g.criteria, out, c), reason: "rubric not met" };
  }
}

export async function runEvalSet(o: {
  prompt: PromptFile;
  cases: readonly EvalCase[];
  target: EvalTarget;
  modelId: string;
  live?: boolean;
  judge?: Judge;
}): Promise<EvalReport> {
  if (o.judge && o.judge.modelId === o.modelId)
    throw new Error(`IPB-03-43: ${o.modelId} cannot judge itself`);
  const failures: EvalReport["failures"] = [];
  let passed = 0;
  let skipped = 0;
  for (const c of o.cases) {
    const out = await o.target(o.prompt, c);
    let ok = true;
    for (const g of c.expect) {
      const r = await grade(g, out, o.prompt, c, o.judge);
      if (r.ok === null) skipped++;
      else if (!r.ok) {
        ok = false;
        failures.push({ id: c.id, grader: g.grader, reason: r.reason });
      }
    }
    if (ok) passed++;
  }
  const total = o.cases.length;
  return {
    prompt_key: o.prompt.promptKey,
    version: o.prompt.version,
    content_sha256: o.prompt.contentSha256,
    model: o.modelId,
    live: o.live ?? false,
    total,
    passed,
    score: total ? Math.round((passed / total) * 10_000) / 10_000 : 0,
    skipped_graders: skipped,
    failures,
  };
}

/** The regression gate (IPB-03-41): the score may not fall below the baseline minus tolerance. */
export function gateAgainstBaseline(r: EvalReport, b: Baseline): { ok: boolean; floor: number } {
  const floor = Math.round((b.score - (b.tolerance ?? DEFAULT_TOLERANCE)) * 10_000) / 10_000;
  return { ok: r.score >= floor, floor };
}

const CaseSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9_.-]{0,63}$/),
    tags: z.array(z.string()).optional(),
    input: z
      .object({
        variables: z.record(z.string(), z.unknown()).optional(),
        messages: z.array(
          z.object({ role: z.enum(["user", "assistant"]), content: z.string() }).strict(),
        ),
        data_blocks: z
          .array(
            z
              .object({
                kind: z.enum(["document", "retrieved", "web", "email", "tool_result", "record"]),
                source_id: z.string().min(1),
                resource_ref: z.string().optional(),
                locator: z.string().optional(),
                data_class: z.enum(["PUBLIC", "INTERNAL", "CONFIDENTIAL", "REGULATED", "SECRET"]),
                text: z.string(),
              })
              .strict(),
          )
          .optional(),
        data_class: z
          .enum(["PUBLIC", "INTERNAL", "CONFIDENTIAL", "REGULATED", "SECRET"])
          .optional(),
      })
      .strict(),
    fake: z.object({ text: z.string() }).strict(),
    expect: z
      .array(
        z.discriminatedUnion("grader", [
          z.object({ grader: z.literal("exact"), value: z.string() }).strict(),
          z.object({ grader: z.literal("contains"), value: z.string().min(1) }).strict(),
          z.object({ grader: z.literal("not_contains"), value: z.string().min(1) }).strict(),
          z.object({ grader: z.literal("schema") }).strict(),
          z
            .object({ grader: z.literal("citation"), min: z.number().int().min(0).optional() })
            .strict(),
          z.object({ grader: z.literal("flag"), flag: z.string() }).strict(),
          z.object({ grader: z.literal("no_flag"), flag: z.string() }).strict(),
          z.object({ grader: z.literal("rubric"), criteria: z.string().min(1) }).strict(),
        ]),
      )
      .min(1),
  })
  .strict();

/** Parse a `cases.jsonl`; every line must be a valid case with a unique id. */
export function parseCases(text: string, path = "<cases>"): EvalCase[] {
  const out: EvalCase[] = [];
  const ids = new Set<string>();
  text.split("\n").forEach((line, i) => {
    if (!line.trim()) return;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      throw new Error(`${path}:${i + 1}: not JSON`);
    }
    const r = CaseSchema.safeParse(raw);
    if (!r.success) throw new Error(`${path}:${i + 1}: ${r.error.issues[0]?.message ?? "invalid"}`);
    if (ids.has(r.data.id)) throw new Error(`${path}:${i + 1}: duplicate id ${r.data.id}`);
    ids.add(r.data.id);
    out.push(r.data as EvalCase);
  });
  return out;
}

export interface EvalSetFiles {
  cases: EvalCase[];
  baseline: Baseline | null;
  /** The committed result for each version (`results/<version>.json`). */
  results: Map<string, EvalReport>;
}

export function loadEvalSet(promptKey: string, dir = platformEvalsDir()): EvalSetFiles | null {
  const base = join(dir, promptKey);
  if (!existsSync(join(base, "cases.jsonl"))) return null;
  const cases = parseCases(
    readFileSync(join(base, "cases.jsonl"), "utf8"),
    join(base, "cases.jsonl"),
  );
  const baseline = existsSync(join(base, "baseline.json"))
    ? (JSON.parse(readFileSync(join(base, "baseline.json"), "utf8")) as Baseline)
    : null;
  const results = new Map<string, EvalReport>();
  if (existsSync(join(base, "results")))
    for (const f of readdirSync(join(base, "results")).filter((x) => x.endsWith(".json")))
      results.set(
        f.replace(/\.json$/, ""),
        JSON.parse(readFileSync(join(base, "results", f), "utf8")) as EvalReport,
      );
  return { cases, baseline, results };
}

/** The stable form of a report written to `results/<version>.json`. */
export const reportFile = (r: EvalReport): string => `${JSON.stringify(r, null, 2)}\n`;

export interface LintFinding {
  file: string;
  message: string;
}

/**
 * `ai-prompt-lint` (IPB-03-25, 03-40): every prompt has a golden set of the required size with a
 * baseline; and no source file passes a prompt as a string literal of more than one sentence
 * (prompt text lives in the prompt registry, never inline).
 */
export function lintPrompts(o: {
  prompts: readonly PromptFile[];
  evalsDir: string;
  sourceFiles: readonly { path: string; text: string }[];
  root?: string;
}): LintFinding[] {
  const f: LintFinding[] = [];
  const rel = (p: string) => (o.root ? relative(o.root, p) : p);
  for (const p of o.prompts) {
    if (p.evalSetRef !== `evals/${p.promptKey}`)
      f.push({ file: rel(p.path), message: `eval_set_ref must be evals/${p.promptKey}` });
    let set: EvalSetFiles | null;
    try {
      set = loadEvalSet(p.promptKey, o.evalsDir);
    } catch (e) {
      f.push({ file: rel(p.path), message: (e as Error).message });
      continue;
    }
    if (!set) {
      f.push({ file: rel(p.path), message: `no golden set at evals/${p.promptKey}/cases.jsonl` });
      continue;
    }
    const min =
      p.dataClassMax === "REGULATED" || p.dataClassMax === "SECRET"
        ? MIN_CASES_REGULATED
        : MIN_CASES;
    if (set.cases.length < min)
      f.push({
        file: rel(p.path),
        message: `golden set has ${set.cases.length} cases; ${p.dataClassMax} needs at least ${min}`,
      });
    if (!set.baseline) f.push({ file: rel(p.path), message: "no baseline.json" });
    if (!p.outputSchema && set.cases.some((c) => c.expect.some((g) => g.grader === "schema")))
      f.push({ file: rel(p.path), message: "schema grader without an output_schema" });
  }
  const LITERAL = /\b(content|system|prompt|instructions)\s*:\s*(["'`])((?:\\.|(?!\2)[\s\S])*)\2/g;
  for (const s of o.sourceFiles)
    for (const m of s.text.matchAll(LITERAL)) {
      const lit = m[3] ?? "";
      const sentences = lit.split(/(?<=[.!?])\s+(?=[A-Z])/).filter((x) => x.trim()).length;
      if (sentences > 1 || lit.length > 240)
        f.push({
          file: rel(s.path),
          message: `inline prompt text in "${m[1]}:" (${sentences} sentences); put it in the prompt registry`,
        });
    }
  return f;
}
