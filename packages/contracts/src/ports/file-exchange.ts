// Ecosystem Spec §3.11 file-transfer fallback: the file name and the manifest (PR-UDF-071, R1-D-254).
// §3.11: "a manifest (layout, version, count, control totals, period, SHA-256) signed by detached JWS
// … Name: `[producer]_[reid]_[layoutid]_v[major]_[yyyymmdd]_[seq].[ext]`". Pure helpers, no I/O and no
// cryptography: the caller hashes the file (`sha256Hex`, @infrabyx/crypto) and signs the manifest's
// RFC 8785 bytes (`canonicalize`) with the C-22 detached JWS (`signDetachedJws`), as every export
// manifest is. §3.11 names the manifest's fields without a shape; the shapes below are
// [ASSUMED – owner review] (#184 (8)): control totals are integer strings by name (minor units for
// amounts, so no float ever carries money), the period is two calendar dates, the version is the
// layout's `major.minor`. The acknowledgement file's layout is not fixed by §3.11 and is not here.
import { z } from "zod";

const PRODUCER = /^[a-z][a-z0-9]{1,15}$/;
const REID = /^[A-Za-z0-9-]{1,64}$/;
const LAYOUT = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const EXT = /^[a-z0-9]{1,10}(?:\.[a-z0-9]{1,4})?$/;
const DATE8 = /^(\d{4})(\d{2})(\d{2})$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface FileExchangeNameParts {
  /** The producing product or party, lower-case (`fbx`, `udf`). */
  producer: string;
  /** The regulated entity's id (no `_`). */
  reid: string;
  /** The registered layout id (Part 12), which may itself contain `_`. */
  layoutId: string;
  /** The layout's major version. */
  major: number;
  /** The file's business date, `YYYY-MM-DD`. */
  date: string;
  /** The sequence of the day, from 1. */
  seq: number;
  /** `csv`, `ndjson`, `json`, `xml`, `txt`, optionally with a compression suffix (`csv.gz`). */
  ext: string;
}

function validDate(y: number, m: number, d: number): boolean {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

function dateOk(iso: string): boolean {
  if (!ISO_DATE.test(iso)) return false;
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return validDate(y, m, d);
}

/** The §3.11 file name; throws a RangeError for a part outside its rule. */
export function fileExchangeName(p: FileExchangeNameParts): string {
  if (!PRODUCER.test(p.producer)) throw new RangeError("producer: lower-case letters and digits");
  if (!REID.test(p.reid)) throw new RangeError("reid: letters, digits and '-'");
  if (!LAYOUT.test(p.layoutId) || p.layoutId.length > 64) throw new RangeError("layoutId");
  if (!Number.isInteger(p.major) || p.major < 0 || p.major > 9999) throw new RangeError("major");
  if (!dateOk(p.date)) throw new RangeError("date: YYYY-MM-DD");
  if (!Number.isInteger(p.seq) || p.seq < 1 || p.seq > 999_999) throw new RangeError("seq");
  if (!EXT.test(p.ext)) throw new RangeError("ext");
  return `${p.producer}_${p.reid}_${p.layoutId}_v${p.major}_${p.date.replace(/-/g, "")}_${p.seq}.${p.ext}`;
}

/** The parts of a §3.11 file name, or null when it is not one. Read from the right (layout ids hold `_`). */
export function parseFileExchangeName(name: string): FileExchangeNameParts | null {
  if (typeof name !== "string" || name.length > 255) return null;
  const dot = name.indexOf(".");
  if (dot <= 0) return null;
  const ext = name.slice(dot + 1);
  const parts = name.slice(0, dot).split("_");
  if (parts.length < 6 || !EXT.test(ext)) return null;
  const seqS = parts.pop()!;
  const dateS = parts.pop()!;
  const majorS = parts.pop()!;
  const producer = parts.shift()!;
  const reid = parts.shift()!;
  const layoutId = parts.join("_");
  const dm = DATE8.exec(dateS);
  if (!/^[1-9]\d{0,5}$/.test(seqS) || !dm || !/^v(0|[1-9]\d{0,3})$/.test(majorS)) return null;
  const date = `${dm[1]}-${dm[2]}-${dm[3]}`;
  const out: FileExchangeNameParts = {
    producer,
    reid,
    layoutId,
    major: Number(majorS.slice(1)),
    date,
    seq: Number(seqS),
    ext,
  };
  try {
    return fileExchangeName(out) === name ? out : null;
  } catch {
    return null;
  }
}

const isoDate = z.string().refine(dateOk, "a calendar date YYYY-MM-DD");

/** The §3.11 manifest of one file (snake_case, as the Specification's payloads). */
export const FileExchangeManifest = z
  .object({
    file_name: z.string().refine((n) => parseFileExchangeName(n) !== null, "a §3.11 file name"),
    layout: z.string().regex(LAYOUT).max(64),
    /** The layout's version, `major` or `major.minor`; the major is the name's `v[major]`. */
    version: z.string().regex(/^(0|[1-9]\d{0,3})(\.(0|[1-9]\d{0,3})){0,2}$/),
    /** Records in the file (rows, lines or events; headers and trailers not counted). */
    count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    /** Named integer totals (amounts in minor units), as decimal strings. */
    control_totals: z
      .record(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), z.string().regex(/^-?(0|[1-9]\d{0,29})$/))
      .refine((r) => Object.keys(r).length <= 32, "at most 32 control totals"),
    period: z
      .object({ from: isoDate, to: isoDate })
      .strict()
      .refine((p) => p.from <= p.to, "from is on or before to"),
    /** Lower-case hex SHA-256 of the file's bytes as sent. */
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict()
  .refine((m) => {
    const n = parseFileExchangeName(m.file_name);
    return n !== null && n.layoutId === m.layout && String(n.major) === m.version.split(".")[0];
  }, "the file name's layout and major version are the manifest's");
export type FileExchangeManifest = z.infer<typeof FileExchangeManifest>;

/** Build and check a manifest (throws a ZodError when it breaks a rule above). */
export function fileExchangeManifest(m: FileExchangeManifest): FileExchangeManifest {
  return FileExchangeManifest.parse(m);
}

/** What a receiver checks a manifest against. */
export interface FileExchangeReceived {
  /** The file's name as received. */
  fileName: string;
  /** Lower-case hex SHA-256 of the bytes received. */
  sha256: string;
  /** Records the receiver counted, when it parsed the file. */
  count?: number;
  /** Totals the receiver computed, when it parsed the file. */
  controlTotals?: Readonly<Record<string, string>>;
}

/**
 * The mismatches between a (signature-verified) manifest and the file received, as fixed labels:
 * `manifest` (not a valid manifest), `file_name`, `sha256`, `count`, `control_totals.<name>`.
 * Empty when they agree.
 */
export function checkFileExchangeManifest(manifest: unknown, got: FileExchangeReceived): string[] {
  const r = FileExchangeManifest.safeParse(manifest);
  if (!r.success) return ["manifest"];
  const m = r.data;
  const out: string[] = [];
  if (m.file_name !== got.fileName) out.push("file_name");
  if (m.sha256 !== got.sha256) out.push("sha256");
  if (got.count !== undefined && got.count !== m.count) out.push("count");
  if (got.controlTotals)
    for (const k of new Set([...Object.keys(m.control_totals), ...Object.keys(got.controlTotals)]))
      if (m.control_totals[k] !== got.controlTotals[k]) out.push(`control_totals.${k}`);
  return out;
}
