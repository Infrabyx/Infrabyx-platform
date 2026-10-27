// RULES engine adapters (PL3 plan §4.2, A-01): `zen` (reference), `json-rules` (alternative) and
// the memory CEL row walk. The store, publish flow and decision log are in `@infrabyx/rules`.
import type { RuleEngine } from "@infrabyx/contracts/ports";
import type { CelLimits } from "./cel.js";
import { JsonRulesEngine } from "./json-rules.js";
import { MemoryRuleEngine } from "./memory.js";
import { ZenRuleEngine } from "./zen.js";
import type { InProcessRuleEngine } from "./table.js";

export * from "./cel.js";
export * from "./table.js";
export { JsonRulesEngine } from "./json-rules.js";
export { MemoryRuleEngine } from "./memory.js";
export { ZenRuleEngine, toJdm, zenExpr } from "./zen.js";

export const RULE_ENGINES = ["zen", "json-rules", "memory"] as const;
export type RuleEngineName = (typeof RULE_ENGINES)[number];

/** The adapter for the `rules.engine` setting (`memory` is for tests and validation only). */
export function ruleEngine(
  name: RuleEngineName,
  opts: { limits?: CelLimits } = {},
): InProcessRuleEngine & RuleEngine {
  switch (name) {
    case "zen":
      return new ZenRuleEngine(opts);
    case "json-rules":
      return new JsonRulesEngine(opts);
    case "memory":
      return new MemoryRuleEngine(opts);
  }
}
