// RULES engine contract (IPB-01-15, PL3 plan §4.2): every engine adapter (`zen`, `json-rules`, the
// memory CEL walk, or a product's own) compiles the platform decision table and returns the same
// matches. Run with defineContractSuite("RULES", factory, RULE_ENGINE_CASES, { leg: "hermetic" }).
import type { RuleSetBody } from "@infrabyx/contracts/ports";

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
