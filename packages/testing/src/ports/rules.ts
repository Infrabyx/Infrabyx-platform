// RULES engine contract (IPB-01-15, PL3 plan §4.2): every engine adapter (`zen`, `json-rules`, the
// memory CEL walk, or a product's own) compiles the platform decision table and returns the same
// matches. Run with defineContractSuite("RULES", factory, RULE_ENGINE_CASES, { leg: "hermetic" }).
import { expect } from "vitest";
import type { Port, RuleEngine, RuleSetBody } from "@infrabyx/contracts/ports";
import type { ContractCase } from "../contract.js";

export type RuleEngineAdapter = RuleEngine & Port;

const T = { timeoutMs: 2000 };

/** Fixture table used by the contract and by the differential test in `connectors`. */
export const RULES_FIXTURE: RuleSetBody = {
  format: "ipb.decision_table.v1",
  hit_policy: "first",
  inputs: [
    { name: "segment", type: "string", dataClass: "INTERNAL" },
    { name: "amount", type: "integer", dataClass: "INTERNAL" },
    { name: "score", type: "number", dataClass: "CONFIDENTIAL" },
    { name: "kycDone", type: "boolean", dataClass: "INTERNAL" },
    { name: "sanctionedOn", type: "date", dataClass: "INTERNAL" },
    { name: "flags", type: "list", dataClass: "INTERNAL" },
  ],
  outputs: [
    { name: "action", type: "string", dataClass: "INTERNAL", statutory: false },
    { name: "limit", type: "integer", dataClass: "INTERNAL", statutory: true },
  ],
  rows: [
    {
      id: "blocked",
      when: '"fraud" in flags || !kycDone',
      then: { action: "refer" },
      verify: false,
    },
    {
      id: "large-retail",
      when: 'segment == "retail" && amount >= 500000 && score > 0.75',
      then: { action: "sanction", limit: 500000 },
      verify: false,
    },
    {
      id: "msme-recent",
      when: 'segment in ["msme", "sme"] && sanctionedOn >= "2026-04-01" && !(amount < 10000)',
      then: { action: "sanction", limit: 250000 },
      verify: false,
    },
    {
      id: "low-score",
      when: "0.4 >= score || amount == -1",
      then: { action: "decline" },
      verify: false,
    },
    {
      id: "not-retail",
      when: 'segment != "retail" && kycDone && 7 in flags',
      then: { action: "review" },
      verify: false,
    },
    { id: "never", when: "false", then: { action: "never" }, verify: false },
    { id: "default", when: "true", then: { action: "review" }, verify: false },
  ],
};

export const fixtureInput = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  segment: "retail",
  amount: 600000,
  score: 0.8,
  kycDone: true,
  sanctionedOn: "2026-05-01",
  flags: [],
  ...over,
});

const collect = (b: RuleSetBody): RuleSetBody => ({ ...b, hit_policy: "collect" });

async function refused(e: RuleEngineAdapter, body: RuleSetBody, reason?: string): Promise<void> {
  const err = await e.compile(body).then(
    () => null,
    (x: unknown) => x,
  );
  expect(err, "compile must refuse").toBeInstanceOf(Error);
  expect((err as Error).name).toBe("RuleCompileError");
  if (reason) expect((err as { reason?: string }).reason).toBe(reason);
}

const withRow = (when: string): RuleSetBody => ({
  ...RULES_FIXTURE,
  rows: [{ id: "only", when, then: { action: "x" }, verify: false }],
});

export const RULE_ENGINE_CASES: ReadonlyArray<ContractCase<RuleEngineAdapter>> = [
  {
    name: "first: the first matching row wins and outputs come from the table",
    async run(e) {
      const c = await e.compile(RULES_FIXTURE);
      expect(await c.evaluate(fixtureInput(), T)).toEqual({
        outcome: "MATCHED",
        outputs: { action: "sanction", limit: 500000 },
        ruleIds: ["large-retail"],
        reason: "matched",
      });
      expect((await c.evaluate(fixtureInput({ flags: ["fraud"] }), T)).ruleIds).toEqual([
        "blocked",
      ]);
      expect((await c.evaluate(fixtureInput({ kycDone: false }), T)).ruleIds).toEqual(["blocked"]);
      const msme = fixtureInput({ segment: "sme", amount: 10000, sanctionedOn: "2026-04-01" });
      expect((await c.evaluate(msme, T)).ruleIds).toEqual(["msme-recent"]);
      expect((await c.evaluate({ ...msme, sanctionedOn: "2026-03-31" }, T)).ruleIds).toEqual([
        "default",
      ]);
      expect((await c.evaluate({ ...msme, amount: 9999 }, T)).ruleIds).toEqual(["default"]);
      expect((await c.evaluate(fixtureInput({ score: 0.4 }), T)).ruleIds).toEqual(["low-score"]);
      expect((await c.evaluate(fixtureInput({ amount: -1 }), T)).ruleIds).toEqual(["low-score"]);
      expect(
        (await c.evaluate(fixtureInput({ segment: "msme", amount: 5, flags: [7] }), T)).ruleIds,
      ).toEqual(["not-retail"]);
    },
  },
  {
    name: "collect: every matching row in table order; each output is the list of row values",
    async run(e) {
      const c = await e.compile(collect(RULES_FIXTURE));
      expect(await c.evaluate(fixtureInput({ score: 0.3, flags: ["fraud"] }), T)).toEqual({
        outcome: "MATCHED",
        outputs: { action: ["refer", "decline", "review"] },
        ruleIds: ["blocked", "low-score", "default"],
        reason: "matched",
      });
      expect((await c.evaluate(fixtureInput(), T)).outputs).toEqual({
        action: ["sanction", "review"],
        limit: [500000],
      });
    },
  },
  {
    name: "no matching row is NO_MATCH with reason no_row",
    async run(e) {
      const body = { ...RULES_FIXTURE, rows: RULES_FIXTURE.rows.slice(0, 5) };
      for (const b of [body, collect(body)]) {
        const c = await e.compile(b);
        expect(await c.evaluate(fixtureInput({ amount: 100 }), T)).toEqual({
          outcome: "NO_MATCH",
          outputs: {},
          ruleIds: [],
          reason: "no_row",
        });
      }
    },
  },
  {
    name: "an invalid input is UNDETERMINED (input_invalid), never a match",
    async run(e) {
      const c = await e.compile(RULES_FIXTURE);
      const { segment: _drop, ...missing } = fixtureInput();
      for (const bad of [
        missing,
        fixtureInput({ amount: 1.5 }),
        fixtureInput({ amount: "600000" }),
        fixtureInput({ score: Number.NaN }),
        fixtureInput({ sanctionedOn: "2026-02-30" }),
        fixtureInput({ flags: [{ a: 1 }] }),
        fixtureInput({ extra: 1 }),
        null,
        [],
      ]) {
        expect(await c.evaluate(bad as Record<string, unknown>, T)).toEqual({
          outcome: "UNDETERMINED",
          outputs: {},
          ruleIds: [],
          reason: "input_invalid",
        });
      }
    },
  },
  {
    name: "evaluation is deterministic and compiled tables are independent",
    async run(e) {
      const a = await e.compile(RULES_FIXTURE);
      const b = await e.compile(collect(RULES_FIXTURE));
      const inputs = [
        fixtureInput(),
        fixtureInput({ segment: "msme" }),
        fixtureInput({ score: 0 }),
      ];
      const first = await Promise.all(inputs.map((i) => a.evaluate(i, T)));
      await Promise.all(inputs.map((i) => b.evaluate(i, T)));
      expect(await Promise.all(inputs.map((i) => a.evaluate(i, T)))).toEqual(first);
    },
  },
  {
    name: "compile refuses CEL outside the platform subset (RuleCompileError)",
    async run(e) {
      for (const when of [
        "amount + 1 > 2",
        'segment.startsWith("r")',
        "amount > score",
        "unknownInput == 1",
        'segment < "z"',
        "kycDone < true",
        'segment == "a\\"b"',
        "amount > 1e21",
        "flags == []",
        "amount",
        '"retail"',
        "amount > 1 ? true : false",
        "size(flags) > 0",
      ])
        await refused(e, withRow(when));
      await refused(e, withRow("segment == 1"), "cel_type");
      await refused(e, withRow("segment =="), "cel_parse");
      await refused(
        e,
        {
          ...RULES_FIXTURE,
          inputs: [{ name: "in", type: "string", dataClass: "INTERNAL" }],
          rows: [{ id: "r", when: "true", then: { action: "x" }, verify: false }],
        },
        "reserved_name",
      );
      await refused(e, { ...RULES_FIXTURE, rows: [] } as RuleSetBody, "schema");
    },
  },
];
