// RULES reference adapter `zen` (PL3 plan §4.2, PL3-D-15): GoRules ZEN 2.1.7. The platform table
// becomes one JDM decision table whose single input column has no field, so each cell is a whole
// expression generated from the lowered IR (never from the row's text). The one output column
// `_row` carries the row index; outputs are assembled from the platform table. ZEN reads a
// malformed cell or a missing input as "no match", so the input is checked first and only
// IR-generated expressions reach it.
import { ZenEngine, type ZenDecision } from "@gorules/zen-engine";
import type { CompiledRuleSet, RuleField } from "@infrabyx/contracts/ports";
import { epochDay, type Cond, type Literal } from "./cel.js";
import { compiled, InProcessRuleEngine, type PreparedTable } from "./table.js";

export class ZenRuleEngine extends InProcessRuleEngine {
  readonly name = "zen";
  private engine: ZenEngine | null = null;

  protected async compilePrepared(t: PreparedTable): Promise<CompiledRuleSet> {
    this.engine ??= new ZenEngine();
    const decision: ZenDecision = this.engine.createDecision(toJdm(t));
    const dates = [...t.fields.values()].filter((f) => f.type === "date").map((f) => f.name);
    return compiled(t, async (values) => {
      const input: Record<string, unknown> = { ...values };
      for (const d of dates) input[d] = epochDay(values[d] as string);
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

/** JDM for a prepared table (exported for tests). */
export function toJdm(t: PreparedTable): Record<string, unknown> {
  const pos = { x: 0, y: 0 };
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
            when: zenExpr(r.cond, t.fields),
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

export function zenExpr(c: Cond, fields: ReadonlyMap<string, RuleField>): string {
  const lit = (field: string, v: Literal): string => {
    if (fields.get(field)?.type === "date") return String(epochDay(v as string));
    return typeof v === "string" ? `"${v}"` : String(v);
  };
  switch (c.k) {
    case "const":
      return c.value ? "true" : "false";
    case "and":
    case "or":
      return c.c.map((x) => `(${zenExpr(x, fields)})`).join(` ${c.k} `);
    case "not":
      return `not (${zenExpr(c.c, fields)})`;
    case "cmp":
      return `${c.field} ${c.op} ${lit(c.field, c.value)}`;
    case "in":
      return `${c.field} in [${c.values.map((v) => lit(c.field, v)).join(", ")}]`;
    case "has":
      return `contains(${c.field}, ${lit(c.field, c.value)})`;
  }
}
