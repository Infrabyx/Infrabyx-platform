// WCAG 2.2 A and AA success criteria with their EN 301 549 and IS 17802 clauses (IPB-06-03). The
// data is `mapping.json` at the package root, so products and the statement read the same file.
import { readFileSync } from "node:fs";

export type TestMethod = "AUTO" | "SCRIPT" | "MANUAL" | "LINT" | "TOKEN" | "COMPONENT";

export interface CriterionMapping {
  sc: string;
  level: "A" | "AA";
  name: string;
  /** EN 301 549 V3.2.1 clause 9 (web); `[VERIFY]` for criteria new in WCAG 2.2. */
  en_301_549: string;
  /** IS 17802 Part 1 clause; `[VERIFY]` until the standard text is bought (OI-06-02). */
  is_17802: string;
  methods: TestMethod[];
  /** axe rules that cover the criterion, from the IPB-06 §06.3.2 test column. */
  axe_rules: string[];
  axe_rule_prefix?: string;
}

export interface Mapping {
  wcag: string;
  en_301_549: string;
  is_17802: string;
  criteria: CriterionMapping[];
}

let cached: Mapping | undefined;

/** The parsed `mapping.json` (from `src/` in tests and from `dist/` once built). */
export function wcagMapping(): Mapping {
  cached ??= JSON.parse(
    readFileSync(new URL("../mapping.json", import.meta.url), "utf8"),
  ) as Mapping;
  return cached;
}

/** True when a clause is still waiting for the standard's text. */
export const isUnverified = (clause: string) => clause === "[VERIFY]";
