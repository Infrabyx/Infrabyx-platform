// CEL for RULES (PL3 plan §4.2, PL3-D-15): `@marcbachmann/cel-js` parses and type-checks every
// row's `when`, and the AST is lowered to a small condition IR that every engine adapter compiles.
// The subset is deliberately narrow so `zen`, `json-rules` and the memory engine always run the
// same rows: and, or, not; a declared input compared with a literal (either side); an input `in`
// a literal list; a literal `in` a list input; a bare boolean input; a constant; and the string
// functions `startsWith`, `endsWith`, `contains` (a string input as receiver, a string literal or
// another string input as argument) and `matches` (a string literal pattern in the linear-time
// subset of `pattern.ts`; PR-LDC-13, R1-plan M40, R1-D-71). Anything else is refused when the
// draft is validated (`RuleCompileError`, surfaced as IPB-RULE-001).
import { Environment, type ASTNode } from "@marcbachmann/cel-js";
import type { CelResult, RuleField } from "@infrabyx/contracts/ports";
import { MAX_MATCH_INPUT, patternRefusal } from "./pattern.js";

export type Literal = string | number | boolean;
export type CmpOp = "==" | "!=" | "<" | "<=" | ">" | ">=";
/** CEL string functions with a string argument (PR-LDC-13); `matches` has its own node. */
export type StrFn = "startsWith" | "endsWith" | "contains";
/** The argument of a string function: a string literal or another string input. */
export type StrArg = { value: string } | { field: string };
export type Cond =
  | { k: "and" | "or"; c: Cond[] }
  | { k: "not"; c: Cond }
  | { k: "cmp"; field: string; op: CmpOp; value: Literal }
  | { k: "in"; field: string; values: Literal[] }
  | { k: "has"; field: string; value: Literal }
  | { k: "str"; fn: StrFn; field: string; arg: StrArg }
  | { k: "matches"; field: string; pattern: string }
  | { k: "const"; value: boolean };

/** Structural limits (PL3-D-15); `maxAstNodes` is `rules.cel.max_cost`. */
export interface CelLimits {
  maxAstNodes: number;
}
export const DEFAULT_CEL_LIMITS: CelLimits = { maxAstNodes: 10_000 };
const FIXED_LIMITS = {
  maxDepth: 250,
  maxListElements: 1000,
  maxMapEntries: 1000,
  maxCallArguments: 32,
};

/**
 * Field names that collide with an engine's keywords or with JavaScript object members. Refused in
 * every table so a row means the same thing on every engine.
 */
export const RESERVED_FIELD_NAMES: ReadonlySet<string> = new Set([
  "and",
  "or",
  "not",
  "in",
  "true",
  "false",
  "null",
  "contains",
  "constructor",
  "prototype",
  "hasOwnProperty",
  "toString",
  "valueOf",
]);

const CEL_TYPE: Record<RuleField["type"], string> = {
  string: "string",
  number: "double",
  integer: "int",
  boolean: "bool",
  date: "string",
  list: "list",
};

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Literal numbers every engine prints and parses identically (no exponent form). */
const PLAIN_NUMBER_RE = /^-?\d+(\.\d+)?$/;
/** A lone surrogate: ZEN reads it as U+FFFD, JavaScript as itself, so engines would disagree. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
/** Well-formed UTF-16 (no lone surrogate); rule inputs and literals must be (PR-LDC-13). */
export const wellFormed = (s: string): boolean => !LONE_SURROGATE.test(s);
/**
 * String literals: no quote, backslash or control characters, so no engine needs escapes; and
 * well-formed UTF-16.
 */
const plainString = (v: string): boolean =>
  v.length <= 1024 &&
  wellFormed(v) &&
  ![...v].some((ch) => ch === '"' || ch === "\\" || ch < " " || ch === "\u007f");

export class RuleCompileError extends Error {
  constructor(
    readonly rowId: string | null,
    readonly reason: string,
    detail: string,
  ) {
    super(rowId ? `row ${rowId}: ${detail}` : detail);
    this.name = "RuleCompileError";
  }
}

export function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}

/** Days since 1970-01-01 for a valid `YYYY-MM-DD`. */
export function epochDay(s: string): number {
  return Date.parse(`${s}T00:00:00Z`) / 86_400_000;
}

/** A CEL environment with every declared input registered at its CEL type. */
export function celEnvironment(fields: readonly RuleField[], limits: CelLimits): Environment {
  const env = new Environment({ limits: { ...FIXED_LIMITS, maxAstNodes: limits.maxAstNodes } });
  for (const f of fields) env.registerVariable(f.name, CEL_TYPE[f.type]);
  return env;
}

/**
 * The rule set's parameters (R1-D-88) while one row is lowered: each is a constant bound to the
 * tenant's value at compile time, so a row compares an input with a parameter as with a literal.
 * Lowering is synchronous, so this is set and cleared around one `lowerWhen` call.
 */
let CONSTS: ReadonlyMap<string, Literal> = new Map();
const isConst = (n: ASTNode): boolean => n.op === "id" && CONSTS.has(n.args as string);
const isInput = (n: ASTNode): boolean => n.op === "id" && !CONSTS.has(n.args as string);

/**
 * Parse, type-check and lower one row's `when` against the declared inputs. `consts` binds the
 * rule set's parameters to their values (the environment declares them as variables).
 */
export function lowerWhen(
  rowId: string,
  when: string,
  fields: ReadonlyMap<string, RuleField>,
  env: Environment,
  consts: ReadonlyMap<string, Literal> = new Map(),
): Cond {
  let ast: ASTNode;
  try {
    const parsed = env.parse(when);
    const checked = parsed.check();
    if (!checked.valid)
      throw new RuleCompileError(
        rowId,
        "cel_type",
        checked.error?.message.split("\n")[0] ?? "type",
      );
    if (checked.type !== "bool")
      throw new RuleCompileError(rowId, "cel_type", `when must be bool, got ${checked.type}`);
    ast = parsed.ast;
  } catch (e) {
    if (e instanceof RuleCompileError) throw e;
    const msg = (e instanceof Error ? e.message : String(e)).split("\n")[0] ?? "parse";
    throw new RuleCompileError(
      rowId,
      /Exceeded max[A-Z]/.test(msg) ? "cel_limit" : "cel_parse",
      msg,
    );
  }
  CONSTS = consts;
  try {
    return fold(lower(rowId, ast, fields));
  } finally {
    CONSTS = new Map();
  }
}

function refuse(rowId: string, what: string): never {
  throw new RuleCompileError(rowId, "cel_unsupported", what);
}

const MIRROR: Record<CmpOp, CmpOp> = {
  "==": "==",
  "!=": "!=",
  "<": ">",
  "<=": ">=",
  ">": "<",
  ">=": "<=",
};
const CMP_OPS = new Set<string>(Object.keys(MIRROR));

function lower(rowId: string, n: ASTNode, fields: ReadonlyMap<string, RuleField>): Cond {
  switch (n.op) {
    case "&&":
    case "||": {
      const [a, b] = n.args;
      return {
        k: n.op === "&&" ? "and" : "or",
        c: [lower(rowId, a, fields), lower(rowId, b, fields)],
      };
    }
    case "!_":
      return { k: "not", c: lower(rowId, n.args, fields) };
    case "rcall":
      return lowerStringCall(rowId, n.args[0], n.args[1], n.args[2], fields);
    case "value":
      if (typeof n.args === "boolean") return { k: "const", value: n.args };
      return refuse(rowId, "a non-boolean constant is not a condition");
    case "id": {
      if (isConst(n)) {
        const v = CONSTS.get(n.args);
        if (typeof v !== "boolean") refuse(rowId, `parameter ${n.args} is not boolean`);
        return { k: "const", value: v as boolean };
      }
      const f = fieldOf(rowId, n.args, fields);
      if (f.type !== "boolean") refuse(rowId, `input ${f.name} is not boolean`);
      return { k: "cmp", field: f.name, op: "==", value: true };
    }
    case "in": {
      const [a, b] = n.args;
      if (isInput(a) && b.op === "list") {
        const f = fieldOf(rowId, a.args as string, fields);
        if (f.type === "list") refuse(rowId, `list input ${f.name} cannot be the left side of in`);
        const values = b.args.map((x) => literalFor(rowId, x, f));
        if (values.length === 0) refuse(rowId, "empty list");
        return { k: "in", field: f.name, values };
      }
      if (isInput(b)) {
        const f = fieldOf(rowId, b.args as string, fields);
        if (f.type !== "list") refuse(rowId, `${f.name} is not a list input`);
        const v = literal(rowId, a);
        if (typeof v === "boolean") refuse(rowId, "boolean list membership");
        return { k: "has", field: f.name, value: v };
      }
      return refuse(rowId, "in needs an input and a literal list, or a literal and a list input");
    }
    default:
      break;
  }
  if (CMP_OPS.has(n.op)) {
    const [a, b] = n.args as [ASTNode, ASTNode];
    let op = n.op as CmpOp;
    let id: ASTNode;
    let lit: ASTNode;
    if (isInput(a) && !isInput(b)) [id, lit] = [a, b];
    else if (isInput(b) && !isInput(a)) {
      [id, lit] = [b, a];
      op = MIRROR[op];
    } else
      return refuse(rowId, "a comparison needs exactly one input and one literal or parameter");
    const f = fieldOf(rowId, id.args as string, fields);
    if (f.type === "list") refuse(rowId, `list input ${f.name} cannot be compared`);
    if ((f.type === "string" || f.type === "boolean") && op !== "==" && op !== "!=")
      refuse(rowId, `${f.type} input ${f.name} supports only == and !=`);
    return { k: "cmp", field: f.name, op, value: literalFor(rowId, lit, f) };
  }
  return refuse(rowId, `operator ${n.op}`);
}

const STR_FNS: ReadonlySet<string> = new Set<StrFn>(["startsWith", "endsWith", "contains"]);

/**
 * `s.startsWith(x)`, `s.endsWith(x)`, `s.contains(x)` and `s.matches("re")` (PR-LDC-13; R1-plan
 * M40; R1-D-71). The receiver is a string input; the type checker has already refused a
 * non-string receiver or argument (`cel_type`). A `matches` pattern must be a literal in the
 * linear-time subset (`cel_pattern` otherwise), so it is checked here, when the draft is saved.
 */
function lowerStringCall(
  rowId: string,
  name: string,
  recv: ASTNode,
  argv: readonly ASTNode[],
  fields: ReadonlyMap<string, RuleField>,
): Cond {
  if (name !== "matches" && !STR_FNS.has(name)) return refuse(rowId, `function ${name}`);
  if (!isInput(recv)) return refuse(rowId, `${name} needs a string input as its receiver`);
  const f = stringField(rowId, recv.args as string, fields, name);
  const [a] = argv;
  if (argv.length !== 1 || !a) return refuse(rowId, `${name} takes one argument`);
  if (name === "matches") {
    if (a.op !== "value" || typeof a.args !== "string")
      return refuse(rowId, "matches needs a string literal pattern");
    const why = patternRefusal(a.args);
    if (why) throw new RuleCompileError(rowId, "cel_pattern", `matches pattern refused: ${why}`);
    return { k: "matches", field: f.name, pattern: a.args };
  }
  const fn = name as StrFn;
  if (isInput(a)) {
    const g = stringField(rowId, a.args as string, fields, name);
    return { k: "str", fn, field: f.name, arg: { field: g.name } };
  }
  const v = literal(rowId, a);
  if (typeof v !== "string") return refuse(rowId, `${name} needs a string argument`);
  return { k: "str", fn, field: f.name, arg: { value: v } };
}

function stringField(
  rowId: string,
  name: string,
  fields: ReadonlyMap<string, RuleField>,
  fn: string,
): RuleField {
  const f = fieldOf(rowId, name, fields);
  if (f.type !== "string") refuse(rowId, `${fn} takes string inputs; ${f.name} is ${f.type}`);
  return f;
}

/** `startsWith`, `endsWith`, `contains` as the IR engines evaluate them (no coercion). */
export function stringTest(fn: StrFn, s: unknown, arg: unknown): boolean {
  if (typeof s !== "string" || typeof arg !== "string") throw new TypeError(`${fn} needs strings`);
  if (fn === "startsWith") return s.startsWith(arg);
  return fn === "endsWith" ? s.endsWith(arg) : s.includes(arg);
}

/** Every distinct `matches` node in some conditions, in first-occurrence order. */
export function matchesConds(conds: readonly Cond[]): { field: string; pattern: string }[] {
  const out = new Map<string, { field: string; pattern: string }>();
  const walk = (c: Cond): void => {
    if (c.k === "and" || c.k === "or") c.c.forEach(walk);
    else if (c.k === "not") walk(c.c);
    else if (c.k === "matches") {
      const key = matchesKey(c.field, c.pattern);
      if (!out.has(key)) out.set(key, { field: c.field, pattern: c.pattern });
    }
  };
  conds.forEach(walk);
  return [...out.values()];
}

/** Map key of one `matches` node (field and pattern). */
export const matchesKey = (field: string, pattern: string): string => `${field}\u0000${pattern}`;

function fieldOf(rowId: string, name: string, fields: ReadonlyMap<string, RuleField>): RuleField {
  const f = fields.get(name);
  if (!f) refuse(rowId, `unknown input ${name}`);
  return f;
}

function literal(rowId: string, n: ASTNode): Literal {
  if (isConst(n)) return CONSTS.get(n.args as string) as Literal;
  if (n.op === "-_" && n.args.op === "value") {
    const v = number(rowId, n.args.args);
    return -v;
  }
  if (n.op !== "value") return refuse(rowId, `expected a literal, got ${n.op}`);
  const v = n.args;
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    if (!plainString(v))
      refuse(rowId, "string literal with a quote, backslash or control character");
    return v;
  }
  return number(rowId, v);
}

function number(rowId: string, v: unknown): number {
  const x = typeof v === "bigint" ? Number(v) : v;
  if (typeof x !== "number" || !Number.isFinite(x)) return refuse(rowId, "literal type");
  if (typeof v === "bigint" && !Number.isSafeInteger(x))
    refuse(rowId, "integer literal out of range");
  if (!PLAIN_NUMBER_RE.test(String(Math.abs(x))))
    refuse(rowId, `number literal ${x} needs plain notation`);
  return x;
}

function literalFor(rowId: string, n: ASTNode, f: RuleField): Literal {
  const v = literal(rowId, n);
  const ok =
    f.type === "string"
      ? typeof v === "string"
      : f.type === "boolean"
        ? typeof v === "boolean"
        : f.type === "date"
          ? typeof v === "string" && isValidDate(v)
          : typeof v === "number";
  if (!ok) refuse(rowId, `literal does not match ${f.type} input ${f.name}`);
  return v;
}

/** Flatten nested and/or and fold constants, so engines see no constant inside a tree. */
export function fold(c: Cond): Cond {
  if (c.k === "not") {
    const inner = fold(c.c);
    return inner.k === "const" ? { k: "const", value: !inner.value } : { k: "not", c: inner };
  }
  if (c.k !== "and" && c.k !== "or") return c;
  const unit = c.k === "and";
  const out: Cond[] = [];
  for (const x of c.c.map(fold)) {
    if (x.k === "const") {
      if (x.value !== unit) return { k: "const", value: !unit };
      continue;
    }
    if (x.k === c.k) out.push(...x.c);
    else out.push(x);
  }
  if (out.length === 0) return { k: "const", value: unit };
  return out.length === 1 ? (out[0] as Cond) : { k: c.k, c: out };
}

/**
 * RULES `evaluateCel`: a free-standing CEL expression over a JSON input, under the same structural
 * limits. Unlisted variables are `dyn`. Integers in the input are passed as CEL `int`.
 */
export function evaluateCel(
  expr: string,
  input: unknown,
  limits: CelLimits = DEFAULT_CEL_LIMITS,
): CelResult {
  const env = new Environment({
    unlistedVariablesAreDyn: true,
    limits: { ...FIXED_LIMITS, maxAstNodes: limits.maxAstNodes },
  });
  let parsed: ReturnType<Environment["parse"]>;
  try {
    parsed = env.parse(expr);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: /max[A-Z]/.test(msg) ? "limit" : "parse" };
  }
  const checked = parsed.check();
  if (!checked.valid) return { ok: false, error: "type" };
  // `matches` here runs on the CEL library's JavaScript RegExp, so its pattern must be a literal in
  // the linear-time subset ("limit" otherwise), and every string in the input is bounded to
  // `MAX_MATCH_INPUT` ("eval", fail closed; PR-LDC-13, R1-D-71).
  const m = matchesUse(parsed.ast);
  if (m === "refused") return { ok: false, error: "limit" };
  if (m === "used" && !stringsWithin(input, MAX_MATCH_INPUT)) return { ok: false, error: "eval" };
  try {
    const ctx =
      input && typeof input === "object" && !Array.isArray(input) ? toCelValues(input) : {};
    return { ok: true, value: fromCel(parsed(ctx as Record<string, unknown>)) };
  } catch {
    return { ok: false, error: "eval" };
  }
}

/** Whether an expression calls `matches`, and whether every such call has an accepted pattern. */
function matchesUse(ast: ASTNode): "none" | "used" | "refused" {
  let used = false;
  let bad = false;
  const visit = (x: unknown, depth: number): void => {
    if (bad || !x || typeof x !== "object") return;
    if (depth > 1000) {
      bad = true;
      return;
    }
    if (Array.isArray(x)) {
      for (const y of x) visit(y, depth + 1);
      return;
    }
    const node = x as { op?: unknown; args?: unknown };
    if (typeof node.op !== "string") {
      for (const y of Object.values(x)) visit(y, depth + 1);
      return;
    }
    if ((node.op === "rcall" || node.op === "call") && Array.isArray(node.args)) {
      const args = node.args as unknown[];
      if (args[0] === "matches") {
        used = true;
        // Receiver form: [name, receiver, [pattern]]; global form: [name, [text, pattern]].
        const argv = node.op === "rcall" ? args[2] : args[1];
        const pat = Array.isArray(argv)
          ? (argv[argv.length - 1] as ASTNode | undefined)
          : undefined;
        if (!pat || pat.op !== "value" || typeof pat.args !== "string" || patternRefusal(pat.args))
          bad = true;
      }
    }
    visit(node.args, depth + 1);
  };
  visit(ast, 0);
  return bad ? "refused" : used ? "used" : "none";
}

function stringsWithin(v: unknown, max: number, depth = 0): boolean {
  if (typeof v === "string") return v.length <= max;
  if (depth > 100) return false;
  if (Array.isArray(v)) return v.every((x) => stringsWithin(x, max, depth + 1));
  if (v && typeof v === "object")
    return Object.values(v).every((x) => stringsWithin(x, max, depth + 1));
  return true;
}

/**
 * Declared rule inputs → CEL values by declared type: `integer` inputs become `bigint` (CEL `int`),
 * `number` inputs stay `double` even when integral, list elements follow `toCelValues`.
 */
export function celInput(
  fields: ReadonlyMap<string, RuleField>,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    const t = fields.get(k)?.type;
    out[k] = t === "integer" ? BigInt(v as number) : t === "list" ? toCelValues(v) : v;
  }
  return out;
}

/** JSON → CEL values: safe integers become `bigint` (CEL `int`), other numbers stay `double`. */
export function toCelValues(v: unknown): unknown {
  if (typeof v === "number") return Number.isSafeInteger(v) ? BigInt(v) : v;
  if (Array.isArray(v)) return v.map(toCelValues);
  if (v && typeof v === "object")
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toCelValues(x)]));
  return v;
}

function fromCel(v: unknown): unknown {
  if (typeof v === "bigint") return Number.isSafeInteger(Number(v)) ? Number(v) : v.toString();
  if (Array.isArray(v)) return v.map(fromCel);
  if (v instanceof Map) return Object.fromEntries([...v].map(([k, x]) => [String(k), fromCel(x)]));
  if (v && typeof v === "object" && v.constructor === Object)
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fromCel(x)]));
  return v;
}
