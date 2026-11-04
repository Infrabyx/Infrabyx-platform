// Rule parameters bound at compile time (LawDocsComply PR-LDC-21 (a), R1-plan M55, R1-D-88): every
// engine compares an input with a parameter as with a literal, bound to the given values or else
// the defaults; parameters are never inputs; and ZEN's first evaluation is warmed (PR-LDC-25).
import { afterAll, describe, expect, it } from "vitest";
import type { RuleSetBody } from "@infrabyx/contracts/ports";
import {
  JsonRulesEngine,
  MemoryRuleEngine,
  prepareTable,
  RULE_ENGINES,
  RuleCompileError,
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

const body: RuleSetBody = {
  format: "ipb.decision_table.v1",
  hit_policy: "first",
  inputs: [
    { name: "score", type: "integer", dataClass: "INTERNAL" },
    { name: "segment", type: "string", dataClass: "INTERNAL" },
    { name: "filedOn", type: "date", dataClass: "INTERNAL" },
  ],
  outputs: [{ name: "band", type: "string", dataClass: "INTERNAL", statutory: false }],
  parameters: [
    { name: "minScore", type: "integer", setting: "x.rules.min", default: 700, min: 0, max: 900 },
    { name: "prefix", type: "string", setting: "x.rules.prefix", default: "ms" },
    { name: "cutOff", type: "date", setting: "x.rules.cut_off", default: "2026-04-01" },
    { name: "strict", type: "boolean", setting: "x.rules.strict", default: false },
  ],
  rows: [
    { id: "strict", when: "strict && score < 900", then: { band: "hold" }, verify: false },
    {
      id: "pass",
      when: "minScore <= score && segment.startsWith(prefix) && filedOn < cutOff",
      then: { band: "pass" },
      verify: false,
    },
    { id: "refer", when: "true", then: { band: "refer" }, verify: false },
  ],
};

const input = { score: 720, segment: "msme", filedOn: "2026-03-31" };

describe("rule parameters (R1-D-88)", () => {
  for (const n of RULE_ENGINES)
    it(`${n}: binds the defaults, then given values, and agrees with the other engines`, async () => {
      const e = engines[n]();
      const byDefault = await (await e.compile(body)).evaluate(input, { timeoutMs: 1000 });
      expect(byDefault.ruleIds).toEqual(["pass"]);
      const raised = await (
        await e.compile(body, { minScore: 750 })
      ).evaluate(input, {
        timeoutMs: 1000,
      });
      expect(raised.ruleIds).toEqual(["refer"]);
      const strict = await (
        await e.compile(body, { strict: true })
      ).evaluate(input, {
        timeoutMs: 1000,
      });
      expect(strict.ruleIds).toEqual(["strict"]);
      const later = await (
        await e.compile(body, { cutOff: "2026-03-01", prefix: "m" })
      ).evaluate(input, { timeoutMs: 1000 });
      expect(later.ruleIds).toEqual(["refer"]);
    });

  it("never takes a parameter as an input", async () => {
    const c = await new MemoryRuleEngine().compile(body);
    const r = await c.evaluate({ ...input, minScore: 1 }, { timeoutMs: 1000 });
    expect(r).toMatchObject({ outcome: "UNDETERMINED", reason: "input_invalid" });
  });

  it("refuses a value that does not fit the parameter", () => {
    expect(() => prepareTable(body, undefined, { minScore: 950 })).toThrow(RuleCompileError);
    expect(() => prepareTable(body, undefined, { minScore: 7.5 })).toThrow(/not an integer/);
    expect(() => prepareTable(body, undefined, { cutOff: "1 April" })).toThrow(/not a date/);
    expect(() => prepareTable(body, undefined, { strict: "yes" })).toThrow(/not a boolean/);
  });

  it("refuses a row that compares two parameters, or a parameter as a string receiver", () => {
    const two = {
      ...body,
      rows: [{ id: "x", when: "minScore > 1 && minScore < 2", then: {}, verify: false }],
    };
    // Each side of a comparison is a parameter and a literal: no input at all.
    expect(() => prepareTable(two)).toThrow(/one literal or parameter/);
    const recv = {
      ...body,
      rows: [{ id: "y", when: 'prefix.startsWith("m")', then: {}, verify: false }],
    };
    expect(() => prepareTable(recv)).toThrow(/string input as its receiver/);
  });

  it("warms each ZEN decision when it is compiled (PR-LDC-25)", async () => {
    const z = new ZenRuleEngine();
    try {
      const c = await z.compile(body);
      const started = performance.now();
      const r = await c.evaluate(input, { timeoutMs: 1000 });
      expect(r.ruleIds).toEqual(["pass"]);
      expect(performance.now() - started).toBeLessThan(250);
    } finally {
      z.dispose();
    }
  });
});
