// RULES alternative adapter `json-rules` (PL3 plan §4.2): json-rules-engine 7.3.1. One rule per
// row, named by its index, with the lowered IR as `all`/`any`/`not` condition trees. A constant
// false row is never added. `first` takes the lowest matching index; outputs are assembled from
// the platform table.
import { Engine, type TopLevelCondition } from "json-rules-engine";
import type { CompiledRuleSet, RuleField } from "@infrabyx/contracts/ports";
import { epochDay, type CmpOp, type Cond, type Literal } from "./cel.js";
import { compiled, InProcessRuleEngine, type PreparedTable } from "./table.js";

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
  }
}
