// RULES engine adapters (PL3 plan §4.2): the differential test (zen, json-rules and the CEL walk
// agree on generated inputs), health, fault handling and the CEL size limit.
import { afterAll, describe, expect, it } from "vitest";
import type { RuleSetBody } from "@infrabyx/contracts/ports";
import { fixtureInput, RULES_FIXTURE } from "@infrabyx/testing";
import {
  compiled,
  JsonRulesEngine,
  MemoryRuleEngine,
  prepareTable,
  ruleEngine,
  RULE_ENGINES,
  ZenRuleEngine,
  type RuleEngineName,
} from "../index.js";

const zen = new ZenRuleEngine();
afterAll(() => zen.dispose());
const engines: Record<RuleEngineName, () => ZenRuleEngine | JsonRulesEngine | MemoryRuleEngine> = {
  zen: () => zen,
  "json-rules": () => new JsonRulesEngine(),
  memory: () => new MemoryRuleEngine(),
};

// A deterministic pseudo-random generator, so a failure names a reproducible case.
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("RULES differential: zen, json-rules and the CEL walk agree (PL3 plan §4.2)", () => {
  const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
  const inputs = (() => {
    const r = rng(20261027);
    const out: Record<string, unknown>[] = [];
    for (let i = 0; i < 600; i++)
      out.push(
        fixtureInput({
          segment: pick(r, ["retail", "msme", "sme", "corp", ""]),
          amount: pick(r, [-1, 0, 9999, 10000, 499999, 500000, 500001, Math.floor(r() * 2e6)]),
          score: pick(r, [0, 0.4, 0.4000001, 0.75, 0.7500001, 1, r()]),
          kycDone: r() > 0.15,
          sanctionedOn: pick(r, [
            "2026-03-31",
            "2026-04-01",
            "2026-04-02",
            "2025-12-31",
            "2027-01-01",
          ]),
          flags: pick(r, [[], ["fraud"], [7], [7.5], ["x", 7], ["fraud", 7]]),
        }),
      );
    return out;
  })();

  for (const policy of ["first", "collect"] as const) {
    it(`gives the same decision for 600 generated inputs (${policy})`, async () => {
      const body: RuleSetBody = { ...RULES_FIXTURE, hit_policy: policy };
      const compiled = await Promise.all(RULE_ENGINES.map((n) => engines[n]().compile(body)));
      const seen = new Set<string>();
      for (const input of inputs) {
        const [a, ...rest] = await Promise.all(
          compiled.map((c) => c.evaluate(input, { timeoutMs: 2000 })),
        );
        for (const [i, b] of rest.entries())
          expect(b, `${RULE_ENGINES[i + 1]} vs zen for ${JSON.stringify(input)}`).toEqual(a);
        seen.add((a?.ruleIds ?? []).join(","));
      }
      // The generator reaches every row except the constant-false one.
      const rows = new Set([...seen].flatMap((s) => s.split(",")));
      for (const r of RULES_FIXTURE.rows.filter((x) => x.id !== "never"))
        expect(rows.has(r.id), r.id).toBe(true);
    });
  }
});

describe("RULES engine adapters", () => {
  it("map rules.engine names to adapters and report health from the canary table", async () => {
    for (const n of RULE_ENGINES) {
      const e = n === "zen" ? zen : ruleEngine(n);
      expect(e.descriptor).toMatchObject({ port: "RULES", adapter: n, residency: "IN" });
      expect((await e.health()).status).toBe("up");
    }
  });
  it("an engine error or timeout is UNDETERMINED, never a match", async () => {
    const t = prepareTable(RULES_FIXTURE);
    const throwing = compiled(t, () => {
      throw new Error("engine fault");
    });
    const hanging = compiled(t, () => new Promise<number[]>(() => undefined));
    expect(await throwing.evaluate(fixtureInput(), { timeoutMs: 50 })).toMatchObject({
      outcome: "UNDETERMINED",
      reason: "engine_error",
    });
    expect(await hanging.evaluate(fixtureInput(), { timeoutMs: 20 })).toMatchObject({
      outcome: "UNDETERMINED",
      reason: "timeout",
    });
  });
  it("rules.cel.max_cost bounds the AST size at compile time", async () => {
    const e = new MemoryRuleEngine({ limits: { maxAstNodes: 20 } });
    const when = Array.from({ length: 12 }, (_, i) => `amount == ${i}`).join(" || ");
    const err = await e
      .compile({ ...RULES_FIXTURE, rows: [{ id: "big", when, then: {}, verify: false }] })
      .catch((x: unknown) => x);
    expect(err).toMatchObject({ name: "RuleCompileError", reason: "cel_limit" });
  });
});
