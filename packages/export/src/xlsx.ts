// XLSX writer (PR-LDC-28, M59): an Office Open XML workbook (SpreadsheetML, ECMA-376 Part 1)
// written over the package's own ZIP writer, with no dependency. One header row (bold, frozen) and
// typed cells per sheet; strings are inline (`t="inlineStr"`) and pass through `neutraliseFormula`
// as `toCsv` defines it, so a cell is never a formula and never starts with a formula trigger. Text
// is XML-escaped and stripped of characters XML 1.0 cannot carry; numbers are finite only; dates
// are Excel serials (1900 date system, UTC) with a `yyyy-mm-dd` or `yyyy-mm-dd hh:mm:ss` style.
// The same sheets and `created` time always give the same bytes.
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
}

export type XlsxRow = ReadonlyArray<unknown> | Readonly<Record<string, unknown>>;

export interface XlsxSheet {
  /** 1 to 31 characters, none of `[]:*?/\`, not starting or ending with `'`, unique (any case). */
  name: string;
  columns: readonly XlsxColumn[];
  rows: readonly XlsxRow[];
}

export type XlsxOptions = OfficeProperties;

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

// cellXfs indexes in styles.xml.
const S_DATE = 1;
const S_DATETIME = 2;
const S_HEADER = 3;

const STYLES =
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
  '<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  "</styleSheet>";

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

function cell(sheet: string, col: XlsxColumn, ref: string, v: unknown): string {
  if (v === null || v === undefined) return "";
  const bad = (why: string) =>
    new OfficeExportError(
      "cell_invalid",
      `sheet ${JSON.stringify(sheet)} cell ${ref} (${JSON.stringify(col.header)}, ${col.type}): ${why}`,
    );
  switch (col.type) {
    case "string":
      return inlineStr(ref, cellText(v));
    case "number":
    case "integer": {
      const n = numberOf(v);
      if (n === null) throw bad("not a finite number");
      if (col.type === "integer" && !Number.isSafeInteger(n)) throw bad("not a safe integer");
      return `<c r="${ref}"><v>${String(n)}</v></c>`;
    }
    case "boolean":
      if (typeof v !== "boolean") throw bad("not a boolean");
      return `<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`;
    case "date":
    case "datetime": {
      const t = instant(v);
      if (t === null || Number.isNaN(t)) throw bad("not a date (Date or ISO 8601 with offset)");
      if (t < MIN_DATE || t > MAX_DATE) throw bad("outside 1900-03-01 to 9999-12-31");
      const serial = col.type === "date" ? Math.floor((t - EPOCH) / DAY) : (t - EPOCH) / DAY;
      return `<c r="${ref}" s="${col.type === "date" ? S_DATE : S_DATETIME}"><v>${String(serial)}</v></c>`;
    }
  }
}

function sheetXml(sheet: XlsxSheet, budget: ByteBudget): string {
  const cols = sheet.columns;
  const last = xlsxColumnName(cols.length - 1);
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
        '<sheetFormatPr defaultRowHeight="15"/><sheetData>',
    ),
  );
  out.push(
    budget.add(
      `<row r="1">${cols.map((c, i) => inlineStr(`${xlsxColumnName(i)}1`, c.header, S_HEADER)).join("")}</row>`,
    ),
  );
  const names = cols.map((_, i) => xlsxColumnName(i));
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
      cells += cell(sheet.name, c, `${names[ci]}${r}`, v);
    });
    out.push(budget.add(`<row r="${r}">${cells}</row>`));
  });
  out.push(budget.add("</sheetData></worksheet>"));
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
  }
}

/**
 * Write a workbook: one sheet per entry, a bold frozen header row, then one row per input row.
 * Refuses (`OfficeExportError`) a bad sheet name, an unknown column type, a value that does not
 * fit its column type, more rows or columns than Excel holds, a cell over 32 767 characters, or
 * parts over `maxBytes` uncompressed (default 64 MiB).
 */
export function toXlsx(sheets: readonly XlsxSheet[], o: XlsxOptions = {}): Buffer {
  validate(sheets);
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
      "</sheets></workbook>",
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
  parts.set("xl/styles.xml", STYLES);
  for (const v of parts.values()) budget.add(v);
  sheets.forEach((s, i) => parts.set(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s, budget)));
  return packParts(parts, created, max);
}
