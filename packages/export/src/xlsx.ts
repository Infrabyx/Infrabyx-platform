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

function stylesXml(unlocked: boolean): string {
  return (
    STYLE_HEAD +
    (unlocked
      ? `<cellXfs count="7">${XF_BASE}${XF_UNLOCKED}</cellXfs>`
      : `<cellXfs count="4">${XF_BASE}</cellXfs>`) +
    STYLE_TAIL
  );
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

function cell(sheet: string, col: XlsxColumn, ref: string, v: unknown, open: boolean): string {
  if (v === null || v === undefined) return "";
  const st = (base: number) => (open ? unlockedOf(base) : base);
  const sAttr = (base: number) => (open || base ? ` s="${st(base)}"` : "");
  const bad = (why: string) =>
    new OfficeExportError(
      "cell_invalid",
      `sheet ${JSON.stringify(sheet)} cell ${ref} (${JSON.stringify(col.header)}, ${col.type}): ${why}`,
    );
  switch (col.type) {
    case "string":
      return inlineStr(ref, cellText(v), open ? st(0) : 0);
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
    case "datetime": {
      const t = instant(v);
      if (t === null || Number.isNaN(t)) throw bad("not a date (Date or ISO 8601 with offset)");
      if (t < MIN_DATE || t > MAX_DATE) throw bad("outside 1900-03-01 to 9999-12-31");
      const serial = col.type === "date" ? Math.floor((t - EPOCH) / DAY) : (t - EPOCH) / DAY;
      return `<c r="${ref}"${sAttr(col.type === "date" ? S_DATE : S_DATETIME)}><v>${String(serial)}</v></c>`;
    }
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
function absoluteRange(range: unknown, what: string): string {
  const bad = () =>
    new OfficeExportError(
      "named_range_invalid",
      `${what}: range ${JSON.stringify(range)} is invalid`,
    );
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

function sheetXml(sheet: XlsxSheet, budget: ByteBudget, names: ReadonlySet<string>): string {
  const cols = sheet.columns;
  const last = xlsxColumnName(cols.length - 1);
  const protect = sheet.protection !== undefined;
  const out: string[] = [];
  out.push(
    budget.add(
      XML_DECL +
        `<worksheet xmlns="${NS_MAIN}">` +
        `<dimension ref="A1:${last}${sheet.rows.length + 1}"/>` +
        '<sheetViews><sheetView workbookViewId="0">' +
        '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
        '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>' +
        "</sheetView></sheetViews>" +
        '<sheetFormatPr defaultRowHeight="15"/>' +
        colsXml(sheet) +
        "<sheetData>",
    ),
  );
  out.push(
    budget.add(
      `<row r="1">${cols.map((c, i) => inlineStr(`${xlsxColumnName(i)}1`, c.header, S_HEADER)).join("")}</row>`,
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
    let cells = "";
    cols.forEach((c, ci) => {
      const v = isArray
        ? (row as ReadonlyArray<unknown>)[ci]
        : (row as Readonly<Record<string, unknown>>)[c.key ?? c.header];
      cells += cell(sheet.name, c, `${letters[ci]}${r}`, v, protect && c.editable === true);
    });
    out.push(budget.add(`<row r="${r}">${cells}</row>`));
  });
  const tail: string[] = ["</sheetData>"];
  if (protect) tail.push(protectionXml(sheet.protection!, sheet.name));
  const lastRow = 1 + (sheet.validationRows ?? Math.max(sheet.rows.length, 1));
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
  tail.push("</worksheet>");
  out.push(budget.add(tail.join("")));
  return out.join("");
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
  }
}

/** Check the named ranges against the sheets; returns their names (lower case) for list validations. */
function definedNames(
  ranges: readonly XlsxNamedRange[] | undefined,
  sheets: readonly XlsxSheet[],
): { names: Set<string>; xml: string } {
  const names = new Set<string>();
  if (ranges === undefined) return { names, xml: "" };
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
  return { names, xml: out.length ? `<definedNames>${out.join("")}</definedNames>` : "" };
}

/**
 * Write a workbook: one sheet per entry, a bold frozen header row, then one row per input row,
 * with any column widths, validations, named ranges and lock-flag protection asked for.
 * Refuses (`OfficeExportError`) a bad sheet name, an unknown column type, a value that does not
 * fit its column type, more rows or columns than Excel holds, a cell over 32 767 characters, or
 * parts over `maxBytes` uncompressed (default 64 MiB).
 */
export function toXlsx(sheets: readonly XlsxSheet[], o: XlsxOptions = {}): Buffer {
  validate(sheets);
  const { names, xml: definedNamesXml } = definedNames(o.namedRanges, sheets);
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
  parts.set(
    "xl/workbook.xml",
    XML_DECL +
      `<workbook xmlns="${NS_MAIN}" xmlns:r="${REL_OFFICE}"><sheets>` +
      sheets
        .map((s, i) => `<sheet name="${xmlAttr(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join("") +
      "</sheets>" +
      definedNamesXml +
      "</workbook>",
  );
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
  parts.set("xl/styles.xml", stylesXml(unlocked));
  for (const v of parts.values()) budget.add(v);
  sheets.forEach((s, i) =>
    parts.set(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s, budget, names)),
  );
  return packParts(parts, created, max);
}
