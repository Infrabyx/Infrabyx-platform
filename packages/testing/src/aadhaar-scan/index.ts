// The no-Aadhaar sweep (Udofin PR-UDF-042, R1-D-195): the platform's shared rule
// (`findAadhaarLike`, `@infrabyx/contracts/aadhaar`) run over files and directories
// (`infrabyx-aadhaar-scan`, CI's `aadhaar:scan`) and over a test database's text columns
// (`scanDatabaseForAadhaar`, for `startPostgres({ beforeDrop })`). A find carries the masked number
// only (`XXXX XXXX dddd`), never more of it.
//
// The sweep's reading of the shared rule ([ASSUMED – owner review] #146):
//   - `letters: "join"` by default, so the digits inside a hexadecimal hash, a base64 run or a ULID
//     are not read as a number (a SHA-256 in a recorded fixture otherwise reads as one about once in
//     four hundred); `letters: "boundary"` reads as the AI gateway's scrubber does;
//   - a UUID (8-4-4-4-12 hexadecimal) is an identifier, blanked before the rule runs (its last group
//     is twelve digits about once in three hundred);
//   - files: directories named `node_modules`, `.git` and `dist` are skipped, as are symbolic links,
//     a file with a NUL byte in its first 8 KiB (binary) and a file over `maxBytes` (default 5 MiB);
//     each skipped file is counted and named, never silently passed.
import { lstat, open, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  findAadhaarLike,
  type AadhaarLikeKind,
  type FindAadhaarOptions,
} from "@infrabyx/contracts/aadhaar";

export interface AadhaarScanOptions {
  /** How a letter next to digits reads (default `"join"`; see the header). */
  letters?: FindAadhaarOptions["letters"];
}

/** One find in a text: 1-based line and column, the kind and the masked number. */
export interface AadhaarTextFind {
  line: number;
  column: number;
  kind: AadhaarLikeKind;
  masked: string;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** The shared rule as the sweep reads it, over one text. */
export function scanTextForAadhaar(text: string, o: AadhaarScanOptions = {}): AadhaarTextFind[] {
  // Same length, so offsets and lines stay those of the text.
  const t = text.replace(UUID, (m) => "u".repeat(m.length));
  const finds = findAadhaarLike(t, { letters: o.letters ?? "join" });
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

export interface AadhaarDatabaseScanOptions extends AadhaarScanOptions {
  /** `schema.table` or `schema.table.column` entries not to read. */
  skip?: readonly string[];
}

/** One find in a database: where it is (the row by `ctid`) and the masked number. */
export interface AadhaarDatabaseFind {
  schema: string;
  table: string;
  column: string;
  ctid: string;
  kind: AadhaarLikeKind;
  masked: string;
}

const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;

/**
 * Read every text-like column (string types and domains over them, `json`, `jsonb`, and arrays of
 * them) of every ordinary table and partition outside the system schemas, as text, and sweep it.
 * Give it a superuser client (the `admin` of `startPostgres`): row-level security does not apply
 * to it, so every tenant's rows are read. Meant for test databases, from `beforeDrop`:
 *
 *   startPostgres({ beforeDrop: async (admin) =>
 *     expect(await scanDatabaseForAadhaar(admin)).toEqual([]) })
 */
export async function scanDatabaseForAadhaar(
  db: AadhaarScanQueryable,
  o: AadhaarDatabaseScanOptions = {},
): Promise<AadhaarDatabaseFind[]> {
  const skip = new Set(o.skip ?? []);
  const { rows } = await db.query<{ schema: string; table: string; column: string }>(
    `select n.nspname as schema, c.relname as table, a.attname as column
       from pg_catalog.pg_attribute a
       join pg_catalog.pg_class c on c.oid = a.attrelid
       join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       join pg_catalog.pg_type t on t.oid = a.atttypid
       left join pg_catalog.pg_type e on e.oid = t.typelem and t.typcategory = 'A'
      where c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
        and n.nspname not in ('pg_catalog', 'information_schema')
        and n.nspname not like 'pg\\_toast%' and n.nspname not like 'pg\\_temp%'
        and (t.typcategory = 'S' or t.typname in ('json', 'jsonb')
             or e.typcategory = 'S' or e.typname in ('json', 'jsonb'))
      order by n.nspname, c.relname, a.attnum`,
  );
  const tables = new Map<string, { schema: string; table: string; columns: string[] }>();
  for (const r of rows) {
    if (skip.has(`${r.schema}.${r.table}`) || skip.has(`${r.schema}.${r.table}.${r.column}`))
      continue;
    const k = `${r.schema}.${r.table}`;
    const t = tables.get(k) ?? { schema: r.schema, table: r.table, columns: [] };
    t.columns.push(r.column);
    tables.set(k, t);
  }
  const out: AadhaarDatabaseFind[] = [];
  for (const t of tables.values()) {
    const cols = t.columns.map((c, i) => `${ident(c)}::text as c${i}`).join(", ");
    const data = await db.query<Record<string, string | null>>(
      `select ctid::text as ctid, ${cols} from ${ident(t.schema)}.${ident(t.table)}`,
    );
    for (const row of data.rows)
      t.columns.forEach((column, i) => {
        const v = row[`c${i}`];
        if (v)
          for (const f of scanTextForAadhaar(v, o))
            out.push({
              schema: t.schema,
              table: t.table,
              column,
              ctid: row.ctid!,
              kind: f.kind,
              masked: f.masked,
            });
      });
  }
  return out;
}
