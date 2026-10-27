// CEL lowering (PL3 plan §4.2): the IR every engine compiles, constant folding, and evaluateCel.
import { describe, expect, it } from "vitest";
import type { RuleField } from "@infrabyx/contracts/ports";
import {
  celEnvironment,
  DEFAULT_CEL_LIMITS,
  evaluateCel,
  fold,
  lowerWhen,
  zenExpr,
  type Cond,
} from "../index.js";

const fields: RuleField[] = [
  { name: "a", type: "string", dataClass: "INTERNAL" },
  { name: "n", type: "integer", dataClass: "INTERNAL" },
  { name: "d", type: "date", dataClass: "INTERNAL" },
  { name: "b", type: "boolean", dataClass: "INTERNAL" },
  { name: "l", type: "list", dataClass: "INTERNAL" },
];
const map = new Map(fields.map((f) => [f.name, f]));
const env = celEnvironment(fields, DEFAULT_CEL_LIMITS);
const low = (w: string): Cond => lowerWhen("r", w, map, env);

describe("CEL lowering", () => {
  it("lowers the supported forms, mirroring a literal on the left", () => {
    expect(low('a == "x" && n >= 10 && !(a in ["X", "Y"])')).toEqual({
      k: "and",
      c: [
        { k: "cmp", field: "a", op: "==", value: "x" },
        { k: "cmp", field: "n", op: ">=", value: 10 },
        { k: "not", c: { k: "in", field: "a", values: ["X", "Y"] } },
      ],
    });
    expect(low("10 < n")).toEqual({ k: "cmp", field: "n", op: ">", value: 10 });
    expect(low("n == -5")).toEqual({ k: "cmp", field: "n", op: "==", value: -5 });
    expect(low("b")).toEqual({ k: "cmp", field: "b", op: "==", value: true });
    expect(low('"z" in l')).toEqual({ k: "has", field: "l", value: "z" });
    expect(low('d < "2026-01-01"')).toEqual({ k: "cmp", field: "d", op: "<", value: "2026-01-01" });
  });
  it("folds constants and flattens nested and/or", () => {
    expect(low("true || n == 1")).toEqual({ k: "const", value: true });
    expect(low("false || n == 1")).toEqual({ k: "cmp", field: "n", op: "==", value: 1 });
    expect(low("!(true && b)")).toEqual({
      k: "not",
      c: { k: "cmp", field: "b", op: "==", value: true },
    });
    expect(fold({ k: "and", c: [{ k: "and", c: [{ k: "const", value: true }] }] })).toEqual({
      k: "const",
      value: true,
    });
  });
  it("refuses an invalid date literal, string ordering and an empty list", () => {
    for (const w of ['d < "2026-02-30"', 'a < "b"', "n in []"])
      expect(() => low(w), w).toThrow(/row r/);
  });
  it("prints ZEN expressions with dates as epoch days", () => {
    expect(zenExpr(low('d >= "1970-01-02" && "q" in l || !b'), map)).toBe(
      '((d >= 1) and (contains(l, "q"))) or (not (b == true))',
    );
  });
});

describe("evaluateCel", () => {
  it("evaluates with dyn inputs and reports the error class", () => {
    expect(evaluateCel("x + 1", { x: 2 })).toEqual({ ok: true, value: 3 });
    expect(evaluateCel('s.startsWith("a") && f > 0.5', { s: "abc", f: 0.75 })).toEqual({
      ok: true,
      value: true,
    });
    expect(evaluateCel("x +", {})).toEqual({ ok: false, error: "parse" });
    expect(evaluateCel("y == 1", {})).toEqual({ ok: false, error: "eval" });
    expect(evaluateCel("1 + 1 + 1 + 1", {}, { maxAstNodes: 3 })).toEqual({
      ok: false,
      error: "limit",
    });
  });
});
