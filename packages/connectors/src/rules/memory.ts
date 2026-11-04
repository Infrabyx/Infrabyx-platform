// RULES second alternative (IPB-01 §01.4.4.0): a direct CEL row walk with `@marcbachmann/cel-js`.
// It evaluates each row's original `when`, not the lowered IR, so the differential test against
// `zen` and `json-rules` also checks the lowering itself. It lives here rather than in
// `@infrabyx/testing` because the CEL library is a vendor import (PL3 plan §4.2).
import type { CompiledRuleSet } from "@infrabyx/contracts/ports";
import { celEnvironment, celInput } from "./cel.js";
import { compiled, InProcessRuleEngine, type PreparedTable } from "./table.js";

export class MemoryRuleEngine extends InProcessRuleEngine {
  readonly name = "memory";

  protected async compilePrepared(t: PreparedTable): Promise<CompiledRuleSet> {
    const env = celEnvironment([...t.body.inputs, ...t.parameterFields.values()], t.limits);
    const programs = t.rows.map((r) => env.parse(r.when));
    // Parameters (R1-D-88) are bound into every row's context as the CEL values they stand for.
    const bound = celInput(t.parameterFields, t.parameterValues);
    return compiled(t, (values) => {
      const ctx = { ...celInput(t.fields, values), ...bound };
      const hit: number[] = [];
      for (const [i, p] of programs.entries()) {
        const v: unknown = p(ctx);
        if (typeof v !== "boolean") throw new Error("row did not evaluate to a boolean");
        if (v) {
          hit.push(i);
          if (t.body.hit_policy === "first") break;
        }
      }
      return hit;
    });
  }
}
