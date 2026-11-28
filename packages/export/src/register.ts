// A register's rows in the four formats its template names (regulatory templates item (a), part 1;
// plan §3 (a); R1-D-322): xlsx, csv, pdf and ods from one `RegisterDefinition`, so the headers are
// the filed labels in the filed order wherever the register goes. Every row is checked against
// its sheet first (`assertRow`), so a file never carries a value its definition refuses. CSV is
// formula-neutralised (it is meant to be opened in a spreadsheet); xlsx and ods neutralise as
// they always do.
import {
  RegisterDefinition,
  RegisterError,
  assertRow,
  orderedColumns,
  registerSheet,
  type RegisterColumn,
} from "@infrabyx/contracts/registers";
import { toCsv } from "./csv.js";
import type { PdfBlock, PdfDocument } from "./pdf.js";
import { toPdf } from "./pdf.js";
import { toOds } from "./ods.js";
import { toXlsx, type XlsxColumn, type XlsxColumnType, type XlsxSheet } from "./xlsx.js";

export const REGISTER_EXPORT_FORMATS = ["xlsx", "csv", "pdf", "ods"] as const;
export type RegisterExportFormat = (typeof REGISTER_EXPORT_FORMATS)[number];

/** Rows by sheet name, each keyed by column key. */
export type RegisterRows = Readonly<
  Record<string, ReadonlyArray<Readonly<Record<string, unknown>>>>
>;

export interface RegisterExportOptions {
  /** Document properties; default the definition's title. */
  title?: string;
  /** Fixed creation time, so the same input gives the same bytes (golden tests). */
  created?: Date;
  /** At most this many rows in all (default 100 000). */
  maxRows?: number;
}

const TYPE: Record<RegisterColumn["type"], XlsxColumnType> = {
  text: "string",
  enum: "string",
  number: "number",
  integer: "integer",
  boolean: "boolean",
  date: "date",
  datetime: "datetime",
};

/** A cell value as the spreadsheet writers take it: a date as UTC midnight, empty as null. */
function cell(c: RegisterColumn, v: unknown): unknown {
  if (v === undefined || v === "" || v === null) return null;
  if (c.type === "date") return new Date(`${String(v)}T00:00:00Z`);
  if (c.type === "datetime") return new Date(String(v));
  return v;
}

/** A value as text (CSV and PDF): dates as written, booleans as Yes and No. */
function text(c: RegisterColumn, v: unknown): string {
  if (v === undefined || v === null) return "";
  if (c.type === "boolean") return v ? "Yes" : "No";
  return String(v);
}

/**
 * The register as one file. `rows` names each sheet it writes (every sheet must be the
 * definition's); csv takes exactly one sheet. Refused with `RegisterError` (`row_invalid`, naming
 * the row's problems, or `definition_invalid`) before anything is written.
 */
interface Checked {
  sheet: RegisterDefinition["sheets"][number];
  cols: RegisterColumn[];
  rows: ReadonlyArray<Readonly<Record<string, unknown>>>;
}

function pdfDocument(title: string, sheets: readonly Checked[]): PdfDocument {
  const blocks: PdfBlock[] = [{ type: "heading", level: 1, text: title }];
  for (const { sheet, cols, rows: rs } of sheets) {
    if (sheets.length > 1) blocks.push({ type: "heading", level: 2, text: sheet.name });
    blocks.push({
      type: "table",
      header: cols.map((c) => c.label),
      rows: rs.map((r) => cols.map((c) => text(c, r[c.key]))),
    });
  }
  return { title, blocks };
}

/**
 * The register as a PDF document model, rows checked as `registerExport` checks them. Pass it to
 * `renderPdf` when the rows hold Indic text: `toPdf` (and so `registerExport`'s `pdf`) refuses
 * text that needs shaping, and `renderPdf` sends it through DOCGEN instead (R1-D-96).
 */
export function registerPdfDocument(
  definition: RegisterDefinition,
  rows: RegisterRows,
  o: Pick<RegisterExportOptions, "title" | "maxRows"> = {},
): PdfDocument {
  const def = RegisterDefinition.parse(definition);
  return pdfDocument(o.title ?? `${def.code} ${def.title}`, checkedSheets(def, rows, o.maxRows));
}

function checkedSheets(def: RegisterDefinition, rows: RegisterRows, maxRows = 100_000): Checked[] {
  const names = Object.keys(rows);
  if (!names.length) throw new RangeError("name at least one sheet");
  const total = names.reduce((n, k) => n + rows[k]!.length, 0);
  if (total > maxRows) throw new RangeError(`at most ${maxRows} rows (${total} given)`);
  for (const n of names) registerSheet(def, n);
  // In the definition's sheet order, each sheet's rows checked against its columns.
  const sheets = def.sheets
    .filter((s) => names.includes(s.name))
    .map((s) => ({ sheet: s, cols: orderedColumns(s), rows: rows[s.name]! }));
  for (const { sheet, rows: rs } of sheets)
    rs.forEach((r, i) => {
      try {
        assertRow(sheet, r);
      } catch (e) {
        if (e instanceof RegisterError)
          throw new RegisterError(
            "row_invalid",
            e.problems.map((p) => ({
              ...p,
              column: `${sheet.name}[${i}].${(p as { column: string }).column}`,
            })),
          );
        throw e;
      }
    });
  return sheets;
}

export function registerExport(
  definition: RegisterDefinition,
  rows: RegisterRows,
  format: RegisterExportFormat,
  o: RegisterExportOptions = {},
): Buffer {
  const def = RegisterDefinition.parse(definition);
  if (!REGISTER_EXPORT_FORMATS.includes(format)) throw new RangeError(`unknown format ${format}`);
  if (format === "csv" && Object.keys(rows).length !== 1)
    throw new RangeError("a CSV file holds one sheet: export the sheets one at a time");
  const sheets = checkedSheets(def, rows, o.maxRows);
  const title = o.title ?? `${def.code} ${def.title}`;
  const props = { title, ...(o.created ? { created: o.created } : {}) };
  if (format === "csv") {
    const { cols, rows: rs } = sheets[0]!;
    // Header text from the labels, keyed by position so a repeated label keeps its own column.
    const keys = cols.map((_, i) => `c${i}`);
    const out = toCsv(
      keys,
      rs.map((r) => Object.fromEntries(cols.map((c, i) => [keys[i], text(c, r[c.key])]))),
      { neutraliseFormulas: true },
    );
    // toCsv writes the keys as the header line: put the labels there (same BOM and quoting).
    const lines = out.toString("utf8").split("\r\n");
    lines[0] = toCsv(
      cols.map((c) => c.label),
      [],
      { neutraliseFormulas: true },
    )
      .toString("utf8")
      .split("\r\n")[0]!;
    return Buffer.from(lines.join("\r\n"), "utf8");
  }
  if (format === "pdf")
    return toPdf(pdfDocument(title, sheets), o.created ? { created: o.created } : {});
  const xs: XlsxSheet[] = sheets.map(({ sheet, cols, rows: rs }) => ({
    name: sheet.name,
    columns: cols.map((c, i): XlsxColumn => ({
      header: c.label,
      type: TYPE[c.type],
      key: `c${i}`,
    })),
    rows: rs.map((r) => Object.fromEntries(cols.map((c, i) => [`c${i}`, cell(c, r[c.key])]))),
    // ODS cannot carry an AutoFilter (`toOds` refuses it); the xlsx gets one.
    ...(format === "xlsx" ? { autoFilter: true } : {}),
  }));
  return format === "xlsx" ? toXlsx(xs, props) : toOds(xs, props);
}
