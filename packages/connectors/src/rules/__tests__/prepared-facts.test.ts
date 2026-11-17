// Prepared facts for rules over dated history (LawDocsComply PR-LDC-58, R1-D-147; guide §7by).
// The engines evaluate a pure function of the declared inputs that the decision log records, so a
// rule over a history never reads the history: the product derives each fact from its own records
// as of the decision date and passes it as a declared input. Every engine gives the same answer,
// and an expression that tries to walk a history inside the rule is refused at compile time.
import { describe, expect, it } from "vitest";
import type { RuleSetBody } from "@infrabyx/contracts/ports";
import { JsonRulesEngine, MemoryRuleEngine, ZenRuleEngine } from "../index.js";

/** The product's own records (never passed to the engine). */
interface Filing {
  dueOn: string;
  filedOn: string | null;
}

/** Derived once per decision, as of the decision date, from the product's own records. */
function filingFacts(history: readonly Filing[], asOf: string) {
  const from = new Date(`${asOf}T00:00:00Z`);
  from.setUTCFullYear(from.getUTCFullYear() - 1);
  const start = from.toISOString().slice(0, 10);
  const inWindow = history.filter((f) => f.dueOn > start && f.dueOn <= asOf);
  const late = inWindow.filter((f) => f.filedOn === null || f.filedOn > f.dueOn);
  return {
    late_filings_12m: late.length,
    open_filings: inWindow.filter((f) => f.filedOn === null).length,
    facts_as_of: asOf,
  };
}

const body: RuleSetBody = {
  format: "ipb.decision_table.v1",
  hit_policy: "first",
  inputs: [
    { name: "late_filings_12m", type: "integer", dataClass: "INTERNAL" },
    { name: "open_filings", type: "integer", dataClass: "INTERNAL" },
    { name: "facts_as_of", type: "date", dataClass: "INTERNAL" },
  ],
  outputs: [{ name: "action", type: "string", dataClass: "INTERNAL", statutory: false }],
  rows: [
    { id: "repeat", when: "late_filings_12m >= 3", then: { action: "escalate" }, verify: false },
    { id: "open", when: "open_filings > 0", then: { action: "remind" }, verify: false },
    { id: "clean", when: "true", then: { action: "none" }, verify: false },
  ],
};

const history: Filing[] = [
  { dueOn: "2025-10-31", filedOn: "2025-11-20" }, // more than a year before 2026-11-13
  { dueOn: "2026-01-31", filedOn: "2026-02-10" },
  { dueOn: "2026-04-30", filedOn: "2026-04-29" },
  { dueOn: "2026-07-31", filedOn: "2026-08-15" },
  { dueOn: "2026-10-31", filedOn: null },
];

describe("prepared facts (PR-LDC-58)", () => {
  it("a fact derived as of the decision date gives the same decision on every engine", async () => {
    const zen = new ZenRuleEngine();
    try {
      const compiled = await Promise.all(
        [zen, new JsonRulesEngine(), new MemoryRuleEngine()].map((e) => e.compile(body)),
      );
      const now = filingFacts(history, "2026-11-13");
      expect(now).toEqual({ late_filings_12m: 3, open_filings: 1, facts_as_of: "2026-11-13" });
      const before = filingFacts(history, "2026-06-30");
      expect(before.late_filings_12m).toBe(2);
      for (const [facts, action] of [
        [now, "escalate"],
        [before, "none"],
      ] as const) {
        const results = await Promise.all(
          compiled.map((c) => c.evaluate(facts, { timeoutMs: 2000 })),
        );
        for (const r of results) expect(r).toMatchObject({ outputs: { action } });
      }
    } finally {
      zen.dispose();
    }
  });

  it("a rule that walks a history inside the engine is refused when compiled", async () => {
    const walk: RuleSetBody = {
      ...body,
      inputs: [...body.inputs, { name: "filings", type: "list", dataClass: "INTERNAL" }],
      rows: [
        {
          id: "walk",
          when: "filings.filter(f, f.late).size() >= 3",
          then: { action: "escalate" },
          verify: false,
        },
      ],
    };
    await expect(new MemoryRuleEngine().compile(walk)).rejects.toThrow();
  });
});
