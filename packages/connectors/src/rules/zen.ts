// RULES reference adapter `zen` (PL3 plan §4.2, PL3-D-15): GoRules ZEN 2.1.7. The platform table
// becomes one JDM decision table whose single input column has no field, so each cell is a whole
// expression generated from the lowered IR (never from the row's text). The one output column
// `_row` carries the row index; outputs are assembled from the platform table. ZEN reads a
// malformed cell or a missing input as "no match", so the input is checked first and only
// IR-generated expressions reach it. `startsWith`, `endsWith` and `contains` print as ZEN's own
// functions. `matches` does not: ZEN's regex dialect is not RE2's, so each distinct (input, pattern)
// is evaluated with re2js before ZEN runs and passed in as a boolean input `_m0`, `_m1`, ...
// (declared input names never start with `_`) (PR-LDC-13; R1-plan M40; R1-D-71).
import { ZenEngine, type ZenDecision } from "@gorules/zen-engine";
import type { CompiledRuleSet, RuleField } from "@infrabyx/contracts/ports";
import { epochDay, matchesConds, matchesKey, type Cond, type Literal } from "./cel.js";
import { linearPattern } from "./pattern.js";
import { compiled, InProcessRuleEngine, type PreparedTable } from "./table.js";

export class ZenRuleEngine extends InProcessRuleEngine {
  readonly name = "zen";
  private engine: ZenEngine | null = null;

  protected async compilePrepared(t: PreparedTable): Promise<CompiledRuleSet> {
    this.engine ??= new ZenEngine();
    const decision: ZenDecision = this.engine.createDecision(toJdm(t));
    const dates = [...t.fields.values()].filter((f) => f.type === "date").map((f) => f.name);
    const matches = matchesConds(t.rows.map((r) => r.cond)).map((m, i) => ({
      name: matchVar(i),
      field: m.field,
      re: linearPattern(m.pattern),
    }));
    return compiled(t, async (values) => {
      const input: Record<string, unknown> = { ...values };
      for (const d of dates) input[d] = epochDay(values[d] as string);
      for (const m of matches) input[m.name] = m.re.test(values[m.field] as string);
      const { result } = (await decision.evaluate(input)) as { result: unknown };
      const hits = Array.isArray(result)
        ? result
        : result && typeof result === "object"
          ? [result]
          : [];
      const out: number[] = [];
      for (const h of hits) {
        // `first` with no match returns `{}`.
        if (!h || typeof h !== "object" || Object.keys(h).length === 0) continue;
        const i = (h as { _row?: unknown })._row;
        if (!Number.isInteger(i)) throw new Error("zen returned a row without its index");
        out.push(i as number);
      }
      return out;
    });
  }

  dispose(): void {
    this.engine?.dispose();
    this.engine = null;
  }
}

const matchVar = (i: number): string => `_m${i}`;

/** The boolean input that carries each `matches` node of a table, by `matchesKey`. */
export function zenMatchInputs(t: Pick<PreparedTable, "rows">): Map<string, string> {
  return new Map(
    matchesConds(t.rows.map((r) => r.cond)).map((m, i) => [
      matchesKey(m.field, m.pattern),
      matchVar(i),
    ]),
  );
}

/** JDM for a prepared table (exported for tests). */
export function toJdm(t: PreparedTable): Record<string, unknown> {
  const pos = { x: 0, y: 0 };
  const vars = zenMatchInputs(t);
  return {
    nodes: [
      { id: "input", type: "inputNode", name: "input", position: pos },
      {
        id: "table",
        type: "decisionTableNode",
        name: "table",
        position: pos,
        content: {
          hitPolicy: t.body.hit_policy,
          inputs: [{ id: "when", name: "when", type: "expression" }],
          outputs: [{ id: "row", field: "_row", name: "_row", type: "expression" }],
          rules: t.rows.map((r) => ({
            _id: `r${r.index}`,
            when: zenExpr(r.cond, t.fields, vars),
            row: String(r.index),
          })),
        },
      },
      { id: "output", type: "outputNode", name: "output", position: pos },
    ],
    edges: [
      { id: "e1", sourceId: "input", targetId: "table", type: "edge" },
      { id: "e2", sourceId: "table", targetId: "output", type: "edge" },
    ],
  };
}

/**
 * One cell expression from the IR. `matchVars` names the boolean input of each `matches` node
 * (`zenMatchInputs`); a `matches` node without one cannot be printed.
 */
export function zenExpr(
  c: Cond,
  fields: ReadonlyMap<string, RuleField>,
  matchVars: ReadonlyMap<string, string> = new Map(),
): string {
  const lit = (field: string, v: Literal): string => {
    if (fields.get(field)?.type === "date") return String(epochDay(v as string));
    return typeof v === "string" ? `"${v}"` : String(v);
  };
  switch (c.k) {
    case "const":
      return c.value ? "true" : "false";
    case "and":
    case "or":
      return c.c.map((x) => `(${zenExpr(x, fields, matchVars)})`).join(` ${c.k} `);
    case "not":
      return `not (${zenExpr(c.c, fields, matchVars)})`;
    case "cmp":
      return `${c.field} ${c.op} ${lit(c.field, c.value)}`;
    case "in":
      return `${c.field} in [${c.values.map((v) => lit(c.field, v)).join(", ")}]`;
    case "has":
      return `contains(${c.field}, ${lit(c.field, c.value)})`;
    case "str": {
      // String literals hold no quote, backslash or control character (cel.ts `plainString`).
      const arg = "field" in c.arg ? c.arg.field : `"${c.arg.value}"`;
      return `${c.fn}(${c.field}, ${arg})`;
    }
    case "matches": {
      const v = matchVars.get(matchesKey(c.field, c.pattern));
      if (!v) throw new Error("zen: a matches node needs its precomputed input");
      return `${v} == true`;
    }
  }
}
