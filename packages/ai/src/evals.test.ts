// The eval harness, the regression gate and ai-prompt-lint (IPB-03-40, 03-41, 03-43; PL4 plan
// §4.7). Everything runs against the scripted fake: no provider is called (O-6).
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  gateAgainstBaseline,
  lintPrompts,
  loadEvalSet,
  parseCases,
  pipelineTarget,
  platformEvalsDir,
  runEvalSet,
  SCRIPTED_MODEL_ID,
  type EvalCase,
} from "./evals.js";
import { loadPromptFiles, parsePromptFile } from "./prompt-files.js";

const prompts = loadPromptFiles();
const grounded = prompts.find((p) => p.promptKey === "ai.grounded_answer")!;

describe("platform golden sets", () => {
  it("every platform prompt has a golden set of the required size and a passing result", async () => {
    expect(prompts.map((p) => p.promptKey)).toEqual([
      "ai.extract_fields",
      "ai.grounded_answer",
      "ai.summarise",
    ]);
    const { target, modelId } = pipelineTarget();
    for (const p of prompts) {
      const set = loadEvalSet(p.promptKey)!;
      const r = await runEvalSet({ prompt: p, cases: set.cases, target, modelId });
      expect(gateAgainstBaseline(r, set.baseline!).ok).toBe(true);
      expect(set.results.get(p.version)).toEqual(r);
    }
  });

  it("IPB-03-41: a deliberately degraded fixture fails the gate", async () => {
    const set = loadEvalSet("ai.grounded_answer")!;
    // The "model" stops citing and drops the answer for every fifth case.
    const degraded: EvalCase[] = set.cases.map((c, i) =>
      i % 5 === 0 ? { ...c, fake: { text: "Something else entirely." } } : c,
    );
    const { target, modelId } = pipelineTarget();
    const r = await runEvalSet({ prompt: grounded, cases: degraded, target, modelId });
    expect(r.score).toBeLessThan(0.9);
    expect(gateAgainstBaseline(r, set.baseline!).ok).toBe(false);
  });

  it("IPB-03-43: the model under test never judges itself; rubrics without a judge are skipped", async () => {
    const c = parseCases(
      JSON.stringify({
        id: "r1",
        input: { messages: [{ role: "user", content: "q" }] },
        fake: { text: "a" },
        expect: [{ grader: "rubric", criteria: "is polite" }],
      }),
    );
    const { target } = pipelineTarget();
    const judge = { modelId: SCRIPTED_MODEL_ID, grade: async () => true };
    await expect(
      runEvalSet({ prompt: grounded, cases: c, target, modelId: SCRIPTED_MODEL_ID, judge }),
    ).rejects.toThrow(/cannot judge itself/);
    const other = { modelId: "judge/other", grade: async () => true };
    const r = await runEvalSet({
      prompt: { ...grounded, template: "x" },
      cases: c,
      target,
      modelId: SCRIPTED_MODEL_ID,
      judge: other,
    });
    expect(r.passed).toBe(1);
    const skipped = await runEvalSet({
      prompt: { ...grounded, template: "x" },
      cases: c,
      target,
      modelId: SCRIPTED_MODEL_ID,
    });
    expect(skipped.skipped_graders).toBe(1);
  });
});

describe("prompt files", () => {
  it("refuse a variable missing from variables_schema and a bad class", () => {
    const head = (extra: string) =>
      `---\nprompt_key: x.y\nversion: 1.0.0\nowner_role: PLT_CONTENT_EDITOR\n${extra}\n---\nHello {{name}}`;
    expect(() => parsePromptFile(head("data_class_max: INTERNAL"))).toThrow(/variables_schema/);
    expect(() =>
      parsePromptFile(
        head(
          'data_class_max: TOP\nvariables_schema: {"type":"object","properties":{"name":{"type":"string"}}}',
        ),
      ),
    ).toThrow(/class/);
  });
});

describe("ai-prompt-lint (IPB-03-25, 03-40)", () => {
  it("flags a missing or small golden set and inline prompt text", () => {
    const dir = mkdtempSync(join(tmpdir(), "ipb-evals-"));
    mkdirSync(join(dir, "x.small"));
    writeFileSync(
      join(dir, "x.small", "cases.jsonl"),
      JSON.stringify({
        id: "c1",
        input: { messages: [{ role: "user", content: "q" }] },
        fake: { text: "a" },
        expect: [{ grader: "contains", value: "a" }],
      }),
    );
    const p = (key: string, cls: string) =>
      parsePromptFile(
        `---\nprompt_key: ${key}\nversion: 1.0.0\nowner_role: PLT_CONTENT_EDITOR\ndata_class_max: ${cls}\n---\nDo it.`,
        `${key}.md`,
      );
    const findings = lintPrompts({
      prompts: [p("x.none", "INTERNAL"), p("x.small", "REGULATED")],
      evalsDir: dir,
      sourceFiles: [
        {
          path: "svc.ts",
          text: 'gw.chat(ctx, { messages: [{ role: "user", content: "You are a helpful bot. Always answer in JSON." }] });',
        },
        {
          path: "ok.ts",
          text: 'gw.chat(ctx, { messages: [{ role: "user", content: question }] });',
        },
      ],
    });
    expect(findings.map((f) => f.message)).toEqual([
      "no golden set at evals/x.none/cases.jsonl",
      "golden set has 1 cases; REGULATED needs at least 100",
      "no baseline.json",
      'inline prompt text in "content:" (2 sentences); put it in the prompt registry',
    ]);
    expect(platformEvalsDir()).toMatch(/packages\/ai\/evals$/);
  });
});
