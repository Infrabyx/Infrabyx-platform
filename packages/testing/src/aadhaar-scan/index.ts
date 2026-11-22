// The no-Aadhaar sweep (Udofin PR-UDF-042, R1-D-195): the platform's shared rule
// (`findAadhaarLike`, `@infrabyx/contracts/aadhaar`) run over files and directories
// (`infrabyx-aadhaar-scan`, CI's `aadhaar:scan`) and over every column of a test database
// (`sweepDatabaseForAadhaar`, `scanDatabaseForAadhaar`, for `startPostgres({ beforeDrop })`). A find
// carries the masked number only (`XXXX XXXX dddd`), never more of it.
//
// The sweep's reading of the shared rule ([ASSUMED – owner review] #146):
//   - `letters: "join"` by default, so the digits inside a hexadecimal hash, a base64 run or a ULID
//     are not read as a number (a SHA-256 in a recorded fixture otherwise reads as one about once in
//     four hundred); `letters: "boundary"` reads as the AI gateway's scrubber does;
//   - a standalone UUID (8-4-4-4-12 hexadecimal) is an identifier, blanked before the rule runs (its
//     last group is twelve digits about once in three hundred). Standalone (PR-UDF-063): no letter
//     or digit right before or after it, and no group of four digits joined to it by one
//     whitespace character or hyphen, so digits glued to a UUID-shaped string are still read, as
//     the rule's grouping would read them;
//   - look-alikes (`+91` phone numbers, decimals) are finds unless the caller passes `allow`
//     (`@infrabyx/contracts/aadhaar` `AADHAAR_LOOK_ALIKES`): the product's choice, never the
//     default;
//   - files: directories named `node_modules`, `.git` and `dist` are skipped, as are symbolic links,
//     a file with a NUL byte in its first 8 KiB (binary) and a file over `maxBytes` (default 5 MiB);
//     each skipped file is counted and named, never silently passed;
//   - the database (PR-UDF-063, R1-D-242): every column of every type, and a column or JSON field
//     named like an Aadhaar carrier (`isAadhaarFieldName`) is a `FIELD` find when it holds a
//     value, whatever the value. A sweep that reads no table or no row, or more than `maxRows`,
//     rejects instead of passing.
//   - three more checks (PR-UDF-079, R1-D-270), on by default with no switch to turn them off:
//     (1) a column named like a carrier is a `COLUMN` find from the catalogue alone, with no row
//     read, even when every value is null or blank (the table's shape is the find); (2) a carrier
//     name inside a longer name (`isAadhaarCarrierName`: `borrower_aadhaar_ref`, `kyc_uid_token`,
//     `uidai_token`) counts as a carrier name for columns and JSON keys; (3) a carrier name followed
//     by a value in free text (`findAadhaarLabelledValues`: `aadhaar: <number>`, `Aadhaar No. XXXX
//     XXXX dddd`) is a `LABELLED` find in files and in text values, masked or not, Verhoeff-valid or
//     not. A last-four name (`aadhaar_last_digits`, `aadhaarLast4`) is reported only for a value
//     with more than four digits, and its column is no `COLUMN` find; a `boolean` column is none
//     either. `skip` stays the product's per-column opt-out.
import { lstat, open, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  findAadhaarCarrierFields,
  findAadhaarLabelledValues,
  findAadhaarLike,
  holdsAadhaarCarrierValue,
  isAadhaarCarrierName,
  isAadhaarLastFourName,
  type AadhaarLikeKind,
  type AadhaarLookAlike,
  type FindAadhaarOptions,
} from "@infrabyx/contracts/aadhaar";

export interface AadhaarScanOptions {
  /** How a letter next to digits reads (default `"join"`; see the header). */
  letters?: FindAadhaarOptions["letters"];
  /**
   * Look-alikes to let through (default none, strict): `e164_in` (`+91` and ten digits), `decimal`
   * (digits joined to a `.` with a digit beyond it). The product's choice, and its risk.
   */
  allow?: readonly AadhaarLookAlike[];
}

/**
 * `LABELLED` (PR-UDF-079): a carrier name followed by a value (`findAadhaarLabelledValues`); its
 * `masked` is `(value withheld)`, and its column the label's.
 */
export type AadhaarTextFindKind = AadhaarLikeKind | "LABELLED";

/** One find in a text: 1-based line and column, the kind and the masked number. */
export interface AadhaarTextFind {
  line: number;
  column: number;
  kind: AadhaarTextFindKind;
  masked: string;
}

const WITHHELD = "(value withheld)";

// Standalone only (PR-UDF-063): no letter or digit right before or after it, and no group of four
// digits joined to it by one whitespace character or hyphen (the rule's own grouping, which would
// read the UUID's digits and the group's as one number).
const UUID =
  /(?<![0-9A-Za-z])(?<![0-9]{4}[\s-])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![0-9A-Za-z])(?![\s-][0-9]{4})/gi;

/** The shared rule as the sweep reads it, over one text. */
export function scanTextForAadhaar(text: string, o: AadhaarScanOptions = {}): AadhaarTextFind[] {
  // Same length, so offsets and lines stay those of the text.
  const t = text.replace(UUID, (m) => "u".repeat(m.length));
  const finds: { start: number; kind: AadhaarTextFindKind; masked: string }[] = [
    ...findAadhaarLike(t, { letters: o.letters ?? "join", allow: o.allow ?? [] }),
    ...findAadhaarLabelledValues(t).map((f) => ({
      start: f.start,
      kind: "LABELLED" as const,
      masked: WITHHELD,
    })),
  ].sort((a, b) => a.start - b.start);
  if (!finds.length) return [];
  const out: AadhaarTextFind[] = [];
  let line = 1;
  let lineStart = 0;
  let at = 0;
  for (const f of finds) {
    for (; at < f.start; at++)
      if (t.charCodeAt(at) === 10) {
        line++;
        lineStart = at + 1;
      }
    out.push({ line, column: f.start - lineStart + 1, kind: f.kind, masked: f.masked });
  }
  return out;
}

/** Directory names the file sweep never enters. */
export const AADHAAR_SCAN_SKIPPED_DIRS: readonly string[] = ["node_modules", ".git", "dist"];
/** Files larger than this are named and skipped (5 MiB). */
export const AADHAAR_SCAN_MAX_BYTES = 5 * 1024 * 1024;
const SNIFF_BYTES = 8192;

export interface AadhaarFileScanOptions extends AadhaarScanOptions {
  maxBytes?: number;
}

export interface AadhaarFileFind extends AadhaarTextFind {
  file: string;
}

export interface AadhaarFileScan {
  finds: AadhaarFileFind[];
  /** Files read. */
  files: number;
  /** Files not read, and why. */
  skipped: { file: string; reason: "binary" | "too_large" | "symlink" }[];
}

/**
 * Sweep files and directories (recursively). A path that does not exist rejects (the CLI's usage
 * error); the finds come in path order, then file order, then text order.
 */
export async function scanPathsForAadhaar(
  paths: readonly string[],
  o: AadhaarFileScanOptions = {},
): Promise<AadhaarFileScan> {
  const max = o.maxBytes ?? AADHAAR_SCAN_MAX_BYTES;
  const r: AadhaarFileScan = { finds: [], files: 0, skipped: [] };
  const visit = async (p: string, top: boolean): Promise<void> => {
    const st = await lstat(p);
    if (st.isSymbolicLink()) {
      r.skipped.push({ file: p, reason: "symlink" });
      return;
    }
    if (st.isDirectory()) {
      if (!top && AADHAAR_SCAN_SKIPPED_DIRS.includes(p.split(/[\\/]/).at(-1)!)) return;
      const entries = (await readdir(p)).sort();
      for (const e of entries) await visit(join(p, e), false);
      return;
    }
    if (!st.isFile()) return;
    if (st.size > max) {
      r.skipped.push({ file: p, reason: "too_large" });
      return;
    }
    if (await looksBinary(p)) {
      r.skipped.push({ file: p, reason: "binary" });
      return;
    }
    r.files++;
    const text = await readFile(p, "utf8");
    for (const f of scanTextForAadhaar(text, o)) r.finds.push({ file: p, ...f });
  };
  for (const p of paths) await visit(p, true);
  return r;
}

async function looksBinary(p: string): Promise<boolean> {
  const fh = await open(p, "r");
  try {
    const buf = Buffer.alloc(SNIFF_BYTES);
    const { bytesRead } = await fh.read(buf, 0, SNIFF_BYTES, 0);
    return buf.subarray(0, bytesRead).includes(0);
  } finally {
    await fh.close();
  }
}

/** A client that runs SQL (`pg.Client`, `pg.Pool`, the `admin` of `startPostgres`). */
export interface AadhaarScanQueryable {
  query<R extends Record<string, unknown>>(sql: string): Promise<{ rows: R[] }>;
}

/** Rows the database sweep reads in all before it rejects (`maxRows`). */
export const AADHAAR_DB_SCAN_MAX_ROWS = 100_000;
const DB_BATCH_ROWS = 100;

export interface AadhaarDatabaseScanOptions extends AadhaarScanOptions {
  /** `schema.table` or `schema.table.column` entries not to read. */
  skip?: readonly string[];
  /**
   * The most rows to read in all (default `AADHAAR_DB_SCAN_MAX_ROWS`); a database with more
   * rejects with `AadhaarScanLimitError` rather than pass on a partial read.
   */
  maxRows?: number;
  /**
   * Pass a sweep that read no table or no row (default `false`: it rejects with
   * `AadhaarScanEmptyError`, as a sweep that read nothing proves nothing).
   */
  allowEmpty?: boolean;
}

/**
 * `FIELD`: a column or JSON field named like an Aadhaar carrier holds a value (PR-UDF-063).
 * `COLUMN`: a column is named like a carrier, whatever it holds (PR-UDF-079). `LABELLED`: a
 * carrier name followed by a value in a text value or a JSON string (PR-UDF-079).
 */
export type AadhaarDatabaseFindKind = AadhaarTextFindKind | "FIELD" | "COLUMN";

/** One find in a database: where it is (the row by `ctid`) and the masked number. */
export interface AadhaarDatabaseFind {
  schema: string;
  table: string;
  column: string;
  /** The row; `""` for a `COLUMN` find, which comes from the catalogue, not a row. */
  ctid: string;
  kind: AadhaarDatabaseFindKind;
  /**
   * The masked number; `(value withheld)` for a `FIELD` or `LABELLED` find and `(column)` for a
   * `COLUMN` find: never the value.
   */
  masked: string;
  /** For a `FIELD` find inside a JSON value: the key path below the column (`kyc.0.uid`). */
  field?: string;
}

/** What a database sweep read, and found. */
export interface AadhaarDatabaseScan {
  finds: AadhaarDatabaseFind[];
  /** Tables read (after `skip`). */
  tables: number;
  /** Rows read, over every table. */
  rows: number;
}

/** The sweep read no table or no row (and `allowEmpty` was not set): nothing was proven. */
export class AadhaarScanEmptyError extends Error {
  override name = "AadhaarScanEmptyError";
}

/** The database holds more rows than `maxRows`: the sweep stops and rejects, never passes. */
export class AadhaarScanLimitError extends Error {
  override name = "AadhaarScanLimitError";
}

const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;
const COLUMN = "(column)";
const CTID = /^\(\d+,\d+\)$/;

/**
 * Read every column of every type (each cast to its text form: numbers, arrays, `json` as
 * written, `jsonb`, composites, `bytea` as hex and also decoded) of every row of every ordinary
 * table and partition outside the system schemas, and sweep it: the number rule
 * (`scanTextForAadhaar`) over each value, and the named-field rule (PR-UDF-063): a column named
 * like an Aadhaar carrier (`isAadhaarCarrierName`, PR-UDF-079) holding a value, or such a field
 * inside a JSON value (a `json` or `jsonb` column, or text that parses as a JSON object or array).
 * Each carrier-named column is also a `COLUMN` find, from the catalogue before any row is read,
 * and a carrier name followed by a value in a text value or a JSON string is a `LABELLED` find
 * (PR-UDF-079). Rows are read in batches by `ctid`, at most `maxRows` in all. Give it a superuser
 * client (the `admin` of `startPostgres`): row-level security does not apply to it, so every
 * tenant's rows are read. Meant for test databases, from `beforeDrop`. A sweep that read no table
 * or no row rejects (`AadhaarScanEmptyError`) only when it found nothing: a `COLUMN` find needs
 * no row.
 */
export async function sweepDatabaseForAadhaar(
  db: AadhaarScanQueryable,
  o: AadhaarDatabaseScanOptions = {},
): Promise<AadhaarDatabaseScan> {
  const skip = new Set(o.skip ?? []);
  const maxRows = o.maxRows ?? AADHAAR_DB_SCAN_MAX_ROWS;
  if (!Number.isInteger(maxRows) || maxRows < 1)
    throw new RangeError("maxRows must be a positive integer");
  const { rows } = await db.query<{
    schema: string;
    table: string;
    column: string | null;
    type: string | null;
  }>(
    `select n.nspname as schema, c.relname as table, a.attname as column, t.typname as type
       from pg_catalog.pg_class c
       join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       left join pg_catalog.pg_attribute a
         on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
       left join pg_catalog.pg_type t on t.oid = a.atttypid
      where c.relkind = 'r'
        and n.nspname not in ('pg_catalog', 'information_schema')
        and n.nspname not like 'pg\\_toast%' and n.nspname not like 'pg\\_temp%'
      order by n.nspname, c.relname, a.attnum`,
  );
  type Table = { schema: string; table: string; columns: { name: string; type: string }[] };
  const tables = new Map<string, Table>();
  for (const r of rows) {
    const k = `${r.schema}.${r.table}`;
    if (skip.has(k)) continue;
    const t = tables.get(k) ?? { schema: r.schema, table: r.table, columns: [] };
    tables.set(k, t);
    if (r.column !== null && !skip.has(`${k}.${r.column}`))
      t.columns.push({ name: r.column, type: r.type ?? "" });
  }
  const scan: AadhaarDatabaseScan = { finds: [], tables: tables.size, rows: 0 };
  for (const t of tables.values()) {
    // PR-UDF-079 (1): the shape is the find. A boolean holds no number, and a last-four column is
    // judged by its values.
    for (const c of t.columns)
      if (isAadhaarCarrierName(c.name) && !isAadhaarLastFourName(c.name) && c.type !== "bool")
        scan.finds.push({
          schema: t.schema,
          table: t.table,
          column: c.name,
          ctid: "",
          kind: "COLUMN",
          masked: COLUMN,
        });
    const cols = t.columns.map((c, i) => `, r.${ident(c.name)}::text as c${i}`).join("");
    let after = "(0,0)";
    for (;;) {
      const limit = Math.min(DB_BATCH_ROWS, maxRows - scan.rows + 1);
      const data = await db.query<Record<string, string | null>>(
        `select r.ctid::text as ctid${cols} from ${ident(t.schema)}.${ident(t.table)} as r
          where r.ctid > '${after}'::tid order by r.ctid limit ${limit}`,
      );
      for (const row of data.rows) {
        if (++scan.rows > maxRows)
          throw new AadhaarScanLimitError(
            `scanDatabaseForAadhaar: more than ${maxRows} row(s) (maxRows); a partial read never passes`,
          );
        t.columns.forEach((c, i) => sweepValue(scan, t, c, row.ctid!, row[`c${i}`] ?? null, o));
      }
      if (data.rows.length < limit) break;
      after = data.rows.at(-1)!.ctid!;
      if (!CTID.test(after)) throw new Error(`scanDatabaseForAadhaar: unexpected ctid ${after}`);
    }
  }
  if (!o.allowEmpty && !scan.finds.length && (scan.tables === 0 || scan.rows === 0))
    throw new AadhaarScanEmptyError(
      `scanDatabaseForAadhaar: read ${scan.tables} table(s) and ${scan.rows} row(s); a sweep that reads nothing proves nothing (allowEmpty)`,
    );
  return scan;
}

function sweepValue(
  scan: AadhaarDatabaseScan,
  t: { schema: string; table: string },
  c: { name: string; type: string },
  ctid: string,
  v: string | null,
  o: AadhaarScanOptions,
): void {
  if (v === null) return;
  const at = { schema: t.schema, table: t.table, column: c.name, ctid };
  const json = asJson(v, c.type);
  if (isAadhaarCarrierName(c.name)) {
    if (namedColumnHolds(c.name, v, c.type, json))
      scan.finds.push({ ...at, kind: "FIELD", masked: WITHHELD });
  } else if (json !== undefined)
    for (const f of findAadhaarCarrierFields(json))
      scan.finds.push({ ...at, kind: "FIELD", masked: WITHHELD, field: f.path.join(".") });
  // bytea reads as `\x` and hex: the hex is read without its `\x` (which would join the run), and
  // the bytes are read as text too, so digits stored as bytes count.
  const texts =
    c.type === "bytea" && /^\\x(?:[0-9a-f]{2})*$/i.test(v)
      ? [v.slice(2), Buffer.from(v.slice(2), "hex").toString("latin1")]
      : [v];
  for (const text of texts)
    for (const f of scanTextForAadhaar(text, o))
      // A JSON value's labels are read in its strings below (its keys are the field rule's).
      if (!(json !== undefined && f.kind === "LABELLED"))
        scan.finds.push({ ...at, kind: f.kind, masked: f.masked });
  if (json !== undefined)
    for (const s of jsonStrings(json))
      if (findAadhaarLabelledValues(s).length)
        scan.finds.push({ ...at, kind: "LABELLED", masked: WITHHELD });
}

/** Every string inside a parsed JSON value, keys left out, in document order. */
function jsonStrings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) jsonStrings(x, out);
  else if (v && typeof v === "object") for (const x of Object.values(v)) jsonStrings(x, out);
  return out;
}

/**
 * Whether a carrier-named column's value holds something: `holdsAadhaarCarrierValue` over its
 * JSON or its text (a last-four column: more than four digits), except that a `boolean` holds
 * nothing and an array (`{}`, `{NULL,""}`) holds something only when an element does.
 */
function namedColumnHolds(name: string, v: string, type: string, json: unknown): boolean {
  if (json !== undefined) return holdsAadhaarCarrierValue(name, json);
  if (type === "bool") return false;
  if (isAadhaarLastFourName(name)) return holdsAadhaarCarrierValue(name, v);
  if (type.startsWith("_")) return /[^{}",\s]/.test(v.replace(/\bNULL\b/g, ""));
  return holdsAadhaarCarrierValue(name, v);
}

/** The parsed value of a `json` or `jsonb` column, or of text holding a JSON object or array. */
function asJson(v: string, type: string): unknown {
  const s = v.trimStart();
  if (!(type === "json" || type === "jsonb" || s.startsWith("{") || s.startsWith("[")))
    return undefined;
  try {
    return JSON.parse(v) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * `sweepDatabaseForAadhaar`, its finds only (the PR-UDF-042 form; it rejects as the sweep does):
 *
 *   startPostgres({ beforeDrop: async (admin) =>
 *     expect(await scanDatabaseForAadhaar(admin)).toEqual([]) })
 */
export async function scanDatabaseForAadhaar(
  db: AadhaarScanQueryable,
  o: AadhaarDatabaseScanOptions = {},
): Promise<AadhaarDatabaseFind[]> {
  return (await sweepDatabaseForAadhaar(db, o)).finds;
}
