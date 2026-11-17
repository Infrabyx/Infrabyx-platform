// A bounded XLSX reader for untrusted uploads (LawDocsComply PR-LDC-31 reader; R1-D-114, M84;
// R1-D-154; threat model §3.127). No dependency: the ZIP container is read with explicit limits
// before anything is inflated, and the parts are read with a small XML scanner that refuses a
// DOCTYPE or any entity other than the five predefined ones and character references, so there is
// no entity expansion and no external fetch. Cells come back as values only: a formula's cached
// result, never the formula; dates as ISO strings where the cell's number format is a date format.
//
// Refusals are `IpbError`s: `IPB-SEC-013` for a size, count or ratio limit, `IPB-SEC-012` for active
// content (a macro project, a DOCTYPE), `IPB-SEC-010` for anything that is not a well-formed
// workbook. Run the AV port (`FileScanPort`) on the upload first: this reader is not a malware scan.
import { crc32, inflateRawSync } from "node:zlib";
import { IpbError } from "@infrabyx/contracts/errors";

export interface XlsxReadLimits {
  /** Compressed upload size (default 25 MiB, the AV adapter's default). */
  maxFileBytes?: number;
  /** ZIP entries (default 1,000). */
  maxEntries?: number;
  /** Uncompressed size of one part (default 64 MiB). */
  maxPartBytes?: number;
  /** Uncompressed size of every part read together (default 256 MiB). */
  maxTotalBytes?: number;
  /** Largest uncompressed-to-compressed ratio of a part (default 200). */
  maxRatio?: number;
  /** Sheets (default 255, Excel's limit). */
  maxSheets?: number;
  /** Rows per sheet (default 100,000). */
  maxRows?: number;
  /** Columns per row (default 1,024). */
  maxColumns?: number;
  /** Characters per cell (default 32,767, Excel's limit). */
  maxCellChars?: number;
  /** Shared strings (default 1,000,000). */
  maxSharedStrings?: number;
}

export type XlsxCellValue = string | number | boolean | null;

export interface XlsxReadSheet {
  name: string;
  /** Rows in order; a missing row or cell is an empty array or `null` (rows are dense). */
  rows: XlsxCellValue[][];
}

const DEFAULTS: Required<XlsxReadLimits> = {
  maxFileBytes: 25 * 1024 * 1024,
  maxEntries: 1000,
  maxPartBytes: 64 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
  maxRatio: 200,
  maxSheets: 255,
  maxRows: 100_000,
  maxColumns: 1024,
  maxCellChars: 32_767,
  maxSharedStrings: 1_000_000,
};

const limit = (detail: string) =>
  new IpbError("IPB-SEC-013", { detail, meta: { reason: "limit" } });
const malformed = (detail: string) =>
  new IpbError("IPB-SEC-010", { detail, meta: { reason: "malformed" } });
const active = (detail: string) =>
  new IpbError("IPB-SEC-012", { detail, meta: { reason: "active" } });

interface Entry {
  name: string;
  method: number;
  crc: number;
  csize: number;
  usize: number;
  start: number;
}

/** The central directory, checked against every limit before a byte is inflated. */
function directory(b: Buffer, l: Required<XlsxReadLimits>): Map<string, Entry> {
  if (b.length > l.maxFileBytes) throw limit(`the file is over ${l.maxFileBytes} bytes`);
  let e = b.length - 22;
  const floor = Math.max(0, b.length - 22 - 0xffff);
  while (e >= floor && b.readUInt32LE(e) !== 0x06054b50) e -= 1;
  if (e < floor) throw malformed("not a ZIP archive");
  const count = b.readUInt16LE(e + 10);
  const cdSize = b.readUInt32LE(e + 12);
  let p = b.readUInt32LE(e + 16);
  if (count === 0xffff || p === 0xffffffff) throw malformed("ZIP64 archives are not read");
  if (count > l.maxEntries) throw limit(`more than ${l.maxEntries} entries`);
  if (p + cdSize > e) throw malformed("corrupt central directory");
  const out = new Map<string, Entry>();
  for (let i = 0; i < count; i++) {
    if (p + 46 > e || b.readUInt32LE(p) !== 0x02014b50)
      throw malformed("corrupt central directory");
    const flags = b.readUInt16LE(p + 8);
    const method = b.readUInt16LE(p + 10);
    const crc = b.readUInt32LE(p + 16);
    const csize = b.readUInt32LE(p + 20);
    const usize = b.readUInt32LE(p + 24);
    const nlen = b.readUInt16LE(p + 28);
    const xlen = b.readUInt16LE(p + 30);
    const clen = b.readUInt16LE(p + 32);
    const local = b.readUInt32LE(p + 42);
    const name = b.subarray(p + 46, p + 46 + nlen).toString("utf8");
    if (flags & 0x1) throw malformed("encrypted entries are not read");
    if (method !== 0 && method !== 8) throw malformed(`compression method ${method}`);
    if (name.includes("..") || name.startsWith("/") || name.includes("\\") || name.includes("\0"))
      throw malformed("unsafe entry name");
    if (out.has(name)) throw malformed("duplicate entry name");
    if (usize > l.maxPartBytes) throw limit(`a part is over ${l.maxPartBytes} bytes`);
    if (csize > 0 && usize / csize > l.maxRatio)
      throw limit("a part's compression ratio is too high");
    if (method === 0 && csize !== usize) throw malformed("stored entry sizes differ");
    if (local + 30 > b.length || b.readUInt32LE(local) !== 0x04034b50)
      throw malformed("corrupt local header");
    const start = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
    if (start + csize > b.length) throw malformed("an entry runs past the end of the file");
    out.set(name, { name, method, crc, csize, usize, start });
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

class Parts {
  private total = 0;
  constructor(
    private readonly b: Buffer,
    private readonly dir: Map<string, Entry>,
    private readonly l: Required<XlsxReadLimits>,
  ) {}
  has(name: string): boolean {
    return this.dir.has(name);
  }
  names(): string[] {
    return [...this.dir.keys()];
  }
  text(name: string): string | null {
    const e = this.dir.get(name);
    if (!e) return null;
    this.total += e.usize;
    if (this.total > this.l.maxTotalBytes) throw limit(`over ${this.l.maxTotalBytes} bytes in all`);
    const raw = this.b.subarray(e.start, e.start + e.csize);
    let data: Buffer;
    try {
      // The declared size bounds the output: a part that inflates further is refused.
      data = e.method === 0 ? Buffer.from(raw) : inflateRawSync(raw, { maxOutputLength: e.usize });
    } catch {
      throw malformed(`part ${name} does not inflate to its declared size`);
    }
    if (data.length !== e.usize) throw malformed(`part ${name} is not its declared size`);
    if (crc32(data) !== e.crc) throw malformed(`CRC mismatch in ${name}`);
    return data.toString("utf8");
  }
}

// ---- a minimal XML scanner (no DTD, no entities beyond the predefined five) -------------------

interface Tag {
  name: string;
  attrs: Record<string, string>;
  close: boolean;
  selfClose: boolean;
  /** Text since the previous tag (decoded). */
  text: string;
}

const PREDEFINED: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]+);/g, (_m, r: string) => {
    if (r[0] === "#") {
      const cp = r[1] === "x" ? parseInt(r.slice(2), 16) : parseInt(r.slice(1), 10);
      if (!(cp > 0 && cp <= 0x10ffff) || (cp >= 0xd800 && cp <= 0xdfff))
        throw malformed("invalid character reference");
      return String.fromCodePoint(cp);
    }
    const v = PREDEFINED[r];
    if (v === undefined) throw malformed(`entity &${r}; is not allowed`);
    return v;
  });
}

function* scan(xml: string): Generator<Tag> {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw active("a DOCTYPE or entity declaration");
  let i = 0;
  let text = "";
  while (i < xml.length) {
    const lt = xml.indexOf("<", i);
    if (lt < 0) break;
    text += xml.slice(i, lt);
    if (xml.startsWith("<?", lt)) {
      const end = xml.indexOf("?>", lt);
      if (end < 0) throw malformed("unterminated processing instruction");
      i = end + 2;
      continue;
    }
    if (xml.startsWith("<!--", lt)) {
      const end = xml.indexOf("-->", lt);
      if (end < 0) throw malformed("unterminated comment");
      i = end + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", lt)) {
      const end = xml.indexOf("]]>", lt);
      if (end < 0) throw malformed("unterminated CDATA");
      text += xml
        .slice(lt + 9, end)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;");
      i = end + 3;
      continue;
    }
    const gt = xml.indexOf(">", lt);
    if (gt < 0) throw malformed("unterminated tag");
    const body = xml.slice(lt + 1, gt);
    const close = body.startsWith("/");
    const selfClose = body.endsWith("/");
    const inner = body.slice(close ? 1 : 0, selfClose ? -1 : undefined).trim();
    const sp = inner.search(/\s/);
    const qname = sp < 0 ? inner : inner.slice(0, sp);
    const name = qname.includes(":") ? qname.slice(qname.indexOf(":") + 1) : qname;
    const attrs: Record<string, string> = {};
    if (sp >= 0) {
      const re = /([A-Za-z_][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(inner.slice(sp)))) {
        const k = m[1]!;
        attrs[k] = decode(m[3] ?? m[4] ?? "");
      }
    }
    yield { name, attrs, close, selfClose, text: decode(text) };
    text = "";
    i = gt + 1;
  }
}

// ---- workbook structure -----------------------------------------------------------------------

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

function isDateFormat(code: string): boolean {
  const bare = code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, "");
  return /[ymdhs]/i.test(bare) && !/^[#0.,%E+\-\s]*$/.test(bare);
}

function dateStyles(xml: string | null): Set<number> {
  const out = new Set<number>();
  if (!xml) return out;
  const custom = new Map<number, string>();
  let inXfs = false;
  let index = 0;
  for (const t of scan(xml)) {
    if (t.name === "numFmt" && !t.close)
      custom.set(Number(t.attrs.numFmtId), t.attrs.formatCode ?? "");
    if (t.name === "cellXfs") inXfs = !t.close && !t.selfClose;
    else if (inXfs && t.name === "xf" && !t.close) {
      const id = Number(t.attrs.numFmtId ?? 0);
      if (BUILTIN_DATE_FORMATS.has(id) || isDateFormat(custom.get(id) ?? "")) out.add(index);
      index += 1;
    }
  }
  return out;
}

function sharedStrings(xml: string | null, l: Required<XlsxReadLimits>): string[] {
  const out: string[] = [];
  if (!xml) return out;
  let cur: string | null = null;
  let inT = false;
  let inRph = false;
  for (const t of scan(xml)) {
    if (inT && !inRph && cur !== null) cur += t.text;
    if (t.name === "si") {
      if (!t.close) cur = t.selfClose ? null : "";
      if (t.selfClose) out.push("");
      if (t.close && cur !== null) {
        if (cur.length > l.maxCellChars) throw limit("a shared string is too long");
        out.push(cur);
        if (out.length > l.maxSharedStrings) throw limit("too many shared strings");
        cur = null;
      }
    } else if (t.name === "t") inT = !t.close && !t.selfClose;
    else if (t.name === "rPh") inRph = !t.close && !t.selfClose;
  }
  return out;
}

function columnIndex(ref: string): number {
  const m = /^([A-Z]{1,3})\d+$/.exec(ref);
  if (!m) throw malformed(`cell reference ${ref}`);
  let n = 0;
  for (const c of m[1]!) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

const DAY_MS = 86_400_000;

function serialToIso(serial: number, date1904: boolean): string {
  // 1900 system: serial 25569 is 1970-01-01 (Excel's 1900 leap-year bug sits before serial 61).
  const days = date1904 ? serial - 24107 : serial - 25569;
  const ms = Math.round(days * DAY_MS);
  const iso = new Date(ms).toISOString();
  return Math.abs(serial % 1) < 1e-9 ? iso.slice(0, 10) : iso.replace(".000Z", "Z");
}

function readSheet(
  xml: string,
  strings: readonly string[],
  dates: ReadonlySet<number>,
  date1904: boolean,
  l: Required<XlsxReadLimits>,
): XlsxCellValue[][] {
  const rows: XlsxCellValue[][] = [];
  let row: XlsxCellValue[] | null = null;
  let cell: { col: number; type: string; style: number } | null = null;
  let value: string | null = null;
  let inV = false;
  let inT = false;
  let nextRow = 0;
  let nextCol = 0;
  for (const t of scan(xml)) {
    if ((inV || inT) && cell) value = (value ?? "") + t.text;
    switch (t.name) {
      case "row":
        if (!t.close) {
          const r = t.attrs.r ? Number(t.attrs.r) - 1 : nextRow;
          if (!Number.isInteger(r) || r < nextRow) throw malformed("rows out of order");
          if (r >= l.maxRows) throw limit(`more than ${l.maxRows} rows`);
          while (rows.length < r) rows.push([]);
          row = [];
          nextCol = 0;
          if (t.selfClose) {
            rows.push(row);
            row = null;
            nextRow = r + 1;
          } else nextRow = r + 1;
        } else if (row) {
          rows.push(row);
          row = null;
        }
        break;
      case "c":
        if (!t.close) {
          if (!row) throw malformed("a cell outside a row");
          const col = t.attrs.r ? columnIndex(t.attrs.r) : nextCol;
          if (col >= l.maxColumns) throw limit(`more than ${l.maxColumns} columns`);
          if (col < nextCol) throw malformed("cells out of order");
          cell = { col, type: t.attrs.t ?? "n", style: Number(t.attrs.s ?? 0) };
          value = null;
          nextCol = col + 1;
        }
        if (cell && row && (t.close || t.selfClose)) {
          while (row.length < cell.col) row.push(null);
          row.push(cellValue(cell, value, strings, dates, date1904, l));
          cell = null;
          value = null;
        }
        break;
      case "v":
        inV = !t.close && !t.selfClose;
        break;
      case "t":
        inT = !t.close && !t.selfClose && cell?.type === "inlineStr";
        break;
      default:
        break;
    }
  }
  return rows;
}

function cellValue(
  cell: { type: string; style: number },
  raw: string | null,
  strings: readonly string[],
  dates: ReadonlySet<number>,
  date1904: boolean,
  l: Required<XlsxReadLimits>,
): XlsxCellValue {
  if (raw === null) return null;
  let v: XlsxCellValue;
  switch (cell.type) {
    case "s": {
      const i = Number(raw);
      if (!Number.isInteger(i) || i < 0 || i >= strings.length)
        throw malformed("shared string index");
      v = strings[i]!;
      break;
    }
    case "inlineStr":
    case "str":
      v = raw;
      break;
    case "b":
      v = raw.trim() === "1";
      break;
    case "e":
      return null;
    default: {
      const n = Number(raw);
      if (!Number.isFinite(n)) throw malformed("a number cell is not a number");
      v = dates.has(cell.style) ? serialToIso(n, date1904) : n;
    }
  }
  if (typeof v === "string" && v.length > l.maxCellChars) throw limit("a cell is too long");
  return v;
}

/**
 * Read every sheet's values. Refuses a macro project (`IPB-SEC-012`), anything over a limit
 * (`IPB-SEC-013`) and anything that is not a well-formed workbook (`IPB-SEC-010`).
 */
export function readXlsx(bytes: Uint8Array, limits: XlsxReadLimits = {}): XlsxReadSheet[] {
  const l = { ...DEFAULTS, ...limits };
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts = new Parts(b, directory(b, l), l);
  if (parts.names().some((n) => /vbaProject\.bin$/i.test(n) || /activeX\/.*\.bin$/i.test(n)))
    throw active("a macro or ActiveX project");
  const wb = parts.text("xl/workbook.xml");
  if (wb === null) throw malformed("no xl/workbook.xml");
  const sheets: Array<{ name: string; rid: string }> = [];
  let date1904 = false;
  for (const t of scan(wb)) {
    if (t.name === "workbookPr" && /^(1|true)$/.test(t.attrs.date1904 ?? "")) date1904 = true;
    if (t.name === "sheet" && !t.close) {
      const rid = t.attrs["r:id"] ?? Object.entries(t.attrs).find(([k]) => k.endsWith(":id"))?.[1];
      if (!t.attrs.name || !rid) throw malformed("a sheet without a name or relationship");
      sheets.push({ name: t.attrs.name, rid });
    }
  }
  if (sheets.length > l.maxSheets) throw limit(`more than ${l.maxSheets} sheets`);
  const rels = new Map<string, string>();
  const relXml = parts.text("xl/_rels/workbook.xml.rels");
  if (relXml === null) throw malformed("no workbook relationships");
  for (const t of scan(relXml))
    if (t.name === "Relationship" && t.attrs.Id && t.attrs.Target) {
      if (t.attrs.TargetMode === "External") continue;
      rels.set(t.attrs.Id, t.attrs.Target);
    }
  const strings = sharedStrings(parts.text("xl/sharedStrings.xml"), l);
  const dates = dateStyles(parts.text("xl/styles.xml"));
  return sheets.map((s) => {
    const target = rels.get(s.rid);
    if (!target) throw malformed(`sheet ${s.name} has no part`);
    const path = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    const xml = parts.text(path.replace(/^xl\/\.\.\//, ""));
    if (xml === null) throw malformed(`sheet ${s.name} has no part`);
    return { name: s.name, rows: readSheet(xml, strings, dates, date1904, l) };
  });
}

/** Rows of one sheet as objects keyed by its first row (trimmed header text; duplicates refused). */
export function xlsxRecords(sheet: XlsxReadSheet): Array<Record<string, XlsxCellValue>> {
  const [head, ...rest] = sheet.rows;
  const keys = (head ?? []).map((h) => (h === null ? "" : String(h).trim()));
  if (new Set(keys.filter(Boolean)).size !== keys.filter(Boolean).length)
    throw malformed(`sheet ${sheet.name} repeats a header`);
  return rest.map((r) => {
    const o: Record<string, XlsxCellValue> = {};
    keys.forEach((k, i) => {
      if (k) o[k] = r[i] ?? null;
    });
    return o;
  });
}
