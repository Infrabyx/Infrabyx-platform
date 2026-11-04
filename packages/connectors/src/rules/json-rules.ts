// RULES alternative adapter `json-rules` (PL3 plan §4.2): json-rules-engine 7.3.1. One rule per
// row, named by its index, with the lowered IR as `all`/`any`/`not` condition trees. A constant
// false row is never added. `first` takes the lowest matching index; outputs are assembled from
// the platform table. The CEL string functions are custom operators (`ipbStartsWith`,
// `ipbEndsWith`, `ipbContains`; a string-input argument is a fact reference) and `matches` is
// `ipbMatches`, an re2js search with the patterns compiled once per table (PR-LDC-13; R1-plan
// M40; R1-D-71).
import { Engine, type TopLevelCondition } from "json-rules-engine";
import type { CompiledRuleSet, RuleField } from "@infrabyx/contracts/ports";
import {
  epochDay,
  matchesConds,
  stringTest,
  type CmpOp,
  type Cond,
  type Literal,
  type StrFn,
} from "./cel.js";
import { linearPattern, type LinearPattern } from "./pattern.js";
import { compiled, InProcessRuleEngine, type PreparedTable } from "./table.js";

const STR_OPERATOR: Record<StrFn, string> = {
  startsWith: "ipbStartsWith",
  endsWith: "ipbEndsWith",
  contains: "ipbContains",
};

const OPERATOR: Record<CmpOp, string> = {
  "==": "equal",
  "!=": "notEqual",
  "<": "lessThan",
  "<=": "lessThanInclusive",
  ">": "greaterThan",
  ">=": "greaterThanInclusive",
};

export class JsonRulesEngine extends InProcessRuleEngine {
  readonly name = "json-rules";

  protected async compilePrepared(t: PreparedTable): Promise<CompiledRuleSet> {
    const engine = new Engine([], { allowUndefinedFacts: true });
    for (const [fn, op] of Object.entries(STR_OPERATOR))
      engine.addOperator(op, (s: unknown, arg: unknown) => stringTest(fn as StrFn, s, arg));
    const patterns = new Map<string, LinearPattern>();
    for (const m of matchesConds(t.rows.map((r) => r.cond)))
      if (!patterns.has(m.pattern)) patterns.set(m.pattern, linearPattern(m.pattern));
    engine.addOperator("ipbMatches", (s: unknown, pattern: unknown) => {
      const re = typeof pattern === "string" ? patterns.get(pattern) : undefined;
      if (!re) throw new Error("json-rules: matches pattern not compiled");
      return re.test(s as string);
    });
    for (const r of t.rows) {
      if (r.cond.k === "const" && !r.cond.value) continue;
      engine.addRule({
        name: String(r.index),
        conditions: topLevel(r.cond, t.fields),
        event: { type: "row", params: { index: r.index } },
      });
    }
    const dates = [...t.fields.values()].filter((f) => f.type === "date").map((f) => f.name);
    return compiled(t, async (values) => {
      const facts: Record<string, unknown> = { ...values };
      for (const d of dates) facts[d] = epochDay(values[d] as string);
      const { events } = await engine.run(facts);
      return events.map((e) => {
        const i = (e.params as { index?: unknown } | undefined)?.index;
        if (!Number.isInteger(i)) throw new Error("json-rules returned an event without its index");
        return i as number;
      });
    });
  }
}

/** json-rules-engine does not export its nested condition type. */
type Nested = Record<string, unknown>;

function topLevel(c: Cond, fields: ReadonlyMap<string, RuleField>): TopLevelCondition {
  const top: Nested =
    c.k === "and"
      ? { all: c.c.map((x) => nested(x, fields)) }
      : c.k === "or"
        ? { any: c.c.map((x) => nested(x, fields)) }
        : c.k === "const"
          ? { all: [] }
          : { all: [nested(c, fields)] };
  return top as unknown as TopLevelCondition;
}

function nested(c: Cond, fields: ReadonlyMap<string, RuleField>): Nested {
  const lit = (field: string, v: Literal): Literal =>
    fields.get(field)?.type === "date" ? epochDay(v as string) : v;
  switch (c.k) {
    case "and":
      return { all: c.c.map((x) => nested(x, fields)) };
    case "or":
      return { any: c.c.map((x) => nested(x, fields)) };
    case "not":
      return { not: nested(c.c, fields) };
    case "const":
      // Folded away below the top level (cel.ts `fold`); kept total for the type.
      return c.value ? { all: [] } : { not: { all: [] } };
    case "cmp":
      return { fact: c.field, operator: OPERATOR[c.op], value: lit(c.field, c.value) };
    case "in":
      return { fact: c.field, operator: "in", value: c.values.map((v) => lit(c.field, v)) };
    case "has":
      return { fact: c.field, operator: "contains", value: c.value };
    case "str":
      return {
        fact: c.field,
        operator: STR_OPERATOR[c.fn],
        value: "field" in c.arg ? { fact: c.arg.field } : c.arg.value,
      };
    case "matches":
      return { fact: c.field, operator: "ipbMatches", value: c.pattern };
  }
}
