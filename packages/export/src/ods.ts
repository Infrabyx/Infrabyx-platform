// ODS writer (regulatory templates plan §7, item (b); R1-D-313): an OpenDocument 1.3 spreadsheet
// from the same sheet model as `toXlsx`, with no dependency, so a register exports to ODS beside
// XLSX, CSV and PDF. One bold, frozen header row and typed cells per sheet: text, floats, booleans,
// dates and date-times (UTC, ISO values with a `yyyy-mm-dd` or `yyyy-mm-dd hh:mm:ss` display).
// Every value is checked as `toXlsx` checks it; strings pass `neutraliseFormula` as `toCsv`
// defines it, so a cell never starts with a formula trigger, and ODS writes no formula at all. A
// feature of `toXlsx` that an ODS cannot carry the same way is refused (`ods_unsupported`), never
// dropped: an exported register never loses a control silently. The same sheets and `created`
// time always give the same bytes.
import { cellText, neutraliseFormula } from "./csv.js";
import {
  MIME_ODS,
  ODF_NS,
  ODF_VERSION,
  ODF_XML_DECL,
  metaXml,
  odfText,
  odfUnsupported,
  packOdf,
} from "./odf.js";
import {
  ByteBudget,
  OfficeExportError,
  createdOf,
  dropInvalidXml,
  maxBytesOf,
  xmlAttr,
  type OfficeProperties,
} from "./ooxml.js";
import { instant, numberOf } from "./values.js";
import {
  XLSX_MAX_CELL_CHARS,
  XLSX_MAX_COLUMNS,
  XLSX_MAX_ROWS,
  XLSX_MAX_SHEETS,
  assertSheetName,
  isXlsxFormula,
  type XlsxColumn,
  type XlsxSheet,
} from "./xlsx.js";

/** Title, creator, a fixed `created` time and the `maxBytes` cap (default 64 MiB). */
export type OdsOptions = OfficeProperties;

const TYPES: ReadonlySet<string> = new Set([
  "string",
  "number",
  "integer",
  "boolean",
  "date",
  "datetime",
]);
// What `toXlsx` dates accept: 1900-03-01 to 9999-12-31, so one model means one set of values.
const MIN_DATE = Date.UTC(1900, 2, 1);
const MAX_DATE = Date.UTC(10000, 0, 1) - 1;

/** The `XlsxSheet` features an ODS export refuses, by property. */
const UNSUPPORTED: ReadonlyArray<readonly [keyof XlsxSheet, string]> = [
  ["validationRows", "data validations (validationRows)"],
  ["protection", "sheet protection"],
  ["freezeColumns", "frozen columns"],
  ["autoFilter", "an AutoFilter"],
  ["headerFill", "a header fill"],
  ["rowLayout", "row outline levels or fills"],
  ["outlineSummary", "row outline levels"],
  ["page", "a page set-up"],
  ["conditionalFormats", "conditional formats"],
];

function validate(sheets: readonly XlsxSheet[], o: OdsOptions & { namedRanges?: unknown }): void {
  if (!Array.isArray(sheets) || sheets.length === 0)
    throw new OfficeExportError("sheets_invalid", "a workbook needs at least one sheet");
  if (sheets.length > XLSX_MAX_SHEETS)
    throw new OfficeExportError("too_many_sheets", `at most ${XLSX_MAX_SHEETS} sheets`);
  if (o.namedRanges !== undefined) throw odfUnsupported("named ranges");
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
    for (const [prop, what] of UNSUPPORTED)
      if (s[prop] !== undefined) throw odfUnsupported(`${what} (sheet ${s.name})`);
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
      const name = JSON.stringify(c.header);
      if (
        c.width !== undefined &&
        !(typeof c.width === "number" && Number.isFinite(c.width) && c.width >= 1 && c.width <= 255)
      )
        throw new OfficeExportError(
          "columns_invalid",
          `sheet ${s.name}: column ${name} width must be 1 to 255`,
        );
      if (!TYPES.has(c.type))
        throw new OfficeExportError(
          "columns_invalid",
          `sheet ${s.name}: unknown column type ${JSON.stringify(c.type)}`,
        );
      if (c.validation !== undefined)
        throw odfUnsupported(`a data validation (sheet ${s.name}, column ${name})`);
      if (c.editable !== undefined)
        throw odfUnsupported(`an editable column (sheet ${s.name}, column ${name})`);
      if (c.fill !== undefined)
        throw odfUnsupported(`a column fill (sheet ${s.name}, column ${name})`);
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

/** Excel's column width in characters as a length: (7 px × chars + 5 px) at 96 dpi, in cm. */
const widthCm = (chars: number) => `${(((chars * 7 + 5) / 96) * 2.54).toFixed(3)}cm`;

function textCell(sheet: string, ref: string, text: string, style?: string): string {
  const t = neutraliseFormula(dropInvalidXml(text));
  if (t.length > XLSX_MAX_CELL_CHARS)
    throw new OfficeExportError(
      "cell_too_long",
      `sheet ${JSON.stringify(sheet)} cell ${ref} has more than ${XLSX_MAX_CELL_CHARS} characters`,
    );
  const s = style ? ` table:style-name="${style}"` : "";
  return `<table:table-cell${s} office:value-type="string"><text:p>${odfText(t)}</text:p></table:table-cell>`;
}

const ref = (ci: number, r: number) => {
  let x = ci + 1;
  let s = "";
  while (x > 0) {
    s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
    x = Math.floor((x - 1) / 26);
  }
  return `${s}${r}`;
};

function cell(sheet: string, col: XlsxColumn, at: string, v: unknown): string {
  if (v === null || v === undefined) return "<table:table-cell/>";
  const bad = (why: string) =>
    new OfficeExportError(
      "cell_invalid",
      `sheet ${JSON.stringify(sheet)} cell ${at} (${JSON.stringify(col.header)}, ${col.type}): ${why}`,
    );
  if (isXlsxFormula(v)) throw odfUnsupported(`a formula cell (sheet ${sheet}, cell ${at})`);
  switch (col.type) {
    case "string":
      return textCell(sheet, at, cellText(v));
    case "number":
    case "integer": {
      const n = numberOf(v);
      if (n === null) throw bad("not a finite number");
      if (col.type === "integer" && !Number.isSafeInteger(n)) throw bad("not a safe integer");
      const shown = String(n);
      return `<table:table-cell office:value-type="float" office:value="${shown}"><text:p>${shown}</text:p></table:table-cell>`;
    }
    case "boolean":
      if (typeof v !== "boolean") throw bad("not a boolean");
      return `<table:table-cell office:value-type="boolean" office:boolean-value="${v}"><text:p>${v ? "TRUE" : "FALSE"}</text:p></table:table-cell>`;
    case "date":
    case "datetime": {
      const t = instant(v);
      if (t === null || Number.isNaN(t)) throw bad("not a date (Date or ISO 8601 with offset)");
      if (t < MIN_DATE || t > MAX_DATE) throw bad("outside 1900-03-01 to 9999-12-31");
      const iso = new Date(t).toISOString();
      const value = col.type === "date" ? iso.slice(0, 10) : iso.slice(0, 19);
      const shown = col.type === "date" ? value : value.replace("T", " ");
      const style = col.type === "date" ? "ceD" : "ceT";
      return `<table:table-cell table:style-name="${style}" office:value-type="date" office:date-value="${value}"><text:p>${shown}</text:p></table:table-cell>`;
    }
  }
}

const DATE_STYLES =
  '<number:date-style style:name="N1"><number:year number:style="long"/><number:text>-</number:text>' +
  '<number:month number:style="long"/><number:text>-</number:text><number:day number:style="long"/></number:date-style>' +
  '<number:date-style style:name="N2"><number:year number:style="long"/><number:text>-</number:text>' +
  '<number:month number:style="long"/><number:text>-</number:text><number:day number:style="long"/>' +
  '<number:text> </number:text><number:hours number:style="long"/><number:text>:</number:text>' +
  '<number:minutes number:style="long"/><number:text>:</number:text><number:seconds number:style="long"/></number:date-style>' +
  '<style:style style:name="ceH" style:family="table-cell"><style:text-properties fo:font-weight="bold"' +
  ' style:font-weight-asian="bold" style:font-weight-complex="bold"/></style:style>' +
  '<style:style style:name="ceD" style:family="table-cell" style:data-style-name="N1"/>' +
  '<style:style style:name="ceT" style:family="table-cell" style:data-style-name="N2"/>';

/** The view settings that freeze each sheet's header row. */
function settingsXml(sheets: readonly XlsxSheet[]): string {
  const item = (n: string, t: string, v: string | number) =>
    `<config:config-item config:name="${n}" config:type="${t}">${v}</config:config-item>`;
  const tables = sheets
    .map(
      (s) =>
        `<config:config-item-map-entry config:name="${xmlAttr(s.name)}">` +
        item("VerticalSplitMode", "short", 2) +
        item("VerticalSplitPosition", "int", 1) +
        item("ActiveSplitRange", "short", 2) +
        item("PositionTop", "int", 0) +
        item("PositionBottom", "int", 1) +
        "</config:config-item-map-entry>",
    )
    .join("");
  return (
    ODF_XML_DECL +
    `<office:document-settings${ODF_NS} office:version="${ODF_VERSION}"><office:settings>` +
    '<config:config-item-set config:name="ooo:view-settings"><config:config-item-map-indexed config:name="Views">' +
    `<config:config-item-map-entry>${item("ViewId", "string", "view1")}` +
    `<config:config-item-map-named config:name="Tables">${tables}</config:config-item-map-named>` +
    "</config:config-item-map-entry></config:config-item-map-indexed></config:config-item-set>" +
    "</office:settings></office:document-settings>"
  );
}

const STYLES_XML =
  ODF_XML_DECL +
  `<office:document-styles${ODF_NS} office:version="${ODF_VERSION}"><office:styles>` +
  '<style:default-style style:family="table-cell"><style:text-properties fo:font-size="11pt"/></style:default-style>' +
  "</office:styles></office:document-styles>";

/**
 * Write sheets as an ODS. Refuses (`OfficeExportError`) what `toXlsx` refuses for the same
 * sheets, and with `ods_unsupported` any `toXlsx` feature an ODS export does not carry (data
 * validations, protection, frozen columns, AutoFilter, fills, row layout, page set-up,
 * conditional formats, formula cells, named ranges).
 */
export function toOds(sheets: readonly XlsxSheet[], o: OdsOptions = {}): Buffer {
  validate(sheets, o as OdsOptions & { namedRanges?: unknown });
  const created = createdOf(o);
  const max = maxBytesOf(o);
  const budget = new ByteBudget(max);
  const widths = new Map<number, string>();
  const columnStyle = (w: number) => {
    let n = widths.get(w);
    if (n === undefined) {
      n = `co${widths.size + 1}`;
      widths.set(w, n);
    }
    return n;
  };
  const tables: string[] = [];
  for (const s of sheets) {
    const cols = s.columns
      .map((c) =>
        c.width === undefined
          ? "<table:table-column/>"
          : `<table:table-column table:style-name="${columnStyle(c.width)}"/>`,
      )
      .join("");
    const out: string[] = [
      budget.add(
        `<table:table table:name="${xmlAttr(s.name)}">${cols}<table:table-header-rows><table:table-row>` +
          s.columns.map((c, ci) => textCell(s.name, ref(ci, 1), c.header, "ceH")).join("") +
          "</table:table-row></table:table-header-rows>",
      ),
    ];
    s.rows.forEach((row, ri) => {
      if (typeof row !== "object" || row === null)
        throw new OfficeExportError(
          "rows_invalid",
          `sheet ${s.name}: row ${ri + 1} must be an array or an object`,
        );
      const isArray = Array.isArray(row);
      const cells = s.columns
        .map((c, ci) =>
          cell(
            s.name,
            c,
            ref(ci, ri + 2),
            isArray
              ? (row as ReadonlyArray<unknown>)[ci]
              : (row as Readonly<Record<string, unknown>>)[c.key ?? c.header],
          ),
        )
        .join("");
      out.push(budget.add(`<table:table-row>${cells}</table:table-row>`));
    });
    out.push(budget.add("</table:table>"));
    tables.push(out.join(""));
  }
  const colStyles = [...widths]
    .map(
      ([w, n]) =>
        `<style:style style:name="${n}" style:family="table-column"><style:table-column-properties style:column-width="${widthCm(w)}"/></style:style>`,
    )
    .join("");
  const content =
    ODF_XML_DECL +
    `<office:document-content${ODF_NS} office:version="${ODF_VERSION}">` +
    `<office:automatic-styles>${colStyles}${DATE_STYLES}</office:automatic-styles>` +
    `<office:body><office:spreadsheet>${tables.join("")}</office:spreadsheet></office:body>` +
    "</office:document-content>";
  const parts = new Map<string, string>([
    ["content.xml", content],
    ["meta.xml", metaXml(o, created)],
    ["settings.xml", settingsXml(sheets)],
    ["styles.xml", STYLES_XML],
  ]);
  return packOdf(MIME_ODS, parts, created, max);
}
