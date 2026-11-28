// Register definitions (regulatory templates item (a), part 1; plan §3 (a); ADR-0016, R1-D-322).
// One definition drives a register's columns everywhere: the layout check against a filed sheet
// or an uploaded workbook, row validation, the list view and the export (`@infrabyx/export`
// `registerExport`). The row store itself is `@infrabyx/registers` (part 2).
//
// - A column has a `key` (unique in its sheet), a `label` (the filed header text; a sheet may
//   repeat a label, as OUT-A01 does), a type, `required`, its 1-based `order`, an optional
//   `source` (where the product's own data comes from) and a data class (never SECRET).
// - `assertLayout` compares a sheet's headers with the definition: the same labels in the same
//   order, nothing missing, nothing extra. Every problem is named; nothing is guessed.
// - Retention is at least eight years (the filed templates' floor; owner answer 2, R1-D-301).
import { z } from "zod";
import { DataClass } from "./data-class.js";

export const REGISTER_COLUMN_TYPES = [
  "text",
  "number",
  "integer",
  "boolean",
  "date",
  "datetime",
  "enum",
] as const;
export type RegisterColumnType = (typeof REGISTER_COLUMN_TYPES)[number];

/** The shortest retention a register may have, in years (owner answer 2, R1-D-301). */
export const REGISTER_RETENTION_FLOOR_YEARS = 8;
export const REGISTER_MAX_SHEETS = 32;
export const REGISTER_MAX_COLUMNS = 64;
export const REGISTER_LABEL_MAX = 120;

const KEY = /^[a-z][a-z0-9_]{0,62}$/;
/** A template code as filed (`CA-A01`, `ABAC-A01`) or a product's own. */
export const REGISTER_CODE = /^[A-Z][A-Z0-9]{0,9}(-[A-Z0-9]{1,10}){0,4}$/;
const SHEET_NAME_FORBIDDEN = /[[\]:*?/\\]/;

export const RegisterColumn = z
  .object({
    key: z.string().regex(KEY),
    label: z.string().trim().min(1).max(REGISTER_LABEL_MAX),
    type: z.enum(REGISTER_COLUMN_TYPES),
    required: z.boolean(),
    order: z.number().int().min(1).max(REGISTER_MAX_COLUMNS),
    /** Where the product's own data for this column comes from (a field path); never data. */
    source: z.string().min(1).max(200).optional(),
    /** The allowed values of an `enum` column; only there. */
    enum: z.array(z.string().min(1).max(REGISTER_LABEL_MAX)).min(1).max(200).optional(),
    dataClass: DataClass.exclude(["SECRET"]),
  })
  .strict()
  .refine((c) => (c.type === "enum") === (c.enum !== undefined), {
    message: "an enum column, and only an enum column, lists its values",
  })
  .refine((c) => !c.enum || new Set(c.enum).size === c.enum.length, {
    message: "enum values are unique",
  });
export type RegisterColumn = z.infer<typeof RegisterColumn>;

export const RegisterSheet = z
  .object({
    name: z
      .string()
      .min(1)
      .max(31)
      .refine((n) => !SHEET_NAME_FORBIDDEN.test(n) && !n.startsWith("'") && !n.endsWith("'"), {
        message: "a sheet name has none of []:*?/\\ and does not start or end with '",
      }),
    columns: z.array(RegisterColumn).min(1).max(REGISTER_MAX_COLUMNS),
  })
  .strict()
  .refine((s) => new Set(s.columns.map((c) => c.key)).size === s.columns.length, {
    message: "column keys are unique in a sheet",
  })
  .refine(
    (s) =>
      s.columns
        .map((c) => c.order)
        .sort((a, b) => a - b)
        .every((o, i) => o === i + 1),
    { message: "column orders run 1 to n with no gap or repeat" },
  );
export type RegisterSheet = z.infer<typeof RegisterSheet>;

export const RegisterDefinition = z
  .object({
    code: z.string().regex(REGISTER_CODE),
    title: z.string().trim().min(1).max(200),
    /** The definition's own version; a change of columns is a new version. */
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    sheets: z.array(RegisterSheet).min(1).max(REGISTER_MAX_SHEETS),
    retention: z
      .object({ years: z.number().int().min(REGISTER_RETENTION_FLOOR_YEARS).max(100) })
      .strict(),
  })
  .strict()
  .refine((d) => new Set(d.sheets.map((s) => s.name.toLowerCase())).size === d.sheets.length, {
    message: "sheet names are unique (any case)",
  });
export type RegisterDefinition = z.infer<typeof RegisterDefinition>;

/** A filed sheet's layout (a `template index.json` record's `sheets[]`) or an uploaded one. */
export interface SheetLayout {
  name: string;
  cols: readonly string[];
}

export type RegisterLayoutReason =
  "sheet_missing" | "sheet_unknown" | "column_missing" | "column_unknown" | "column_order";

export interface RegisterLayoutProblem {
  reason: RegisterLayoutReason;
  sheet: string;
  /** The labels concerned (both of a swapped pair). */
  columns: string[];
  /** Whether a missing column is a required one. */
  required?: boolean;
}

/** A layout or a row that does not match its definition (422); every problem is listed. */
export class RegisterError extends Error {
  readonly status = 422;
  constructor(
    readonly reason: "layout_mismatch" | "row_invalid" | "definition_invalid",
    readonly problems: readonly (RegisterLayoutProblem | RegisterRowProblem)[],
  ) {
    super(`${reason}: ${problems.length} problem(s)`);
    this.name = "RegisterError";
  }
}

/** A sheet's columns in their order. */
export const orderedColumns = (s: RegisterSheet): RegisterColumn[] =>
  [...s.columns].sort((a, b) => a.order - b.order);

const norm = (s: string) => s.trim();

/** The problems of one sheet's headers against its definition (exact labels, exact order). */
export function layoutProblems(sheet: RegisterSheet, layout: SheetLayout): RegisterLayoutProblem[] {
  const want = orderedColumns(sheet);
  const got = layout.cols.map(norm);
  const problems: RegisterLayoutProblem[] = [];
  const count = (xs: readonly string[]) => {
    const m = new Map<string, number>();
    for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
    return m;
  };
  const wantCount = count(want.map((c) => norm(c.label)));
  const gotCount = count(got);
  for (const c of want) {
    const l = norm(c.label);
    if (
      (gotCount.get(l) ?? 0) < (wantCount.get(l) ?? 0) &&
      !problems.some((p) => p.columns[0] === l)
    )
      problems.push({
        reason: "column_missing",
        sheet: sheet.name,
        columns: [l],
        required: c.required,
      });
  }
  for (const [l, n] of gotCount)
    if (n > (wantCount.get(l) ?? 0))
      problems.push({ reason: "column_unknown", sheet: sheet.name, columns: [l] });
  if (!problems.length) {
    // Same labels, same counts: any difference now is order. Name each out-of-place pair.
    const seen = new Set<string>();
    for (let i = 0; i < want.length; i++) {
      const w = norm(want[i]!.label);
      const g = got[i]!;
      if (w === g) continue;
      const pair = [w, g].sort().join("\u0000");
      if (seen.has(pair)) continue;
      seen.add(pair);
      problems.push({ reason: "column_order", sheet: sheet.name, columns: [w, g] });
    }
  }
  return problems;
}

/**
 * Refuse (`RegisterError` `layout_mismatch`) unless every sheet of the definition is in `layouts`
 * (by exact name) with exactly its labels in order, and no other sheet is. Pass `sheets` to check
 * only some of the definition's sheets (an upload of one sheet).
 */
export function assertLayout(
  def: RegisterDefinition,
  layouts: readonly SheetLayout[],
  o: { sheets?: readonly string[] } = {},
): void {
  const d = RegisterDefinition.parse(def);
  const wanted = o.sheets ? d.sheets.filter((s) => o.sheets!.includes(s.name)) : d.sheets;
  const problems: RegisterLayoutProblem[] = [];
  for (const name of o.sheets ?? [])
    if (!d.sheets.some((s) => s.name === name))
      problems.push({ reason: "sheet_unknown", sheet: name, columns: [] });
  for (const s of wanted) {
    const l = layouts.find((x) => x.name === s.name);
    if (!l) problems.push({ reason: "sheet_missing", sheet: s.name, columns: [] });
    else problems.push(...layoutProblems(s, l));
  }
  for (const l of layouts)
    if (!wanted.some((s) => s.name === l.name))
      problems.push({ reason: "sheet_unknown", sheet: l.name, columns: [] });
  if (problems.length) throw new RegisterError("layout_mismatch", problems);
}

/** A register column key from a filed label: lower-case words joined by `_`, ASCII only. */
export function columnKey(label: string): string {
  const k = label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/₹/g, " inr ")
    .replace(/%/g, " pct ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
  return /^[a-z]/.test(k) ? k : `c_${k || "col"}`.slice(0, 50);
}

/**
 * A first definition from a `template index.json` record: every column `text`, not required,
 * CONFIDENTIAL (the safe default; a product narrows it), in the filed order, keys from the labels
 * (made unique). A product then sets types, `required`, sources and data classes, and gives it a
 * version. The filed layout always passes `assertLayout` against it.
 */
export function definitionFromIndex(
  record: { code: string; title: string; sheets: readonly SheetLayout[] },
  o: { version?: string; retentionYears?: number } = {},
): RegisterDefinition {
  return RegisterDefinition.parse({
    code: record.code,
    title: record.title,
    version: o.version ?? "0.1.0",
    retention: { years: o.retentionYears ?? REGISTER_RETENTION_FLOOR_YEARS },
    sheets: record.sheets.map((s) => {
      const used = new Set<string>();
      return {
        name: s.name,
        columns: s.cols.map((label, i) => {
          const base = columnKey(label);
          let key = base;
          for (let n = 2; used.has(key); n++) key = `${base.slice(0, 46)}_${n}`;
          used.add(key);
          return {
            key,
            label: label.trim(),
            type: "text" as const,
            required: false,
            order: i + 1,
            dataClass: "CONFIDENTIAL" as const,
          };
        }),
      };
    }),
  });
}

export interface RegisterRowProblem {
  reason: "required" | "type" | "enum" | "unknown_key";
  column: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (s: string) =>
  ISO_DATE.test(s) &&
  !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) &&
  new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/** One value against its column: the problem, or null. Empty (`null`, `undefined`, "") is absent. */
function valueProblem(c: RegisterColumn, v: unknown): RegisterRowProblem["reason"] | null {
  if (v === null || v === undefined || v === "") return c.required ? "required" : null;
  switch (c.type) {
    case "text":
      return typeof v === "string" && v.length <= 10_000 ? null : "type";
    case "number":
      return typeof v === "number" && Number.isFinite(v) ? null : "type";
    case "integer":
      return typeof v === "number" && Number.isSafeInteger(v) ? null : "type";
    case "boolean":
      return typeof v === "boolean" ? null : "type";
    case "date":
      return typeof v === "string" && validDate(v) ? null : "type";
    case "datetime":
      return typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v))
        ? null
        : "type";
    case "enum":
      return typeof v === "string" && c.enum!.includes(v) ? null : "enum";
  }
}

/** The problems of one row of `sheet` (keyed by column key); an unknown key is a problem. */
export function rowProblems(
  sheet: RegisterSheet,
  row: Readonly<Record<string, unknown>>,
): RegisterRowProblem[] {
  const out: RegisterRowProblem[] = [];
  for (const c of orderedColumns(sheet)) {
    const p = valueProblem(c, row[c.key]);
    if (p) out.push({ reason: p, column: c.key });
  }
  for (const k of Object.keys(row))
    if (!sheet.columns.some((c) => c.key === k)) out.push({ reason: "unknown_key", column: k });
  return out;
}

/** Refuse (`RegisterError` `row_invalid`) a row with any problem. */
export function assertRow(sheet: RegisterSheet, row: Readonly<Record<string, unknown>>): void {
  const p = rowProblems(sheet, row);
  if (p.length) throw new RegisterError("row_invalid", p);
}

/** The definition's sheet by name, or a `definition_invalid` refusal. */
export function registerSheet(def: RegisterDefinition, name: string): RegisterSheet {
  const s = def.sheets.find((x) => x.name === name);
  if (!s)
    throw new RegisterError("definition_invalid", [
      { reason: "sheet_unknown", sheet: name, columns: [] },
    ]);
  return s;
}
