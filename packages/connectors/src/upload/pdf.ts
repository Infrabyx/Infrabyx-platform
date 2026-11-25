// The PDF check of the upload pipeline (IPB-02-44: PDFs checked for JavaScript and launch actions;
// PR-FBX-56, R1-D-292). It parses nothing it could be fooled about: every PDF name anywhere in the
// file is read (strings, comments and stream data included, `#xx` escapes decoded), and so is every
// name in what each stream decodes to (Flate, ASCII85, ASCIIHex and RunLength, in any order, and a
// PNG predictor found from the data's own row structure, whatever the dictionary claims). A name in
// a string can therefore refuse an ordinary file, never pass an active one. Fail closed: an
// encrypted file, an LZW, Crypt or TIFF-predictor stream, too many streams, or decoding past the
// limits is refused.
import { inflateRawSync, inflateSync } from "node:zlib";
import {
  PDF_ACTIVE_NAMES,
  PDF_REPORTED_NAMES,
  UPLOAD_MAX_INFLATED_BYTES,
} from "@infrabyx/contracts/ports";

export type PdfCheck =
  | { ok: true; active: string[]; reported: string[] }
  | { ok: false; reason: "pdf_unreadable" | "pdf_encrypted" | "inflation_limit" };

/** The most streams one PDF may hold before it is refused as unreadable. */
export const PDF_MAX_STREAMS = 20_000;
/** Decoded streams up to this size are also searched for a PNG predictor's row structure. */
const PREDICTOR_SEARCH_BYTES = 16 * 1024 * 1024;
/** The most bytes undoing predictors may produce for one PDF (bounds the work, never the file). */
const PREDICTOR_MAX_OUTPUT = 512 * 1024 * 1024;
const CHUNK = 64 * 1024 * 1024;

function latin1(b: Uint8Array): string {
  // Chunked: one decode of a very large file can exceed the engine's string limit.
  const parts: string[] = [];
  const d = new TextDecoder("latin1");
  for (let i = 0; i < b.length; i += CHUNK) parts.push(d.decode(b.subarray(i, i + CHUNK)));
  return parts.join("");
}

/** Every PDF name in `b` (Latin-1), `#xx` escapes decoded (PDF 1.7 §7.3.5). */
export function pdfNames(b: Uint8Array | string): Set<string> {
  const text = typeof b === "string" ? b : latin1(b);
  const out = new Set<string>();
  for (const m of text.matchAll(/\/([^\s/<>[\]()%{}]*)/g)) {
    const raw = m[1]!;
    out.add(
      raw.includes("#")
        ? raw.replace(/#([0-9A-Fa-f]{2})/g, (_s, h: string) => String.fromCharCode(parseInt(h, 16)))
        : raw,
    );
  }
  return out;
}

class Limit extends Error {}

/** The decode budget of one PDF. */
class Budget {
  left = UPLOAD_MAX_INFLATED_BYTES;
  predicted = PREDICTOR_MAX_OUTPUT;
  take(n: number) {
    this.left -= n;
    if (this.left < 0) throw new Limit();
  }
  predict(n: number) {
    this.predicted -= n;
    if (this.predicted < 0) throw new Limit();
  }
}

/** A zlib stream header (RFC 1950): deflate, and the check bits right. */
const zlibHeader = (d: Uint8Array) =>
  d.length > 2 && (d[0]! & 0x0f) === 8 && d[0]! >> 4 <= 7 && ((d[0]! << 8) | d[1]!) % 31 === 0;

/**
 * Flate data: zlib (the PDF form) behind a valid header, or raw deflate where the stream's own
 * dictionary names Flate (`raw`), as lenient viewers read it. Trying neither elsewhere keeps a file
 * of many small streams cheap to check.
 */
function inflate(data: Uint8Array, budget: Budget, raw: boolean): Uint8Array | null {
  const fns = [...(zlibHeader(data) ? [inflateSync] : []), ...(raw ? [inflateRawSync] : [])];
  for (const fn of fns) {
    try {
      // No per-stream ratio: a blank scanned page compresses far past any; the budget bounds it.
      const out = fn(data, {
        maxOutputLength: Math.max(1, budget.left),
        finishFlush: 2,
      }) as Uint8Array;
      budget.take(out.length);
      return out;
    } catch (e) {
      if (e instanceof Limit) throw e;
      if ((e as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") throw new Limit();
    }
  }
  return null;
}

function asciiHex(data: Uint8Array): Uint8Array | null {
  const t = latin1(data).replace(/\s+/g, "");
  const end = t.indexOf(">");
  const hex = end >= 0 ? t.slice(0, end) : t;
  if (hex.length < 2 || !/^[0-9A-Fa-f]+$/.test(hex)) return null;
  const s = hex.length % 2 ? `${hex}0` : hex;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function ascii85(data: Uint8Array): Uint8Array | null {
  let t = latin1(data).replace(/\s+/g, "");
  if (t.startsWith("<~")) t = t.slice(2);
  const end = t.indexOf("~>");
  if (end >= 0) t = t.slice(0, end);
  if (!t.length || !/^[!-uz]+$/.test(t)) return null;
  const out: number[] = [];
  let group: number[] = [];
  const flush = (n: number) => {
    while (group.length < 5) group.push(84);
    let v = 0;
    for (const c of group) v = v * 85 + c;
    const bytes = [Math.floor(v / 2 ** 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
    out.push(...bytes.slice(0, n));
    group = [];
  };
  for (const ch of t) {
    if (ch === "z" && group.length === 0) {
      out.push(0, 0, 0, 0);
      continue;
    }
    group.push(ch.charCodeAt(0) - 33);
    if (group.length === 5) flush(4);
  }
  if (group.length > 1) flush(group.length - 1);
  return Uint8Array.from(out);
}

function runLength(data: Uint8Array): Uint8Array | null {
  const out: number[] = [];
  for (let i = 0; i < data.length;) {
    const n = data[i++]!;
    if (n === 128) return Uint8Array.from(out);
    if (n < 128) {
      if (i + n + 1 > data.length) return null;
      for (let k = 0; k <= n; k++) out.push(data[i + k]!);
      i += n + 1;
    } else {
      if (i >= data.length) return null;
      for (let k = 0; k < 257 - n; k++) out.push(data[i]!);
      i++;
    }
    if (out.length > 64 * 1024 * 1024) return null;
  }
  return Uint8Array.from(out);
}

/**
 * PNG predictor rows found from the data itself: a stride whose every row starts with a tag byte
 * 0 to 4. Each such stride is undone for every pixel width, so a predicted object stream is read
 * whatever `/Columns`, `/Colors` or `/BitsPerComponent` say.
 */
function unpredict(data: Uint8Array, budget?: Budget): Uint8Array[] {
  if (data.length < 4 || data.length > PREDICTOR_SEARCH_BYTES) return [];
  const out: Uint8Array[] = [];
  for (let stride = 2; stride <= data.length; stride++) {
    if (data.length % stride !== 0) continue;
    let ok = true;
    for (let i = 0; i < data.length; i += stride)
      if (data[i]! > 4) {
        ok = false;
        break;
      }
    if (!ok) continue;
    for (const bpp of [1, 2, 3, 4, 6, 8]) {
      if (bpp >= stride) continue;
      const row = stride - 1;
      budget?.predict((data.length / stride) * row);
      const res = new Uint8Array((data.length / stride) * row);
      for (let r = 0; r * stride < data.length; r++) {
        const tag = data[r * stride]!;
        for (let c = 0; c < row; c++) {
          const x = data[r * stride + 1 + c]!;
          const a = c >= bpp ? res[r * row + c - bpp]! : 0;
          const b = r > 0 ? res[(r - 1) * row + c]! : 0;
          const d = r > 0 && c >= bpp ? res[(r - 1) * row + c - bpp]! : 0;
          let v = x;
          if (tag === 1) v = x + a;
          else if (tag === 2) v = x + b;
          else if (tag === 3) v = x + ((a + b) >> 1);
          else if (tag === 4) {
            const p = a + b - d;
            const pa = Math.abs(p - a);
            const pb = Math.abs(p - b);
            const pc = Math.abs(p - d);
            v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : d);
          }
          res[r * row + c] = v & 255;
        }
      }
      out.push(res);
      if (out.length > 64) return out;
    }
  }
  return out;
}

/** Everything a stream's data can decode to, each stage applied to the last (filter chains). */
function decodings(data: Uint8Array, budget: Budget, flateNamed: boolean): Uint8Array[] {
  const seen: Uint8Array[] = [];
  let frontier = [data];
  for (let depth = 0; depth < 3 && frontier.length; depth++) {
    const next: Uint8Array[] = [];
    for (const d of frontier) {
      const flat = inflate(d, budget, flateNamed || depth > 0);
      if (flat) {
        next.push(flat, ...unpredict(flat, budget));
      }
      for (const fn of [ascii85, asciiHex, runLength]) {
        const o = fn(d);
        if (o && o.length) {
          budget.take(o.length);
          next.push(o);
        }
      }
    }
    seen.push(...next);
    frontier = next;
  }
  return seen;
}

/**
 * Checks one PDF. `active` lists the always-active names found (`PDF_ACTIVE_NAMES`), `reported`
 * the names ordinary PDFs use (`PDF_REPORTED_NAMES`). Never throws.
 */
export function checkPdf(bytes: Uint8Array): PdfCheck {
  try {
    const text = latin1(bytes);
    const names = pdfNames(text);
    if (names.has("Encrypt")) return { ok: false, reason: "pdf_encrypted" };
    // Filters this check cannot undo: a stream behind them could hide any name.
    for (const n of ["LZWDecode", "LZW", "Crypt"])
      if (names.has(n)) return { ok: false, reason: "pdf_unreadable" };
    if (/\/Predictor\s+2(?![0-9])/.test(text)) return { ok: false, reason: "pdf_unreadable" };
    const budget = new Budget();
    let streams = 0;
    let examined = 0;
    let prevEnd = 0;
    // Every `stream` keyword, even one inside a string or a comment, up to the next `endstream`.
    // Keywords inside another stream's data overlap it, so the bytes examined are bounded too.
    const re = /stream\r?\n/g;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      if (++streams > PDF_MAX_STREAMS) return { ok: false, reason: "pdf_unreadable" };
      const start = m.index + m[0].length;
      let end = text.indexOf("endstream", start);
      if (end < 0) end = text.length;
      examined += end - start;
      if (examined > 2 * bytes.length + 16 * 1024 * 1024)
        return { ok: false, reason: "pdf_unreadable" };
      // The dictionary before the keyword, back to the previous object or stream end (searched
      // only since the last stream, so the whole loop stays linear), for whether to try raw
      // deflate.
      const gap = text.slice(Math.min(prevEnd, m.index), m.index);
      const dictFrom = Math.max(gap.lastIndexOf("endobj"), gap.lastIndexOf("endstream"), 0);
      const flateNamed = /\/Fl(ateDecode)?\b/.test(gap.slice(dictFrom));
      prevEnd = Math.max(prevEnd, end);
      for (const d of decodings(bytes.subarray(start, end), budget, flateNamed))
        for (const n of pdfNames(d)) names.add(n);
      if (end === text.length) break;
    }
    const active = PDF_ACTIVE_NAMES.filter((n) => names.has(n));
    const reported = PDF_REPORTED_NAMES.filter((n) => names.has(n));
    return { ok: true, active, reported };
  } catch (e) {
    return { ok: false, reason: e instanceof Limit ? "inflation_limit" : "pdf_unreadable" };
  }
}
