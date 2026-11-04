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

/**
 * Fixture for the CEL string functions `startsWith`, `endsWith`, `contains` and `matches`
 * (PR-LDC-13; R1-plan M40; R1-D-71), used by the contract and by the differential test in
 * `connectors`. Patterns are CEL raw strings, so `\d` is the pattern's own backslash.
 */
export const RULES_STRING_FIXTURE: RuleSetBody = {
  format: "ipb.decision_table.v1",
  hit_policy: "first",
  inputs: [
    { name: "name", type: "string", dataClass: "INTERNAL" },
    { name: "code", type: "string", dataClass: "INTERNAL" },
    { name: "prefix", type: "string", dataClass: "INTERNAL" },
    { name: "amount", type: "integer", dataClass: "INTERNAL" },
  ],
  outputs: [{ name: "class", type: "string", dataClass: "INTERNAL", statutory: false }],
  rows: [
    {
      id: "listed",
      when: 'code.matches(r"^L\\d{5}[A-Z]{2}\\d{4}(PLC|PTC)\\d{6}$")',
      then: { class: "listed" },
      verify: false,
    },
    {
      id: "nbfc",
      when: 'name.contains("NBFC") && !name.startsWith("Test")',
      then: { class: "nbfc" },
      verify: false,
    },
    {
      id: "co-op",
      when: 'name.matches(r"\\b[Cc]o-?op(erative)?\\b") || name.contains("सहकारी")',
      then: { class: "co-op" },
      verify: false,
    },
    {
      id: "prefixed",
      when: "code.startsWith(prefix) && amount >= 100",
      then: { class: "prefixed" },
      verify: false,
    },
    {
      id: "company",
      when: 'name.endsWith(" Ltd") || name.endsWith(" Limited")',
      then: { class: "company" },
      verify: false,
    },
    { id: "other", when: "true", then: { class: "other" }, verify: false },
  ],
};

export const stringFixtureInput = (
  over: Record<string, unknown> = {},
): Record<string, unknown> => ({
  name: "Acme Traders",
  code: "U12345MH2020PTC123456",
  prefix: "",
  amount: 0,
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
        'segment.lowerAscii() == "r"',
        "segment.size() > 1",
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
  {
    name: "CEL string functions startsWith, endsWith, contains and matches (PR-LDC-13)",
    async run(e) {
      const c = await e.compile(RULES_STRING_FIXTURE);
      const ids = async (over: Record<string, unknown>): Promise<string[]> =>
        (await c.evaluate(stringFixtureInput(over), T)).ruleIds;
      expect(await c.evaluate(stringFixtureInput(), T)).toEqual({
        outcome: "MATCHED",
        outputs: { class: "other" },
        ruleIds: ["other"],
        reason: "matched",
      });
      // matches is an unanchored search; the pattern's own ^ and $ anchor it.
      expect(await ids({ code: "L65910MH1995PLC012345" })).toEqual(["listed"]);
      expect(await ids({ code: "XL65910MH1995PLC012345" })).toEqual(["other"]);
      expect(await ids({ code: "L65910MH1995PLC0123456" })).toEqual(["other"]);
      expect(await ids({ name: "Acme NBFC Finance" })).toEqual(["nbfc"]);
      expect(await ids({ name: "Test NBFC" })).toEqual(["other"]);
      expect(await ids({ name: "Acme nbfc" })).toEqual(["other"]);
      expect(await ids({ name: "Shree Co-op Bank" })).toEqual(["co-op"]);
      expect(await ids({ name: "The Cooperative Society" })).toEqual(["co-op"]);
      expect(await ids({ name: "Coopers and Sons" })).toEqual(["other"]);
      expect(await ids({ name: "शहरी सहकारी बैंक" })).toEqual(["co-op"]);
      // A string input as the argument, including the empty string.
      expect(await ids({ code: "U12", prefix: "U1", amount: 100 })).toEqual(["prefixed"]);
      expect(await ids({ code: "U12", prefix: "U2", amount: 100 })).toEqual(["other"]);
      expect(await ids({ prefix: "", amount: 100 })).toEqual(["prefixed"]);
      expect(await ids({ name: "Acme Ltd" })).toEqual(["company"]);
      expect(await ids({ name: "Acme Limited" })).toEqual(["company"]);
      expect(await ids({ name: "Acme Ltd." })).toEqual(["other"]);
      const all = await e.compile(collect(RULES_STRING_FIXTURE));
      const every = stringFixtureInput({
        name: "Shree NBFC Co-op Ltd",
        code: "L65910MH1995PLC012345",
        prefix: "L6",
        amount: 100,
      });
      expect(await all.evaluate(every, T)).toEqual({
        outcome: "MATCHED",
        outputs: { class: ["listed", "nbfc", "co-op", "prefixed", "company", "other"] },
        ruleIds: ["listed", "nbfc", "co-op", "prefixed", "company", "other"],
        reason: "matched",
      });
      // A text over 4096 characters or with a lone surrogate never reaches an engine.
      for (const bad of [{ name: "a".repeat(4097) }, { code: "L\uD800" }, { prefix: "\uDC00" }])
        expect(await c.evaluate(stringFixtureInput(bad), T)).toEqual({
          outcome: "UNDETERMINED",
          outputs: {},
          ruleIds: [],
          reason: "input_invalid",
        });
    },
  },
  {
    name: "compile refuses a matches pattern outside the linear-time subset (cel_pattern)",
    async run(e) {
      const withString = (when: string): RuleSetBody => ({
        ...RULES_STRING_FIXTURE,
        rows: [{ id: "only", when, then: { class: "x" }, verify: false }],
      });
      for (const pattern of [
        "(a+)+",
        "(a*)*",
        "(a|aa)+",
        "(\\w)\\1",
        "(?<n>a)\\k<n>",
        "(?=a)b",
        "(?!a)b",
        "(?<=a)b",
        "(?<!a)b",
        "(?>a+)b",
        "a*+",
        ".*",
        "[^a]",
        "a".repeat(257),
      ])
        await refused(e, withString(`name.matches(r"${pattern}")`), "cel_pattern");
      // The pattern must be a literal; the receiver a string input (not a date, not a literal).
      await refused(e, withString("name.matches(prefix)"), "cel_unsupported");
      await refused(e, withString('"Acme".startsWith(name)'), "cel_unsupported");
      await refused(e, withRow('sanctionedOn.startsWith("2026")'), "cel_unsupported");
      await refused(e, withString('name.startsWith("a\\"b")'), "cel_unsupported");
      // A non-string receiver or argument is a type error, as everywhere in the subset.
      for (const when of ['amount.startsWith("1")', "name.contains(1)", "name.matches(1)"])
        await refused(e, withString(when), "cel_type");
    },
  },
];
