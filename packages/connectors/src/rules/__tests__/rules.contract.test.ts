// RULES contract legs (PL3 plan §4.2, §12): the same cases on `zen`, `json-rules` and the memory
// CEL walk. In-process engines have no vendor, so the hermetic leg is the only leg and none of them
// is listed in sandbox-status.json. The differential test is in rules.test.ts (every unit run).
import { afterAll } from "vitest";
import { defineContractSuite, RULE_ENGINE_CASES } from "@infrabyx/testing";
import { JsonRulesEngine, MemoryRuleEngine, RULE_ENGINES, ZenRuleEngine } from "../index.js";

const zen = new ZenRuleEngine();
afterAll(() => zen.dispose());
const factories = {
  zen: () => zen,
  "json-rules": () => new JsonRulesEngine(),
  memory: () => new MemoryRuleEngine(),
};
for (const name of RULE_ENGINES)
  defineContractSuite("RULES", factories[name], RULE_ENGINE_CASES, { leg: "hermetic" });
