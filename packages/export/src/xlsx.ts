// XLSX writer (PR-LDC-28, M59): an Office Open XML workbook (SpreadsheetML, ECMA-376 Part 1)
// written over the package's own ZIP writer, with no dependency. One header row (bold, frozen) and
// typed cells per sheet; strings are inline (`t="inlineStr"`) and pass through `neutraliseFormula`
// as `toCsv` defines it, so a cell is never a formula and never starts with a formula trigger. Text
// is XML-escaped and stripped of characters XML 1.0 cannot carry; numbers are finite only; dates
// are Excel serials (1900 date system, UTC) with a `yyyy-mm-dd` or `yyyy-mm-dd hh:mm:ss` style.
// The same sheets and `created` time always give the same bytes.
//
// PR-LDC-31 (M81, R1-D-114) adds, still with no dependency: column widths; data validations per
// column (lists, whole and decimal ranges, date ranges, text length), written from typed values
// only, never from a caller's formula text; workbook-level named ranges; and sheet protection as
// lock flags with editable columns. Protection never takes a password: Excel's sheet password is a
// UI guard, not a control, so the platform does not pretend otherwise. A workbook that uses none of
// these is byte-for-byte what the wave 6 writer produced.
//
// PR-LDC-52 (M100, R1-D-207) adds, still with no dependency: frozen columns, AutoFilter, row outline
// levels, column, header and row fills, page set-up (paper, orientation, fit to width, repeated
// header, print area), typed conditional formats whose expressions the writer builds itself, and
// typed formula cells. A formula is only ever an `XlsxFormula` made by `xlsxFormula` in this process
// (recognised by identity, never by shape), checked for external references, DDE and functions that
// reach outside the workbook; string cells keep `neutraliseFormula`. A workbook that uses none of
// these is byte-for-byte what the writer produced before.
import { cellText, neutraliseFormula } from "./csv.js";
import {
  ByteBudget,
  CT_CORE,
  OfficeExportError,
  REL_CORE,
  REL_OFFICE,
  XML_DECL,
  contentTypesXml,
  coreXml,
  createdOf,
  dropInvalidXml,
  maxBytesOf,
  packParts,
  relsXml,
  xmlAttr,
  xmlText,
  type OfficeProperties,
} from "./ooxml.js";

/** Excel's grid: 1 048 576 rows (the header is one of them) and 16 384 columns. */
export const XLSX_MAX_ROWS = 1_048_576;
export const XLSX_MAX_COLUMNS = 16_384;
/** Excel's limit on the characters of one cell. */
export const XLSX_MAX_CELL_CHARS = 32_767;
/** Sheets per workbook (a platform limit; Excel's is memory). */
export const XLSX_MAX_SHEETS = 255;

export type XlsxColumnType = "string" | "number" | "integer" | "boolean" | "date" | "datetime";

export interface XlsxColumn {
  /** The header cell text. */
  header: string;
  type: XlsxColumnType;
  /** The property read from an object row (default `header`); array rows are read by position. */
  key?: string;
  /** Column width in characters, 1 to 255 (Excel's limit); default Excel's own. */
  width?: number;
  /** A data validation on this column's data rows (see `XlsxSheet.validationRows`). */
  validation?: XlsxValidation;
  /** On a protected sheet, the column's cells stay editable (unlocked); ignored when unprotected. */
  editable?: boolean;
  /** A solid fill on the column's data cells (a row's `rowLayout` fill wins). */
  fill?: XlsxColor;
}

/** A colour as six hex digits, `RRGGBB`. */
export type XlsxColor = string;

/** The layout of one data row. */
export interface XlsxRowLayout {
  /** Row outline (grouping) level, 0 to 7 (Excel's limit). */
  outlineLevel?: number;
  /** A solid fill on the row's cells (wins over a column fill). */
  fill?: XlsxColor;
}

/** Print set-up of a sheet. */
export interface XlsxPageSetup {
  /** Default A4. */
  paper?: "A4" | "A3" | "letter" | "legal";
  /** Default portrait. */
  orientation?: "portrait" | "landscape";
  /** Every column on one page wide, any number of pages tall. */
  fitToWidth?: boolean;
  /** Print the header row on every page. */
  repeatHeader?: boolean;
  /** An A1 range inside the grid, or `true` for the header and data rows. */
  printArea?: string | true;
}

/** A typed value a conditional format compares with; `{ today: n }` is today plus n days. */
export type XlsxConditionValue = number | string | boolean | { today: number };

export type XlsxConditionWhen =
  | { op: "lt" | "le" | "gt" | "ge" | "eq" | "ne"; value: XlsxConditionValue }
  | { op: "between" | "notBetween"; min: XlsxConditionValue; max: XlsxConditionValue }
  | { op: "containsText"; text: string }
  | { op: "blank" | "notBlank" };

/** The style a matching cell takes (at least one property). */
export interface XlsxConditionStyle {
  fill?: XlsxColor;
  fontColor?: XlsxColor;
  bold?: boolean;
}

/**
 * A conditional format from typed parts only: the writer builds the expression. `column` names the
 * tested column by its `key` or header; the rule covers that column's data rows, or the whole row
 * when `wholeRow` (the rows the validations cover: `validationRows`, else the data rows).
 */
export interface XlsxConditionalFormat {
  column: string;
  when: XlsxConditionWhen;
  style: XlsxConditionStyle;
  wholeRow?: boolean;
  stopIfTrue?: boolean;
}

/** A formula cell: only one made by `xlsxFormula` counts (see there). */
export interface XlsxFormula {
  readonly formula: string;
  readonly result?: number | string | boolean | Date;
}

/** Shown when a cell is selected (`prompt`) or when a value is refused (`error`). */
export interface XlsxMessage {
  /** At most 32 characters (Excel's limit). */
  title?: string;
  /** At most 255 characters (Excel's limit). */
  message: string;
}

interface XlsxValidationBase {
  /** A blank cell passes (default true). */
  allowBlank?: boolean;
  prompt?: XlsxMessage;
  error?: XlsxMessage;
}

/**
 * A data validation, written from typed values only. A `list` takes either literal `values` (at
 * most 255 characters joined, none containing a comma or a double quote, Excel's inline-list
 * rule) or `namedRange`, the name of a range defined with `XlsxOptions.namedRanges`.
 */
export type XlsxValidation = XlsxValidationBase &
  (
    | { type: "list"; values: readonly string[] }
    | { type: "list"; namedRange: string }
    | { type: "whole" | "decimal"; min?: number; max?: number }
    | { type: "date"; min?: string; max?: string }
    | { type: "textLength"; min?: number; max: number }
  );

/** Sheet protection as lock flags; every flag not set to `true` stays locked. */
export interface XlsxProtection {
  /** Allow sorting (on cells the user can edit). */
  sort?: boolean;
  /** Allow AutoFilter use. */
  autoFilter?: boolean;
  /** Allow formatting cells, columns and rows. */
  formatCells?: boolean;
  formatColumns?: boolean;
  formatRows?: boolean;
  /** Allow inserting and deleting rows. */
  insertRows?: boolean;
  deleteRows?: boolean;
  /** Allow selecting locked cells (default true, as Excel). */
  selectLockedCells?: boolean;
}

/** A workbook-level defined name over a rectangular range of one sheet. */
export interface XlsxNamedRange {
  /** Letters, digits, `_` and `.`, starting with a letter or `_`, at most 255; never a cell reference. */
  name: string;
  /** The sheet's name, as in `XlsxSheet.name`. */
  sheet: string;
  /** `A2:A50` or `B3`, inside Excel's grid. */
  range: string;
}

export type XlsxRow = ReadonlyArray<unknown> | Readonly<Record<string, unknown>>;

export interface XlsxSheet {
  /** 1 to 31 characters, none of `[]:*?/\`, not starting or ending with `'`, unique (any case). */
  name: string;
  columns: readonly XlsxColumn[];
  rows: readonly XlsxRow[];
  /**
   * How many rows below the header the column validations cover (default the data rows, at least
   * one), so a template can carry empty validated input rows.
   */
  validationRows?: number;
  /** Protect the sheet with these lock flags (no password); `editable` columns stay unlocked. */
  protection?: XlsxProtection;
  /** Freeze the first n columns as well as the header row (0 to the column count, at most 16 383). */
  freezeColumns?: number;
  /** An AutoFilter over the header and data rows. */
  autoFilter?: boolean;
  /** A solid fill on the header row. */
  headerFill?: XlsxColor;
  /** Per data row (index 0 is the row under the header): outline level and fill. */
  rowLayout?: ReadonlyArray<XlsxRowLayout | null | undefined>;
  /** Where an outline group's summary row sits (default `below`, as Excel). */
  outlineSummary?: "below" | "above";
  page?: XlsxPageSetup;
  conditionalFormats?: readonly XlsxConditionalFormat[];
}

export interface XlsxOptions extends OfficeProperties {
  namedRanges?: readonly XlsxNamedRange[];
}

const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const CT_WORKBOOK = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";
const CT_SHEET = "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml";
const CT_STYLES = "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml";
const TYPES: ReadonlySet<string> = new Set([
  "string",
  "number",
  "integer",
  "boolean",
  "date",
  "datetime",
]);

// cellXfs indexes in styles.xml; the unlocked copies (4 to 6) exist only when a sheet has an
// editable column, so a workbook without one keeps the wave 6 bytes.
const S_DATE = 1;
const S_DATETIME = 2;
const S_HEADER = 3;
const S_UNLOCKED = 4;

const STYLE_HEAD =
  XML_DECL +
  `<styleSheet xmlns="${NS_MAIN}">` +
  '<numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/>' +
  '<numFmt numFmtId="165" formatCode="yyyy-mm-dd hh:mm:ss"/></numFmts>' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  "";
const XF_BASE =
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>';
const UNLOCKED = '<protection locked="0"/></xf>';
const XF_UNLOCKED =
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyProtection="1">${UNLOCKED}` +
  `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyProtection="1">${UNLOCKED}` +
  `<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyProtection="1">${UNLOCKED}`;
const STYLE_TAIL =
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  "</styleSheet>";

/** A colour as SpreadsheetML's opaque ARGB. */
const argb = (c: string) => `FF${c.toUpperCase()}`;
const solid = (c: string) =>
  `<fill><patternFill patternType="solid"><fgColor rgb="${argb(c)}"/><bgColor indexed="64"/></patternFill></fill>`;
const BASE_FMT = [0, 164, 165, 0] as const;

/**
 * The workbook's cell styles. Indexes 0 to 3 (and 4 to 6 with an editable column) are fixed; a fill
 * adds a fill and a cell style after them, and a conditional format a `dxf`, in first-use order, so
 * the same input gives the same bytes and a workbook without them keeps the earlier styles part.
 */
class Styles {
  private readonly fills: string[] = [];
  private readonly xfs: string[] = [];
  private readonly dxfs: string[] = [];
  private readonly index = new Map<string, number>();
  constructor(private readonly unlocked: boolean) {}

  /** The style of a cell: `base` 0 normal, 1 date, 2 datetime, 3 header. */
  cell(base: 0 | 1 | 2 | 3, fill: string | undefined, open: boolean): number {
    if (fill === undefined) return base === 3 ? S_HEADER : open ? unlockedOf(base) : base;
    const key = `x|${base}|${fill}|${open ? 1 : 0}`;
    const known = this.index.get(key);
    if (known !== undefined) return known;
    let fillId = this.fills.indexOf(fill);
    if (fillId < 0) fillId = this.fills.push(fill) - 1;
    const fmt = BASE_FMT[base];
    const xf =
      `<xf numFmtId="${fmt}" fontId="${base === 3 ? 1 : 0}" fillId="${fillId + 2}" borderId="0" xfId="0"` +
      (fmt ? ' applyNumberFormat="1"' : "") +
      (base === 3 ? ' applyFont="1"' : "") +
      ' applyFill="1"' +
      (open ? ` applyProtection="1">${UNLOCKED}` : "/>");
    const i = (this.unlocked ? 7 : 4) + this.xfs.push(xf) - 1;
    this.index.set(key, i);
    return i;
  }

  /** The `dxf` of a conditional format's style. */
  dxf(st: XlsxConditionStyle): number {
    const font =
      st.bold === true || st.fontColor !== undefined
        ? `<font>${st.bold === true ? "<b/>" : ""}${st.fontColor !== undefined ? `<color rgb="${argb(st.fontColor)}"/>` : ""}</font>`
        : "";
    const fill =
      st.fill !== undefined
        ? `<fill><patternFill patternType="solid"><bgColor rgb="${argb(st.fill)}"/></patternFill></fill>`
        : "";
    const xml = `<dxf>${font}${fill}</dxf>`;
    const known = this.dxfs.indexOf(xml);
    return known >= 0 ? known : this.dxfs.push(xml) - 1;
  }

  xml(): string {
    const base = this.unlocked ? `${XF_BASE}${XF_UNLOCKED}` : XF_BASE;
    const count = (this.unlocked ? 7 : 4) + this.xfs.length;
    let head = STYLE_HEAD;
    if (this.fills.length)
      head = head.replace(
        /<fills count="2">(.*?)<\/fills>/,
        (_m, inner: string) =>
          `<fills count="${2 + this.fills.length}">${inner}${this.fills.map(solid).join("")}</fills>`,
      );
    const tail = this.dxfs.length
      ? STYLE_TAIL.replace(
          "</styleSheet>",
          `<dxfs count="${this.dxfs.length}">${this.dxfs.join("")}</dxfs></styleSheet>`,
        )
      : STYLE_TAIL;
    return `${head}<cellXfs count="${count}">${base}${this.xfs.join("")}</cellXfs>${tail}`;
  }
}

/** The unlocked copy of a data style (0 normal, 1 date, 2 datetime). */
const unlockedOf = (style: number) => S_UNLOCKED + style;

/** Column letters of a 0-based index (0 → A, 25 → Z, 26 → AA). */
export function xlsxColumnName(i: number): string {
  let n = i + 1;
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Refuse a sheet name Excel would not accept. */
export function assertSheetName(name: unknown): asserts name is string {
  const bad = (why: string) =>
    new OfficeExportError("sheet_name_invalid", `sheet name ${JSON.stringify(name)} ${why}`);
  if (typeof name !== "string" || name.length === 0) throw bad("must be a non-empty string");
  if (name.length > 31) throw bad("is longer than 31 characters");
  if (/[[\]:*?/\\]/.test(name)) throw bad("contains one of []:*?/\\");
  if (name.startsWith("'") || name.endsWith("'")) throw bad("starts or ends with an apostrophe");
  if (dropInvalidXml(name) !== name || /[\t\n\r]/.test(name))
    throw bad("contains a control character");
  if (name.toLowerCase() === "history") throw bad("is reserved by Excel");
}

// Excel serial day 0 is 1899-12-30 in the 1900 date system; serials are right from 1900-03-01
// (day 61), past the 1900 leap-year bug, so earlier dates are refused.
const EPOCH = Date.UTC(1899, 11, 30);
const MIN_DATE = Date.UTC(1900, 2, 1);
const MAX_DATE = Date.UTC(10000, 0, 1) - 1;
const DAY = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;
const DECIMAL_RE = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

function instant(v: unknown): number | null {
  if (v instanceof Date) return v.getTime();
  if (typeof v !== "string") return null;
  const m = DATE_RE.exec(v);
  if (m) {
    const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    // Refuse a day that rolls over (2026-02-30).
    return new Date(t).toISOString().slice(0, 10) === v ? t : null;
  }
  return DATETIME_RE.test(v) ? Date.parse(v) : null;
}

function numberOf(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "bigint") {
    const n = Number(v);
    return Number.isSafeInteger(n) ? n : null;
  }
  if (typeof v === "string" && DECIMAL_RE.test(v)) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function inlineStr(ref: string, text: string, style = 0): string {
  const t = neutraliseFormula(dropInvalidXml(text));
  if (t.length > XLSX_MAX_CELL_CHARS)
    throw new OfficeExportError(
      "cell_too_long",
      `cell ${ref} has more than ${XLSX_MAX_CELL_CHARS} characters`,
    );
  const s = style ? ` s="${style}"` : "";
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlText(t)}</t></is></c>`;
}

/** Excel's limit on the characters of a formula. */
export const XLSX_MAX_FORMULA_CHARS = 8192;
/**
 * Functions a formula may not call: they fetch from or link outside the workbook, run code, or
 * reveal the workbook and its environment (`INFO`, `CELL`: the file's path, the operating system,
 * the directory; owner answer #156), with or without the `_xlfn.` / `_xlws.` prefix. A `|`
 * outside string literals (a DDE link such as `cmd|' /C …'!A0`) is refused separately.
 */
export const XLSX_BLOCKED_FUNCTIONS: readonly string[] = [
  "WEBSERVICE",
  "IMAGE",
  "HYPERLINK",
  "RTD",
  "CALL",
  "REGISTER",
  "REGISTER.ID",
  "EXEC",
  "STOCKHISTORY",
  "INFO",
  "CELL",
];
const BLOCKED_RE = new RegExp(
  `(?:^|[^A-Za-z0-9_.])(?:_xlfn\\.|_xlws\\.)?(?:${XLSX_BLOCKED_FUNCTIONS.map((f) => f.replace(".", "\\.")).join("|")})\\s*\\(`,
  "i",
);

/** Formulas made by `xlsxFormula` in this process: a value of the same shape from data is never one. */
const FORMULAS = new WeakSet<object>();

const formulaBad = (why: string) => new OfficeExportError("formula_invalid", `formula: ${why}`);

/** The formula with its string literals blanked; refuses an unterminated literal. */
function outsideLiterals(f: string): string {
  let out = "";
  let inside = false;
  for (let i = 0; i < f.length; i++) {
    const ch = f[i]!;
    if (ch === '"') {
      if (inside && f[i + 1] === '"') {
        i += 1;
        continue;
      }
      inside = !inside;
      out += " ";
    } else out += inside ? " " : ch;
  }
  if (inside) throw formulaBad("an unterminated string literal");
  return out;
}

/**
 * A formula cell from the product, written as `<f>` in any column. The formula is SpreadsheetML's
 * text without a leading `=` (`SUM(B2:B9)`), 1 to 8 192 characters; outside its string literals it
 * may not hold `[` or `]` (external workbook references) or `|` (DDE), nor call a function in
 * `XLSX_BLOCKED_FUNCTIONS`. `result`, of the column's type, is written as the cached value; Excel
 * recalculates every formula on load in any case. Only an object this function returns is a
 * formula: a string, or a plain object from data shaped the same way, is written as text (or
 * refused by its column) as before.
 */
export function xlsxFormula(
  formula: string,
  o: { result?: number | string | boolean | Date } = {},
): XlsxFormula {
  if (typeof formula !== "string" || formula.length === 0)
    throw formulaBad("must be non-empty text");
  if (formula.length > XLSX_MAX_FORMULA_CHARS)
    throw formulaBad(`is longer than ${XLSX_MAX_FORMULA_CHARS} characters`);
  if (formula.startsWith("=")) throw formulaBad("is written without a leading =");
  if (dropInvalidXml(formula) !== formula) throw formulaBad("holds a control character");
  const code = outsideLiterals(formula);
  if (/[[\]]/.test(code)) throw formulaBad("refers outside the workbook ([ or ])");
  // A `|` outside string literals is a DDE link to another application (owner answer #156).
  if (code.includes("|")) throw formulaBad("holds a | outside a string literal (DDE)");
  if (BLOCKED_RE.test(code)) throw formulaBad("calls a function that reaches outside the workbook");
  const r = o.result;
  if (
    r !== undefined &&
    !(typeof r === "string" || typeof r === "boolean" || r instanceof Date || finite(r))
  )
    throw formulaBad("result must be a finite number, text, a boolean or a Date");
  const f: XlsxFormula = Object.freeze(r === undefined ? { formula } : { formula, result: r });
  FORMULAS.add(f);
  return f;
}

/** True only for a formula `xlsxFormula` made. */
export const isXlsxFormula = (v: unknown): v is XlsxFormula =>
  typeof v === "object" && v !== null && FORMULAS.has(v);

const baseOf = (t: XlsxColumnType): 0 | 1 | 2 =>
  t === "date" ? S_DATE : t === "datetime" ? S_DATETIME : 0;

function cell(
  sheet: string,
  col: XlsxColumn,
  ref: string,
  v: unknown,
  styleOf: (base: 0 | 1 | 2) => number,
  filled: boolean,
): string {
  const sAttr = (base: 0 | 1 | 2) => {
    const s = styleOf(base);
    return s ? ` s="${s}"` : "";
  };
  if (v === null || v === undefined)
    return filled ? `<c r="${ref}"${sAttr(baseOf(col.type))}/>` : "";
  const bad = (why: string) =>
    new OfficeExportError(
      "cell_invalid",
      `sheet ${JSON.stringify(sheet)} cell ${ref} (${JSON.stringify(col.header)}, ${col.type}): ${why}`,
    );
  if (isXlsxFormula(v)) return formulaCell(col, ref, v, sAttr(baseOf(col.type)), bad);
  switch (col.type) {
    case "string":
      return inlineStr(ref, cellText(v), styleOf(0));
    case "number":
    case "integer": {
      const n = numberOf(v);
      if (n === null) throw bad("not a finite number");
      if (col.type === "integer" && !Number.isSafeInteger(n)) throw bad("not a safe integer");
      return `<c r="${ref}"${sAttr(0)}><v>${String(n)}</v></c>`;
    }
    case "boolean":
      if (typeof v !== "boolean") throw bad("not a boolean");
      return `<c r="${ref}"${sAttr(0)} t="b"><v>${v ? 1 : 0}</v></c>`;
    case "date":
    case "datetime":
      return `<c r="${ref}"${sAttr(baseOf(col.type))}><v>${String(serialOf(col.type, v, bad))}</v></c>`;
  }
}

function serialOf(type: "date" | "datetime", v: unknown, bad: (why: string) => Error): number {
  const t = instant(v);
  if (t === null || Number.isNaN(t)) throw bad("not a date (Date or ISO 8601 with offset)");
  if (t < MIN_DATE || t > MAX_DATE) throw bad("outside 1900-03-01 to 9999-12-31");
  return type === "date" ? Math.floor((t - EPOCH) / DAY) : (t - EPOCH) / DAY;
}

/** `<c><f>…</f><v>cached</v></c>`; the cached result must fit the column's type. */
function formulaCell(
  col: XlsxColumn,
  ref: string,
  f: XlsxFormula,
  s: string,
  bad: (why: string) => Error,
): string {
  const fx = `<f>${xmlText(f.formula)}</f>`;
  const r = f.result;
  switch (col.type) {
    case "string": {
      if (r !== undefined && typeof r !== "string") throw bad("formula result is not text");
      const t = r === undefined ? undefined : dropInvalidXml(r);
      if (t !== undefined && t.length > XLSX_MAX_CELL_CHARS)
        throw bad("formula result is too long");
      return `<c r="${ref}"${s} t="str">${fx}${t === undefined ? "" : `<v>${xmlText(t)}</v>`}</c>`;
    }
    case "boolean":
      if (r !== undefined && typeof r !== "boolean") throw bad("formula result is not a boolean");
      return `<c r="${ref}"${s} t="b">${fx}${r === undefined ? "" : `<v>${r ? 1 : 0}</v>`}</c>`;
    case "number":
    case "integer": {
      if (r !== undefined && !finite(r)) throw bad("formula result is not a finite number");
      if (col.type === "integer" && r !== undefined && !Number.isSafeInteger(r))
        throw bad("formula result is not a safe integer");
      return `<c r="${ref}"${s}>${fx}${r === undefined ? "" : `<v>${String(r)}</v>`}</c>`;
    }
    case "date":
    case "datetime":
      return `<c r="${ref}"${s}>${fx}${r === undefined ? "" : `<v>${String(serialOf(col.type, r, bad))}</v>`}</c>`;
  }
}

const CELL_RE = /^([A-Z]{1,3})([1-9][0-9]{0,6})$/;
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_.]{0,254}$/;
// A defined name may not look like an A1 or R1C1 reference (Excel refuses it or misreads it).
const LOOKS_LIKE_REF = /^(?:[A-Za-z]{1,3}[0-9]+|[Rr][0-9]*[Cc][0-9]*|[RrCc])$/;

function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** `A2:B9` or `C3` to an absolute reference, refusing anything outside Excel's grid. */
function absoluteRange(range: unknown, what: string, reason = "named_range_invalid"): string {
  const bad = () =>
    new OfficeExportError(reason, `${what}: range ${JSON.stringify(range)} is invalid`);
  if (typeof range !== "string") throw bad();
  const ends = range.split(":");
  if (ends.length > 2) throw bad();
  const parts = ends.map((e) => {
    const m = CELL_RE.exec(e);
    if (!m) throw bad();
    const col = columnIndex(m[1]!);
    const row = Number(m[2]);
    if (col >= XLSX_MAX_COLUMNS || row > XLSX_MAX_ROWS) throw bad();
    return { col, row, abs: `$${m[1]}$${m[2]}` };
  });
  if (parts.length === 2 && (parts[1]!.col < parts[0]!.col || parts[1]!.row < parts[0]!.row))
    throw bad();
  return parts.map((p) => p.abs).join(":");
}

/** A sheet name as a formula reference: always quoted, an apostrophe doubled. */
const sheetRef = (name: string) => `'${name.replace(/'/g, "''")}'`;

function checkMessage(m: XlsxMessage | undefined, what: string): void {
  if (m === undefined) return;
  const bad = (why: string) => new OfficeExportError("validation_invalid", `${what}: ${why}`);
  if (typeof m !== "object" || m === null || typeof m.message !== "string")
    throw bad("needs a message");
  if (m.message.length > 255) throw bad("message is longer than 255 characters");
  if (m.title !== undefined && (typeof m.title !== "string" || m.title.length > 32))
    throw bad("title is longer than 32 characters");
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The `<dataValidation>` element for a column, or "" when it has none. */
function validationXml(
  v: XlsxValidation,
  sqref: string,
  what: string,
  names: ReadonlySet<string>,
): string {
  const bad = (why: string) => new OfficeExportError("validation_invalid", `${what}: ${why}`);
  checkMessage(v.prompt, `${what} prompt`);
  checkMessage(v.error, `${what} error`);
  let type: string;
  let operator = "";
  let f1: string;
  let f2 = "";
  const bounds = (lo: string | undefined, hi: string | undefined) => {
    if (lo !== undefined && hi !== undefined) {
      operator = "between";
      f1 = lo;
      f2 = hi;
    } else if (lo !== undefined) {
      operator = "greaterThanOrEqual";
      f1 = lo;
    } else if (hi !== undefined) {
      operator = "lessThanOrEqual";
      f1 = hi;
    } else throw bad("needs a min or a max");
  };
  switch (v.type) {
    case "list": {
      type = "list";
      if ("namedRange" in v) {
        if (typeof v.namedRange !== "string" || !names.has(v.namedRange.toLowerCase()))
          throw bad(`list names an undefined range ${JSON.stringify(v.namedRange)}`);
        f1 = v.namedRange;
      } else {
        if (!Array.isArray(v.values) || v.values.length === 0) throw bad("list needs values");
        for (const x of v.values)
          if (typeof x !== "string" || x.length === 0 || /[,"]/.test(x) || dropInvalidXml(x) !== x)
            throw bad(
              "a list value is empty or holds a comma, a double quote or a control character",
            );
        const joined = v.values.join(",");
        if (joined.length > 255) throw bad("list values are longer than 255 characters joined");
        f1 = `"${joined}"`;
      }
      break;
    }
    case "whole":
    case "decimal": {
      type = v.type;
      for (const b of [v.min, v.max])
        if (b !== undefined && (!finite(b) || (v.type === "whole" && !Number.isSafeInteger(b))))
          throw bad(
            `${v.type} bounds must be ${v.type === "whole" ? "safe integers" : "finite numbers"}`,
          );
      if (v.min !== undefined && v.max !== undefined && v.min > v.max)
        throw bad("min is above max");
      bounds(
        v.min === undefined ? undefined : String(v.min),
        v.max === undefined ? undefined : String(v.max),
      );
      break;
    }
    case "date": {
      type = "date";
      const serial = (d: string | undefined) => {
        if (d === undefined) return undefined;
        const t = typeof d === "string" && DATE_RE.test(d) ? instant(d) : null;
        if (t === null || t < MIN_DATE || t > MAX_DATE)
          throw bad(`date bound ${JSON.stringify(d)} is invalid`);
        return Math.floor((t - EPOCH) / DAY);
      };
      const lo = serial(v.min);
      const hi = serial(v.max);
      if (lo !== undefined && hi !== undefined && lo > hi) throw bad("min is after max");
      bounds(lo === undefined ? undefined : String(lo), hi === undefined ? undefined : String(hi));
      break;
    }
    case "textLength": {
      type = "textLength";
      const ok = (n: unknown) =>
        Number.isSafeInteger(n) && (n as number) >= 0 && (n as number) <= XLSX_MAX_CELL_CHARS;
      if (!ok(v.max) || (v.min !== undefined && (!ok(v.min) || v.min > v.max)))
        throw bad(`text length bounds must be 0 to ${XLSX_MAX_CELL_CHARS}, min not above max`);
      bounds(v.min === undefined ? undefined : String(v.min), String(v.max));
      break;
    }
    default:
      throw bad(`unknown validation type ${JSON.stringify((v as { type?: unknown }).type)}`);
  }
  const attrs = [
    `type="${type}"`,
    ...(operator ? [`operator="${operator}"`] : []),
    `allowBlank="${v.allowBlank === false ? 0 : 1}"`,
    ...(v.prompt
      ? [
          'showInputMessage="1"',
          ...(v.prompt.title ? [`promptTitle="${xmlAttr(v.prompt.title)}"`] : []),
          `prompt="${xmlAttr(v.prompt.message)}"`,
        ]
      : []),
    'showErrorMessage="1"',
    ...(v.error
      ? [
          ...(v.error.title ? [`errorTitle="${xmlAttr(v.error.title)}"`] : []),
          `error="${xmlAttr(v.error.message)}"`,
        ]
      : []),
    `sqref="${sqref}"`,
  ];
  return (
    `<dataValidation ${attrs.join(" ")}><formula1>${xmlText(f1!)}</formula1>` +
    (f2 ? `<formula2>${xmlText(f2)}</formula2>` : "") +
    "</dataValidation>"
  );
}

const PROTECTION_FLAGS = [
  "formatCells",
  "formatColumns",
  "formatRows",
  "insertRows",
  "deleteRows",
  "sort",
  "autoFilter",
] as const;

/** `<sheetProtection>`: every action not allowed stays locked; no password, ever. */
function protectionXml(p: XlsxProtection, sheet: string): string {
  if (typeof p !== "object" || p === null)
    throw new OfficeExportError(
      "protection_invalid",
      `sheet ${sheet}: protection must be an object`,
    );
  if ("password" in p || "hashValue" in p)
    throw new OfficeExportError(
      "protection_invalid",
      `sheet ${sheet}: protection takes no password (it is a UI guard, not a control)`,
    );
  const flags = PROTECTION_FLAGS.map((f) => `${f}="${p[f] === true ? 0 : 1}"`);
  return (
    '<sheetProtection sheet="1" objects="1" scenarios="1" ' +
    flags.join(" ") +
    ` selectLockedCells="${p.selectLockedCells === false ? 1 : 0}" selectUnlockedCells="0"/>`
  );
}

function colsXml(sheet: XlsxSheet): string {
  const protect = sheet.protection !== undefined;
  const out: string[] = [];
  sheet.columns.forEach((c, i) => {
    const open = protect && c.editable === true;
    if (c.width === undefined && !open) return;
    const base = c.type === "date" ? S_DATE : c.type === "datetime" ? S_DATETIME : 0;
    const attrs = [`min="${i + 1}"`, `max="${i + 1}"`];
    attrs.push(c.width === undefined ? 'width="9.140625"' : `width="${String(c.width)}"`);
    if (open) attrs.push(`style="${unlockedOf(base)}"`);
    if (c.width !== undefined) attrs.push('customWidth="1"');
    out.push(`<col ${attrs.join(" ")}/>`);
  });
  return out.length ? `<cols>${out.join("")}</cols>` : "";
}

const COLOR_RE = /^[0-9A-Fa-f]{6}$/;
const PAPER = { A4: 9, A3: 8, letter: 1, legal: 5 } as const;
const MAX_OUTLINE = 7;

/** What a sheet's layout adds to the workbook: its print and filter names, and whether it has formulas. */
interface SheetExtras {
  names: string[];
  formulas: boolean;
}

function layoutBad(sheet: string, why: string): OfficeExportError {
  return new OfficeExportError("layout_invalid", `sheet ${JSON.stringify(sheet)}: ${why}`);
}

function checkColor(c: unknown, sheet: string, what: string, reason = "layout_invalid"): void {
  if (c !== undefined && (typeof c !== "string" || !COLOR_RE.test(c)))
    throw new OfficeExportError(
      reason,
      `sheet ${JSON.stringify(sheet)}: ${what} must be six hex digits (RRGGBB)`,
    );
}

/** Check a sheet's layout options before any part is written. */
function checkLayout(s: XlsxSheet): void {
  const n = s.name;
  if (
    s.freezeColumns !== undefined &&
    (!Number.isSafeInteger(s.freezeColumns) ||
      s.freezeColumns < 0 ||
      s.freezeColumns > Math.min(s.columns.length, XLSX_MAX_COLUMNS - 1))
  )
    throw layoutBad(n, "freezeColumns must be 0 to the column count");
  if (s.autoFilter !== undefined && typeof s.autoFilter !== "boolean")
    throw layoutBad(n, "autoFilter must be a boolean");
  if (
    s.outlineSummary !== undefined &&
    s.outlineSummary !== "below" &&
    s.outlineSummary !== "above"
  )
    throw layoutBad(n, "outlineSummary must be below or above");
  checkColor(s.headerFill, n, "headerFill");
  for (const c of s.columns) checkColor(c.fill, n, `column ${JSON.stringify(c.header)} fill`);
  if (s.rowLayout !== undefined) {
    if (!Array.isArray(s.rowLayout)) throw layoutBad(n, "rowLayout must be an array");
    if (s.rowLayout.length > s.rows.length) throw layoutBad(n, "rowLayout is longer than the rows");
    s.rowLayout.forEach((l, i) => {
      if (l === null || l === undefined) return;
      if (typeof l !== "object") throw layoutBad(n, `rowLayout[${i}] is not an object`);
      if (
        l.outlineLevel !== undefined &&
        (!Number.isSafeInteger(l.outlineLevel) ||
          l.outlineLevel < 0 ||
          l.outlineLevel > MAX_OUTLINE)
      )
        throw layoutBad(n, `rowLayout[${i}].outlineLevel must be 0 to ${MAX_OUTLINE}`);
      checkColor(l.fill, n, `rowLayout[${i}].fill`);
    });
  }
  const p = s.page;
  if (p !== undefined) {
    if (typeof p !== "object" || p === null) throw layoutBad(n, "page must be an object");
    if (p.paper !== undefined && !Object.hasOwn(PAPER, p.paper))
      throw layoutBad(n, "page.paper must be A4, A3, letter or legal");
    if (
      p.orientation !== undefined &&
      p.orientation !== "portrait" &&
      p.orientation !== "landscape"
    )
      throw layoutBad(n, "page.orientation must be portrait or landscape");
    for (const k of ["fitToWidth", "repeatHeader"] as const)
      if (p[k] !== undefined && typeof p[k] !== "boolean")
        throw layoutBad(n, `page.${k} must be a boolean`);
    if (p.printArea !== undefined && p.printArea !== true)
      absoluteRange(p.printArea, `sheet ${JSON.stringify(n)} page.printArea`, "layout_invalid");
  }
  if (s.conditionalFormats !== undefined && !Array.isArray(s.conditionalFormats))
    throw new OfficeExportError(
      "conditional_format_invalid",
      `sheet ${JSON.stringify(n)}: conditionalFormats must be an array`,
    );
}

/** A text as a formula string literal (quotes doubled). */
const literal = (t: string) => `"${t.replace(/"/g, '""')}"`;

/** The expression of one typed conditional format, on the tested column's first data cell. */
function conditionXml(
  cf: XlsxConditionalFormat,
  sheet: XlsxSheet,
  priority: number,
  lastRow: number,
  styles: Styles,
): string {
  const bad = (why: string) =>
    new OfficeExportError(
      "conditional_format_invalid",
      `sheet ${JSON.stringify(sheet.name)} conditional format ${priority}: ${why}`,
    );
  if (typeof cf !== "object" || cf === null) throw bad("must be an object");
  const ci = sheet.columns.findIndex((c) => (c.key ?? c.header) === cf.column);
  const i = ci >= 0 ? ci : sheet.columns.findIndex((c) => c.header === cf.column);
  if (i < 0) throw bad(`no column ${JSON.stringify(cf.column)}`);
  const col = sheet.columns[i]!;
  const letter = xlsxColumnName(i);
  const ref = `$${letter}2`;
  const st = cf.style;
  if (typeof st !== "object" || st === null) throw bad("needs a style");
  if (st.fill === undefined && st.fontColor === undefined && st.bold !== true)
    throw bad("style needs a fill, a font colour or bold");
  checkColor(st.fill, sheet.name, "style.fill", "conditional_format_invalid");
  checkColor(st.fontColor, sheet.name, "style.fontColor", "conditional_format_invalid");
  if (st.bold !== undefined && typeof st.bold !== "boolean")
    throw bad("style.bold must be a boolean");
  const dated = col.type === "date" || col.type === "datetime";
  const numeric = col.type === "number" || col.type === "integer" || dated;
  const subject = col.type === "datetime" ? `INT(${ref})` : ref;
  const value = (v: unknown): string => {
    if (typeof v === "object" && v !== null && "today" in v) {
      const d = (v as { today: unknown }).today;
      if (!dated || !Number.isSafeInteger(d) || Math.abs(d as number) > 36_500)
        throw bad("{ today } is for a date column, with a whole number of days");
      return (d as number) === 0 ? "TODAY()" : `TODAY()${(d as number) > 0 ? "+" : ""}${String(d)}`;
    }
    if (dated) {
      const t = typeof v === "string" && DATE_RE.test(v) ? instant(v) : null;
      if (t === null || t < MIN_DATE || t > MAX_DATE) throw bad("a date value is yyyy-mm-dd");
      return String(Math.floor((t - EPOCH) / DAY));
    }
    if (numeric) {
      if (!finite(v)) throw bad("a number column compares with a finite number");
      return String(v);
    }
    if (col.type === "boolean") {
      if (typeof v !== "boolean") throw bad("a boolean column compares with a boolean");
      return v ? "TRUE" : "FALSE";
    }
    if (typeof v !== "string" || v.length > 255 || dropInvalidXml(v) !== v)
      throw bad("a text column compares with text of at most 255 characters");
    return literal(v);
  };
  const ops = { lt: "<", le: "<=", gt: ">", ge: ">=", eq: "=", ne: "<>" } as const;
  const w = cf.when as XlsxConditionWhen | undefined;
  let expr: string;
  switch (w?.op) {
    case "lt":
    case "le":
    case "gt":
    case "ge":
    case "eq":
    case "ne": {
      if (col.type === "boolean" && w.op !== "eq" && w.op !== "ne")
        throw bad("a boolean column takes eq or ne");
      const test = `${subject}${ops[w.op]}${value(w.value)}`;
      expr = numeric ? `AND(ISNUMBER(${ref}),${test})` : test;
      break;
    }
    case "between":
    case "notBetween": {
      if (!numeric) throw bad(`${w.op} is for a number or date column`);
      const lo = value(w.min);
      const hi = value(w.max);
      expr =
        w.op === "between"
          ? `AND(ISNUMBER(${ref}),${subject}>=${lo},${subject}<=${hi})`
          : `AND(ISNUMBER(${ref}),OR(${subject}<${lo},${subject}>${hi}))`;
      break;
    }
    case "containsText": {
      const t = w.text;
      if (typeof t !== "string" || t.length === 0 || t.length > 255 || dropInvalidXml(t) !== t)
        throw bad("containsText needs text of 1 to 255 characters");
      // SEARCH reads ~, * and ? as wildcards: escape them so the text matches as written.
      expr = `ISNUMBER(SEARCH(${literal(t.replace(/[~*?]/g, "~$&"))},${ref}))`;
      break;
    }
    case "blank":
      expr = `LEN(${ref})=0`;
      break;
    case "notBlank":
      expr = `LEN(${ref})>0`;
      break;
    default:
      throw bad(
        `unknown condition ${JSON.stringify((cf.when as { op?: unknown } | undefined)?.op)}`,
      );
  }
  if (cf.wholeRow !== undefined && typeof cf.wholeRow !== "boolean")
    throw bad("wholeRow must be a boolean");
  const last = xlsxColumnName(sheet.columns.length - 1);
  const sqref = cf.wholeRow === true ? `A2:${last}${lastRow}` : `${letter}2:${letter}${lastRow}`;
  return (
    `<conditionalFormatting sqref="${sqref}"><cfRule type="expression" dxfId="${styles.dxf(st)}" priority="${priority}"` +
    (cf.stopIfTrue === true ? ' stopIfTrue="1"' : "") +
    `><formula>${xmlText(expr)}</formula></cfRule></conditionalFormatting>`
  );
}

/** The frozen pane: the header row, and the first `cols` columns when asked. */
function paneXml(cols: number): string {
  if (cols === 0)
    return (
      '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
      '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>'
    );
  const l = xlsxColumnName(cols);
  return (
    `<pane xSplit="${cols}" ySplit="1" topLeftCell="${l}2" activePane="bottomRight" state="frozen"/>` +
    `<selection pane="topRight" activeCell="${l}1" sqref="${l}1"/>` +
    '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>' +
    `<selection pane="bottomRight" activeCell="${l}2" sqref="${l}2"/>`
  );
}

function sheetXml(
  sheet: XlsxSheet,
  index: number,
  budget: ByteBudget,
  names: ReadonlySet<string>,
  styles: Styles,
): { xml: string; extras: SheetExtras } {
  const cols = sheet.columns;
  const last = xlsxColumnName(cols.length - 1);
  const protect = sheet.protection !== undefined;
  const layout = sheet.rowLayout ?? [];
  const levels = layout.map((l) => l?.outlineLevel ?? 0);
  const maxLevel = levels.reduce((a, b) => Math.max(a, b), 0);
  const page = sheet.page;
  const fit = page?.fitToWidth === true;
  const above = sheet.outlineSummary === "above";
  const dataEnd = sheet.rows.length + 1;
  const extras: SheetExtras = { names: [], formulas: false };
  const out: string[] = [];
  const sheetPr =
    above || fit
      ? `<sheetPr>${above ? '<outlinePr summaryBelow="0"/>' : ""}${fit ? '<pageSetUpPr fitToPage="1"/>' : ""}</sheetPr>`
      : "";
  out.push(
    budget.add(
      XML_DECL +
        `<worksheet xmlns="${NS_MAIN}">` +
        sheetPr +
        `<dimension ref="A1:${last}${dataEnd}"/>` +
        '<sheetViews><sheetView workbookViewId="0">' +
        paneXml(sheet.freezeColumns ?? 0) +
        "</sheetView></sheetViews>" +
        `<sheetFormatPr defaultRowHeight="15"${maxLevel ? ` outlineLevelRow="${maxLevel}"` : ""}/>` +
        colsXml(sheet) +
        "<sheetData>",
    ),
  );
  const head = styles.cell(3, sheet.headerFill, false);
  out.push(
    budget.add(
      `<row r="1">${cols.map((c, i) => inlineStr(`${xlsxColumnName(i)}1`, c.header, head)).join("")}</row>`,
    ),
  );
  const letters = cols.map((_, i) => xlsxColumnName(i));
  sheet.rows.forEach((row, ri) => {
    const r = ri + 2;
    const isArray = Array.isArray(row);
    if (!isArray && (typeof row !== "object" || row === null))
      throw new OfficeExportError(
        "row_invalid",
        `sheet ${JSON.stringify(sheet.name)} row ${r} is not an array or an object`,
      );
    if (isArray && row.length > cols.length)
      throw new OfficeExportError(
        "row_invalid",
        `sheet ${JSON.stringify(sheet.name)} row ${r} has more cells than columns`,
      );
    const rowFill = layout[ri]?.fill;
    let cells = "";
    cols.forEach((c, ci) => {
      const v = isArray
        ? (row as ReadonlyArray<unknown>)[ci]
        : (row as Readonly<Record<string, unknown>>)[c.key ?? c.header];
      const fill = rowFill ?? c.fill;
      const open = protect && c.editable === true;
      if (isXlsxFormula(v)) extras.formulas = true;
      cells += cell(
        sheet.name,
        c,
        `${letters[ci]}${r}`,
        v,
        (base) => styles.cell(base, fill, open),
        fill !== undefined,
      );
    });
    const level = levels[ri] ?? 0;
    out.push(budget.add(`<row r="${r}"${level ? ` outlineLevel="${level}"` : ""}>${cells}</row>`));
  });
  const tail: string[] = ["</sheetData>"];
  if (protect) tail.push(protectionXml(sheet.protection!, sheet.name));
  const ref = sheetRef(sheet.name);
  const whole = `$A$1:$${last}$${dataEnd}`;
  if (sheet.autoFilter === true) {
    tail.push(`<autoFilter ref="A1:${last}${dataEnd}"/>`);
    extras.names.push(
      `<definedName name="_xlnm._FilterDatabase" localSheetId="${index}" hidden="1">${xmlText(`${ref}!${whole}`)}</definedName>`,
    );
  }
  const lastRow = 1 + (sheet.validationRows ?? Math.max(sheet.rows.length, 1));
  (sheet.conditionalFormats ?? []).forEach((cf, i) =>
    tail.push(conditionXml(cf, sheet, i + 1, lastRow, styles)),
  );
  const dv = cols.flatMap((c, i) =>
    c.validation === undefined
      ? []
      : [
          validationXml(
            c.validation,
            `${letters[i]}2:${letters[i]}${lastRow}`,
            `sheet ${JSON.stringify(sheet.name)} column ${JSON.stringify(c.header)}`,
            names,
          ),
        ],
  );
  if (dv.length)
    tail.push(`<dataValidations count="${dv.length}">${dv.join("")}</dataValidations>`);
  if (page !== undefined) {
    tail.push(
      '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>',
      `<pageSetup paperSize="${PAPER[page.paper ?? "A4"]}" orientation="${page.orientation ?? "portrait"}"` +
        (fit ? ' fitToWidth="1" fitToHeight="0"' : "") +
        "/>",
    );
    if (page.printArea !== undefined) {
      const area =
        page.printArea === true
          ? whole
          : absoluteRange(
              page.printArea,
              `sheet ${JSON.stringify(sheet.name)} page.printArea`,
              "layout_invalid",
            );
      extras.names.push(
        `<definedName name="_xlnm.Print_Area" localSheetId="${index}">${xmlText(`${ref}!${area}`)}</definedName>`,
      );
    }
    if (page.repeatHeader === true)
      extras.names.push(
        `<definedName name="_xlnm.Print_Titles" localSheetId="${index}">${xmlText(`${ref}!$1:$1`)}</definedName>`,
      );
  }
  tail.push("</worksheet>");
  out.push(budget.add(tail.join("")));
  return { xml: out.join(""), extras };
}

function validate(sheets: readonly XlsxSheet[]): void {
  if (!Array.isArray(sheets) || sheets.length === 0)
    throw new OfficeExportError("sheets_invalid", "a workbook needs at least one sheet");
  if (sheets.length > XLSX_MAX_SHEETS)
    throw new OfficeExportError("too_many_sheets", `at most ${XLSX_MAX_SHEETS} sheets`);
  const seen = new Set<string>();
  for (const s of sheets) {
    assertSheetName(s.name);
    const k = s.name.toLowerCase();
    if (seen.has(k))
      throw new OfficeExportError(
        "sheet_name_invalid",
        `sheet name ${JSON.stringify(s.name)} is used twice`,
      );
    seen.add(k);
    if (!Array.isArray(s.columns) || s.columns.length === 0)
      throw new OfficeExportError("columns_invalid", `sheet ${s.name} needs at least one column`);
    if (s.columns.length > XLSX_MAX_COLUMNS)
      throw new OfficeExportError(
        "too_many_columns",
        `sheet ${s.name} has more than ${XLSX_MAX_COLUMNS} columns`,
      );
    for (const c of s.columns) {
      if (typeof c.header !== "string")
        throw new OfficeExportError("columns_invalid", `sheet ${s.name}: a header is not text`);
      if (c.width !== undefined && (!finite(c.width) || c.width < 1 || c.width > 255))
        throw new OfficeExportError(
          "columns_invalid",
          `sheet ${s.name}: column ${JSON.stringify(c.header)} width must be 1 to 255`,
        );
      if (!TYPES.has(c.type))
        throw new OfficeExportError(
          "columns_invalid",
          `sheet ${s.name}: unknown column type ${JSON.stringify(c.type)}`,
        );
    }
    if (!Array.isArray(s.rows))
      throw new OfficeExportError("rows_invalid", `sheet ${s.name}: rows must be an array`);
    if (s.rows.length > XLSX_MAX_ROWS - 1)
      throw new OfficeExportError(
        "too_many_rows",
        `sheet ${s.name} has more than ${XLSX_MAX_ROWS - 1} rows after the header`,
      );
    if (
      s.validationRows !== undefined &&
      (!Number.isSafeInteger(s.validationRows) ||
        s.validationRows < 1 ||
        s.validationRows > XLSX_MAX_ROWS - 1)
    )
      throw new OfficeExportError(
        "validation_invalid",
        `sheet ${s.name}: validationRows must be 1 to ${XLSX_MAX_ROWS - 1}`,
      );
    checkLayout(s);
  }
}

/** Check the named ranges against the sheets; returns their names (lower case) for list validations. */
function definedNames(
  ranges: readonly XlsxNamedRange[] | undefined,
  sheets: readonly XlsxSheet[],
): { names: Set<string>; xml: string[] } {
  const names = new Set<string>();
  if (ranges === undefined) return { names, xml: [] };
  if (!Array.isArray(ranges))
    throw new OfficeExportError("named_range_invalid", "namedRanges must be an array");
  const sheetNames = new Set(sheets.map((s) => s.name));
  const out = ranges.map((r) => {
    const what = `named range ${JSON.stringify(r?.name)}`;
    if (typeof r?.name !== "string" || !NAME_RE.test(r.name) || LOOKS_LIKE_REF.test(r.name))
      throw new OfficeExportError("named_range_invalid", `${what}: not a valid defined name`);
    const k = r.name.toLowerCase();
    if (names.has(k)) throw new OfficeExportError("named_range_invalid", `${what}: defined twice`);
    if (!sheetNames.has(r.sheet))
      throw new OfficeExportError(
        "named_range_invalid",
        `${what}: no sheet ${JSON.stringify(r.sheet)}`,
      );
    names.add(k);
    return `<definedName name="${xmlAttr(r.name)}">${xmlText(`${sheetRef(r.sheet)}!${absoluteRange(r.range, what)}`)}</definedName>`;
  });
  return { names, xml: out };
}

/**
 * Write a workbook: one sheet per entry, a bold frozen header row, then one row per input row,
 * with any column widths, validations, named ranges and lock-flag protection asked for, and any
 * layout (frozen columns, AutoFilter, outline levels, fills, page set-up, conditional formats) and
 * typed formula cells (`xlsxFormula`).
 * Refuses (`OfficeExportError`) a bad sheet name, an unknown column type, a value that does not
 * fit its column type, more rows or columns than Excel holds, a cell over 32 767 characters, or
 * parts over `maxBytes` uncompressed (default 64 MiB).
 */
export function toXlsx(sheets: readonly XlsxSheet[], o: XlsxOptions = {}): Buffer {
  validate(sheets);
  const { names, xml: userNames } = definedNames(o.namedRanges, sheets);
  const unlocked = sheets.some(
    (s) => s.protection !== undefined && s.columns.some((c) => c.editable === true),
  );
  const created = createdOf(o);
  const max = maxBytesOf(o);
  const budget = new ByteBudget(max);
  const parts = new Map<string, string>();
  const n = sheets.length;
  parts.set(
    "[Content_Types].xml",
    contentTypesXml([
      ["/xl/workbook.xml", CT_WORKBOOK],
      ...sheets.map((_, i) => [`/xl/worksheets/sheet${i + 1}.xml`, CT_SHEET] as const),
      ["/xl/styles.xml", CT_STYLES],
      ["/docProps/core.xml", CT_CORE],
    ]),
  );
  parts.set(
    "_rels/.rels",
    relsXml([
      { id: "rId1", type: `${REL_OFFICE}/officeDocument`, target: "xl/workbook.xml" },
      { id: "rId2", type: REL_CORE, target: "docProps/core.xml" },
    ]),
  );
  parts.set("docProps/core.xml", coreXml(o, created));
  // Written once the sheets are, since their print and filter names and formulas go in it.
  parts.set("xl/workbook.xml", "");
  parts.set(
    "xl/_rels/workbook.xml.rels",
    relsXml([
      ...sheets.map((_, i) => ({
        id: `rId${i + 1}`,
        type: `${REL_OFFICE}/worksheet`,
        target: `worksheets/sheet${i + 1}.xml`,
      })),
      { id: `rId${n + 1}`, type: `${REL_OFFICE}/styles`, target: "styles.xml" },
    ]),
  );
  // Written once the sheets are, since their fills and conditional formats add styles.
  parts.set("xl/styles.xml", "");
  for (const v of parts.values()) budget.add(v);
  const styles = new Styles(unlocked);
  const sheetNames: string[] = [];
  let formulas = false;
  sheets.forEach((s, i) => {
    const { xml, extras } = sheetXml(s, i, budget, names, styles);
    parts.set(`xl/worksheets/sheet${i + 1}.xml`, xml);
    sheetNames.push(...extras.names);
    formulas ||= extras.formulas;
  });
  const allNames = [...userNames, ...sheetNames];
  parts.set(
    "xl/workbook.xml",
    budget.add(
      XML_DECL +
        `<workbook xmlns="${NS_MAIN}" xmlns:r="${REL_OFFICE}"><sheets>` +
        sheets
          .map((s, i) => `<sheet name="${xmlAttr(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
          .join("") +
        "</sheets>" +
        (allNames.length ? `<definedNames>${allNames.join("")}</definedNames>` : "") +
        (formulas ? '<calcPr fullCalcOnLoad="1"/>' : "") +
        "</workbook>",
    ),
  );
  parts.set("xl/styles.xml", budget.add(styles.xml()));
  return packParts(parts, created, max);
}
