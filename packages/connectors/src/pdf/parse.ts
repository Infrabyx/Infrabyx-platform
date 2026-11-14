// The bounded PDF text parser behind the `pdf-text` adapter (IPB-01 PDF; PR-LDC-39, R1-D-160;
// threat model §3.129). It runs inside a `worker_thread` that `text.ts` starts with resource limits
// and terminates on its deadline; this file is also that worker's entry point (the block at the end).
//
// No dependency, and nothing but `node:` imports, so the worker loads it alone. Read in this order:
//   * Structure: `startxref`, classic cross-reference tables and cross-reference streams (with the
//     PNG predictors they use), `/Prev` chains, object streams and the page tree. A file whose
//     cross-reference data cannot be read is indexed by scanning for `n g obj` instead.
//   * Streams: FlateDecode only, inflated with `node:zlib` and capped per stream (the smaller of the
//     stream limit and the ratio limit) and in total. A content stream with another filter leaves
//     its page `needsOcr`; a structural stream with another filter is refused.
//   * Text: Tj, TJ, ' and " inside BT/ET, in content-stream order. Td, TD, Tm and T* decide line
//     breaks (y moves by over half the font size); a move right of where the last text ended (from
//     the font's widths) or a large TJ gap is a space. Marked content with /ActualText replaces
//     its glyphs. Form XObjects are followed, images and inline images skipped. Glyphs map through
//     the font's ToUnicode CMap (bfchar, bfrange), else its encoding (WinAnsi by default, Standard,
//     Differences with glyph names).
//   * Refused: an `/Encrypt` dictionary (`IPB-SEC-010`, encrypted), anything malformed beyond repair
//     (`IPB-SEC-010`), and every limit (`IPB-SEC-013`). Actions (JavaScript, Launch), embedded files,
//     annotations and the name tree are never read: only the catalog's `/Pages` is followed, so
//     nothing in the file is executed, fetched or opened. Error details never quote the file.
//
// TypeScript here is erasable syntax only (no enums, namespaces or parameter properties), so Node
// can run the source as a worker in tests; the build emits plain JavaScript beside it.
import { inflateSync, constants as zlibConstants } from "node:zlib";
import { isMainThread, parentPort, workerData } from "node:worker_threads";

export interface PdfParseLimits {
  maxFileBytes: number;
  maxPages: number;
  maxObjects: number;
  maxDepth: number;
  maxStreamBytes: number;
  maxTotalInflateBytes: number;
  maxRatio: number;
  maxTextChars: number;
}

export interface ParsedPdfPage {
  index: number;
  text: string;
  needsOcr: boolean;
}

export interface ParsedPdf {
  pages: ParsedPdfPage[];
  pageCount: number;
  truncated: boolean;
}

export type PdfRefusalCode = "IPB-SEC-010" | "IPB-SEC-013";

/** A refusal: the code and reason the adapter turns into a `PortError`. Never quotes the file. */
export class PdfRefusal extends Error {
  readonly code: PdfRefusalCode;
  readonly reason: string;
  constructor(code: PdfRefusalCode, reason: string, detail: string) {
    super(detail);
    this.code = code;
    this.reason = reason;
  }
}

const limit = (detail: string): PdfRefusal => new PdfRefusal("IPB-SEC-013", "limit", detail);
const malformed = (detail: string): PdfRefusal =>
  new PdfRefusal("IPB-SEC-010", "malformed", detail);

/** Inflated streams this small are not held to the ratio limit (tiny streams compress well). */
const RATIO_FLOOR = 64 * 1024;
/** Operands kept before an operator; a longer run is not a valid content stream. */
const MAX_OPERANDS = 64;
/** `/Prev` sections followed. */
const MAX_XREF_SECTIONS = 64;

// ---- values ------------------------------------------------------------------------------------

interface PdfName {
  k: "name";
  v: string;
}
interface PdfRef {
  k: "ref";
  n: number;
  g: number;
}
interface PdfStr {
  k: "str";
  v: Uint8Array;
}
interface PdfOp {
  k: "op";
  v: string;
}
interface PdfStream {
  k: "stream";
  dict: PdfDict;
  raw: Uint8Array;
}
type PdfDict = Map<string, PdfValue>;
type PdfValue = null | boolean | number | PdfName | PdfRef | PdfStr | PdfStream | PdfDict | PdfArr;
type PdfArr = PdfValue[];

const isName = (v: unknown): v is PdfName => (v as PdfName | null)?.k === "name";
const isRef = (v: unknown): v is PdfRef => (v as PdfRef | null)?.k === "ref";
const isStr = (v: unknown): v is PdfStr => (v as PdfStr | null)?.k === "str";
const isStream = (v: unknown): v is PdfStream => (v as PdfStream | null)?.k === "stream";
const isDict = (v: unknown): v is PdfDict => v instanceof Map;
const nameOf = (v: unknown): string | null => (isName(v) ? v.v : null);
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);

// ---- lexer -------------------------------------------------------------------------------------

const WS = new Uint8Array(256);
for (const c of [0, 9, 10, 12, 13, 32]) WS[c] = 1;
const DELIM = new Uint8Array(256);
for (const c of "()<>[]{}/%") DELIM[c.charCodeAt(0)] = 1;

type Tok =
  | { t: "num"; v: number }
  | { t: "name"; v: string }
  | { t: "str"; v: Uint8Array }
  | { t: "kw"; v: string }
  | { t: "punct"; v: "[" | "]" | "<<" | ">>" | "{" | "}" }
  | { t: "eof" };

const EOF: Tok = { t: "eof" };

class Lexer {
  readonly b: Uint8Array;
  p: number;
  readonly maxDepth: number;
  constructor(b: Uint8Array, p: number, maxDepth: number) {
    this.b = b;
    this.p = p;
    this.maxDepth = maxDepth;
  }

  private c(i: number): number {
    return i < this.b.length ? this.b[i]! : -1;
  }

  skipWs(): void {
    const b = this.b;
    while (this.p < b.length) {
      const c = b[this.p]!;
      if (WS[c]) this.p += 1;
      else if (c === 0x25) {
        while (this.p < b.length && b[this.p] !== 10 && b[this.p] !== 13) this.p += 1;
      } else break;
    }
  }

  token(): Tok {
    const b = this.b;
    this.skipWs();
    // A stray `)` is skipped, as readers do.
    while (this.p < b.length && b[this.p] === 0x29) {
      this.p += 1;
      this.skipWs();
    }
    if (this.p >= b.length) return EOF;
    const c = b[this.p]!;
    switch (c) {
      case 0x5b:
        this.p += 1;
        return { t: "punct", v: "[" };
      case 0x5d:
        this.p += 1;
        return { t: "punct", v: "]" };
      case 0x7b:
        this.p += 1;
        return { t: "punct", v: "{" };
      case 0x7d:
        this.p += 1;
        return { t: "punct", v: "}" };
      case 0x28:
        return { t: "str", v: this.literal() };
      case 0x2f:
        return { t: "name", v: this.name() };
      case 0x3c:
        if (this.c(this.p + 1) === 0x3c) {
          this.p += 2;
          return { t: "punct", v: "<<" };
        }
        return { t: "str", v: this.hex() };
      case 0x3e:
        this.p += this.c(this.p + 1) === 0x3e ? 2 : 1;
        return { t: "punct", v: ">>" };
      default:
        break;
    }
    const start = this.p;
    while (this.p < b.length && !WS[b[this.p]!] && !DELIM[b[this.p]!]) this.p += 1;
    const word = latin1(b, start, this.p);
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) return { t: "num", v: Number(word) };
    if (/^[+-]*\d*\.?\d*$/.test(word) && /\d/.test(word))
      return { t: "num", v: Number(word.replace(/^[+-]+/, (s) => s[s.length - 1]!)) || 0 };
    return { t: "kw", v: word };
  }

  private name(): string {
    const b = this.b;
    this.p += 1;
    let out = "";
    while (this.p < b.length && !WS[b[this.p]!] && !DELIM[b[this.p]!]) {
      const c = b[this.p]!;
      if (c === 0x23 && this.p + 2 < b.length) {
        const h = parseInt(latin1(b, this.p + 1, this.p + 3), 16);
        if (Number.isFinite(h)) {
          out += String.fromCharCode(h);
          this.p += 3;
          continue;
        }
      }
      out += String.fromCharCode(c);
      this.p += 1;
    }
    return out;
  }

  private literal(): Uint8Array {
    const b = this.b;
    this.p += 1;
    const out: number[] = [];
    let depth = 1;
    while (this.p < b.length) {
      const c = b[this.p++]!;
      if (c === 0x28) depth += 1;
      else if (c === 0x29) {
        depth -= 1;
        if (depth === 0) break;
      } else if (c === 0x5c) {
        const e = this.c(this.p++);
        switch (e) {
          case 0x6e:
            out.push(10);
            continue;
          case 0x72:
            out.push(13);
            continue;
          case 0x74:
            out.push(9);
            continue;
          case 0x62:
            out.push(8);
            continue;
          case 0x66:
            out.push(12);
            continue;
          case 0x0d:
            if (this.c(this.p) === 0x0a) this.p += 1;
            continue;
          case 0x0a:
            continue;
          case -1:
            continue;
          default:
            if (e >= 0x30 && e <= 0x37) {
              let v = e - 0x30;
              for (let k = 0; k < 2; k++) {
                const d = this.c(this.p);
                if (d < 0x30 || d > 0x37) break;
                v = v * 8 + (d - 0x30);
                this.p += 1;
              }
              out.push(v & 0xff);
            } else out.push(e);
            continue;
        }
      }
      out.push(c);
    }
    return Uint8Array.from(out);
  }

  private hex(): Uint8Array {
    const b = this.b;
    this.p += 1;
    const out: number[] = [];
    let hi = -1;
    while (this.p < b.length) {
      const c = b[this.p++]!;
      if (c === 0x3e) break;
      const v = hexVal(c);
      if (v < 0) continue;
      if (hi < 0) hi = v;
      else {
        out.push(hi * 16 + v);
        hi = -1;
      }
    }
    if (hi >= 0) out.push(hi * 16);
    return Uint8Array.from(out);
  }

  /**
   * One value. `refs` reads `n g R` as a reference (object syntax; never in content streams);
   * a keyword comes back as an operator, and `]`, `>>` and the end as `undefined`.
   */
  value(refs: boolean, depth = 0): PdfValue | PdfOp | undefined {
    const t = this.token();
    switch (t.t) {
      case "eof":
        return undefined;
      case "num": {
        if (refs && Number.isInteger(t.v) && t.v >= 0) {
          const save = this.p;
          const g = this.token();
          if (g.t === "num" && Number.isInteger(g.v) && g.v >= 0) {
            const r = this.token();
            if (r.t === "kw" && r.v === "R") return { k: "ref", n: t.v, g: g.v };
          }
          this.p = save;
        }
        return t.v;
      }
      case "name":
        return { k: "name", v: t.v };
      case "str":
        return { k: "str", v: t.v };
      case "kw":
        if (t.v === "true") return true;
        if (t.v === "false") return false;
        if (t.v === "null") return null;
        return { k: "op", v: t.v };
      case "punct":
        if (t.v === "[" || t.v === "{") {
          if (depth + 1 > this.maxDepth) throw limit(`nesting deeper than ${this.maxDepth}`);
          const out: PdfArr = [];
          for (;;) {
            const save = this.p;
            const n = this.token();
            if (n.t === "eof") break;
            if (n.t === "punct" && (n.v === "]" || n.v === "}")) break;
            if (n.t === "punct" && n.v === ">>") continue;
            this.p = save;
            const v = this.value(refs, depth + 1);
            if (v === undefined) break;
            if ((v as PdfOp | null)?.k === "op") continue;
            out.push(v as PdfValue);
          }
          return out;
        }
        if (t.v === "<<") {
          if (depth + 1 > this.maxDepth) throw limit(`nesting deeper than ${this.maxDepth}`);
          const out: PdfDict = new Map();
          for (;;) {
            const k = this.token();
            if (k.t === "eof" || (k.t === "punct" && k.v === ">>")) break;
            if (k.t !== "name") continue;
            const save = this.p;
            const n = this.token();
            if (n.t === "punct" && n.v === ">>") break;
            this.p = save;
            const v = this.value(refs, depth + 1);
            if (v === undefined) break;
            if ((v as PdfOp | null)?.k === "op") continue;
            out.set(k.v, v as PdfValue);
          }
          return out;
        }
        return undefined;
    }
  }
}

function hexVal(c: number): number {
  if (c >= 0x30 && c <= 0x39) return c - 0x30;
  if (c >= 0x41 && c <= 0x46) return c - 0x37;
  if (c >= 0x61 && c <= 0x66) return c - 0x57;
  return -1;
}

function latin1(b: Uint8Array, s: number, e: number): string {
  return Buffer.from(b.buffer, b.byteOffset + s, Math.max(0, e - s)).toString("latin1");
}

function indexOf(b: Uint8Array, needle: string, from: number, to = b.length): number {
  const n = Buffer.from(needle, "latin1");
  const i = Buffer.from(b.buffer, b.byteOffset, Math.min(to, b.length)).indexOf(n, from);
  return i;
}

function lastIndexOf(b: Uint8Array, needle: string, from: number): number {
  return Buffer.from(b.buffer, b.byteOffset, b.length).lastIndexOf(
    Buffer.from(needle, "latin1"),
    from,
  );
}

// ---- the document ------------------------------------------------------------------------------

type XrefEntry = { t: 1; off: number } | { t: 2; stm: number; idx: number };

class Doc {
  readonly b: Uint8Array;
  readonly l: PdfParseLimits;
  readonly xref = new Map<number, XrefEntry>();
  trailer: PdfDict = new Map();
  private readonly cache = new Map<number, PdfValue>();
  private readonly resolving = new Set<number>();
  private readonly objstms = new Map<number, { data: Uint8Array; offsets: number[] }>();
  private read = 0;
  private inflated = 0;

  constructor(b: Uint8Array, l: PdfParseLimits) {
    this.b = b;
    this.l = l;
  }

  open(): void {
    if (this.b.length > this.l.maxFileBytes)
      throw limit(`the file is over ${this.l.maxFileBytes} bytes`);
    if (indexOf(this.b, "%PDF-", 0, 1024) < 0) throw malformed("no PDF header");
    let ok: boolean;
    try {
      ok = this.readXrefChain();
    } catch (e) {
      if (e instanceof PdfRefusal && e.code === "IPB-SEC-013") throw e;
      ok = false;
    }
    if (!ok) this.reconstruct();
    if (this.trailer.has("Encrypt")) throw new PdfRefusal("IPB-SEC-010", "encrypted", "encrypted");
  }

  private addEntry(n: number, e: XrefEntry): void {
    if (this.xref.has(n)) return;
    if (this.xref.size >= this.l.maxObjects) throw limit(`more than ${this.l.maxObjects} objects`);
    this.xref.set(n, e);
  }

  /** The cross-reference chain from `startxref`; false when it cannot be read. */
  private readXrefChain(): boolean {
    const at = lastIndexOf(this.b, "startxref", this.b.length);
    if (at < 0) return false;
    const lx = new Lexer(this.b, at + 9, this.l.maxDepth);
    const t = lx.token();
    if (t.t !== "num") return false;
    let off: number | null = t.v;
    const seen = new Set<number>();
    while (off !== null) {
      if (seen.has(off) || seen.size >= MAX_XREF_SECTIONS) break;
      seen.add(off);
      if (!(off >= 0 && off < this.b.length)) return false;
      const trailer = this.readXrefSection(off);
      if (!trailer) return false;
      for (const [k, v] of trailer) if (!this.trailer.has(k)) this.trailer.set(k, v);
      const stm = trailer.get("XRefStm");
      if (typeof stm === "number" && !seen.has(stm)) {
        seen.add(stm);
        this.readXrefSection(stm);
      }
      const prev = trailer.get("Prev");
      off = typeof prev === "number" ? prev : null;
    }
    return this.trailer.has("Root") && this.xref.size > 0;
  }

  private readXrefSection(off: number): PdfDict | null {
    const lx = new Lexer(this.b, off, this.l.maxDepth);
    const first = lx.token();
    if (first.t === "kw" && first.v === "xref") {
      for (;;) {
        const s = lx.token();
        if (s.t === "kw" && s.v === "trailer") break;
        const c = lx.token();
        if (s.t !== "num" || c.t !== "num") return null;
        if (c.v > this.l.maxObjects) throw limit(`more than ${this.l.maxObjects} objects`);
        for (let i = 0; i < c.v; i++) {
          const o = lx.token();
          const g = lx.token();
          const f = lx.token();
          if (o.t !== "num" || g.t !== "num" || f.t !== "kw") return null;
          if (f.v === "n" && o.v > 0) this.addEntry(s.v + i, { t: 1, off: o.v });
          else if (f.v === "f") this.addEntry(s.v + i, { t: 1, off: -1 });
        }
      }
      const tr = lx.value(true);
      return isDict(tr) ? tr : null;
    }
    // A cross-reference stream: `n g obj << /Type /XRef … >> stream`.
    const s = this.objectAt(off);
    if (!isStream(s) || nameOf(s.dict.get("Type")) !== "XRef") return null;
    this.xrefStream(s);
    return s.dict;
  }

  private xrefStream(s: PdfStream): void {
    const w = s.dict.get("W");
    if (!Array.isArray(w) || w.length < 3) throw malformed("a cross-reference stream without /W");
    const [w1, w2, w3] = w.map((x) => num(x)) as [number, number, number];
    if ([w1, w2, w3].some((x) => !Number.isInteger(x) || x < 0 || x > 8))
      throw malformed("a cross-reference stream's /W");
    const size = num(s.dict.get("Size"));
    const index = s.dict.get("Index");
    const ranges = Array.isArray(index) ? index.map((x) => num(x)) : [0, size];
    const data = this.decode(s);
    if (!data) throw malformed("a cross-reference stream's filter");
    const row = w1 + w2 + w3;
    if (row === 0) throw malformed("a cross-reference stream's /W");
    let p = 0;
    const field = (width: number, d: number): number => {
      if (width === 0) return d;
      let v = 0;
      for (let i = 0; i < width; i++) v = v * 256 + (data[p++] ?? 0);
      return v;
    };
    for (let r = 0; r + 1 < ranges.length; r += 2) {
      const start = ranges[r]!;
      const count = ranges[r + 1]!;
      if (count > this.l.maxObjects) throw limit(`more than ${this.l.maxObjects} objects`);
      for (let i = 0; i < count && p + row <= data.length; i++) {
        const type = field(w1, 1);
        const a = field(w2, 0);
        const c = field(w3, 0);
        if (type === 1) this.addEntry(start + i, { t: 1, off: a });
        else if (type === 2) this.addEntry(start + i, { t: 2, stm: a, idx: c });
        else this.addEntry(start + i, { t: 1, off: -1 });
      }
    }
  }

  /** Index by scanning for `n g obj` when the cross-reference data is unreadable. */
  private reconstruct(): void {
    this.xref.clear();
    this.cache.clear();
    this.objstms.clear();
    this.trailer = new Map();
    const text = latin1(this.b, 0, this.b.length);
    const re = /(?:^|[\s>])(\d{1,10})\s+(\d{1,5})\s+obj\b/g;
    const found = new Map<number, number>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const at = m.index + (m[0].length - m[0].trimStart().length);
      found.set(Number(m[1]), at);
      if (found.size > this.l.maxObjects) throw limit(`more than ${this.l.maxObjects} objects`);
    }
    // Later definitions win, as an incremental update would.
    for (const [n, off] of found) this.xref.set(n, { t: 1, off });
    for (const tm of text.matchAll(/trailer\s*<</g)) {
      const lx = new Lexer(this.b, tm.index + 7, this.l.maxDepth);
      const d = lx.value(true);
      if (isDict(d)) for (const [k, v] of d) this.trailer.set(k, v);
    }
    for (const n of [...found.keys()]) {
      const o = this.object(n);
      if (!isStream(o)) continue;
      const type = nameOf(o.dict.get("Type"));
      if (type === "XRef")
        for (const [k, v] of o.dict) if (!this.trailer.has(k)) this.trailer.set(k, v);
      if (type === "ObjStm") {
        const st = this.objstm(n);
        for (let i = 0; i < st.offsets.length / 2; i++) {
          const inner = st.offsets[i * 2]!;
          if (!this.xref.has(inner)) this.addEntry(inner, { t: 2, stm: n, idx: i });
        }
      }
    }
    if (!this.trailer.has("Root")) {
      for (const n of found.keys()) {
        const o = this.object(n);
        if (isDict(o) && nameOf(o.get("Type")) === "Catalog") {
          this.trailer.set("Root", { k: "ref", n, g: 0 });
          break;
        }
      }
    }
    if (!this.trailer.has("Root")) throw malformed("no document catalog");
  }

  resolve(v: PdfValue | undefined): PdfValue {
    if (v === undefined) return null;
    return isRef(v) ? this.object(v.n) : v;
  }

  dict(v: PdfValue | undefined): PdfDict | null {
    const r = this.resolve(v);
    if (isDict(r)) return r;
    if (isStream(r)) return r.dict;
    return null;
  }

  object(n: number): PdfValue {
    if (this.cache.has(n)) return this.cache.get(n)!;
    if (this.resolving.has(n)) return null;
    const e = this.xref.get(n);
    if (!e || (e.t === 1 && e.off < 0)) return null;
    this.read += 1;
    if (this.read > this.l.maxObjects) throw limit(`more than ${this.l.maxObjects} objects read`);
    this.resolving.add(n);
    try {
      let v: PdfValue;
      if (e.t === 1) v = this.objectAt(e.off, n);
      else {
        const st = this.objstm(e.stm);
        const off = st.offsets[e.idx * 2 + 1];
        if (off === undefined || st.offsets[e.idx * 2] !== n) v = null;
        else {
          const lx = new Lexer(st.data, off, this.l.maxDepth);
          const r = lx.value(true);
          v = r === undefined || (r as PdfOp | null)?.k === "op" ? null : (r as PdfValue);
        }
      }
      this.cache.set(n, v);
      return v;
    } finally {
      this.resolving.delete(n);
    }
  }

  /** `n g obj <value> [stream … endstream]` at a file offset. */
  private objectAt(off: number, expect?: number): PdfValue {
    if (!(off >= 0 && off < this.b.length)) return null;
    const lx = new Lexer(this.b, off, this.l.maxDepth);
    const n = lx.token();
    const g = lx.token();
    const o = lx.token();
    if (n.t !== "num" || g.t !== "num" || o.t !== "kw" || o.v !== "obj") return null;
    if (expect !== undefined && n.v !== expect) return null;
    const v = lx.value(true);
    if (v === undefined || (v as PdfOp | null)?.k === "op") return null;
    if (!isDict(v)) return v as PdfValue;
    const save = lx.p;
    const s = lx.token();
    if (s.t !== "kw" || s.v !== "stream") {
      lx.p = save;
      return v;
    }
    let start = lx.p;
    if (this.b[start] === 0x0d) start += 1;
    if (this.b[start] === 0x0a) start += 1;
    const declared = this.resolve(v.get("Length"));
    let end = -1;
    if (typeof declared === "number" && Number.isInteger(declared) && declared >= 0) {
      const e = start + declared;
      const after = new Lexer(this.b, e, this.l.maxDepth);
      after.skipWs();
      if (e <= this.b.length && indexOf(this.b, "endstream", after.p, after.p + 9) === after.p)
        end = e;
    }
    if (end < 0) {
      const es = indexOf(this.b, "endstream", start);
      if (es < 0) throw malformed("a stream without endstream");
      end = es;
      if (this.b[end - 1] === 0x0a) end -= 1;
      if (this.b[end - 1] === 0x0d) end -= 1;
    }
    return { k: "stream", dict: v, raw: this.b.subarray(start, Math.max(start, end)) };
  }

  private objstm(n: number): { data: Uint8Array; offsets: number[] } {
    const hit = this.objstms.get(n);
    if (hit) return hit;
    const s = this.object(n);
    if (!isStream(s)) throw malformed("an object stream is missing");
    const data = this.decode(s);
    if (!data) throw malformed("an object stream's filter");
    const count = num(s.dict.get("N"));
    const first = num(s.dict.get("First"));
    if (!Number.isInteger(count) || count < 0 || count > this.l.maxObjects)
      throw limit(`more than ${this.l.maxObjects} objects`);
    const lx = new Lexer(data, 0, this.l.maxDepth);
    const offsets: number[] = [];
    for (let i = 0; i < count; i++) {
      const a = lx.token();
      const b = lx.token();
      if (a.t !== "num" || b.t !== "num") break;
      offsets.push(a.v, first + b.v);
    }
    const st = { data, offsets };
    this.objstms.set(n, st);
    return st;
  }

  /**
   * A stream's data through its filters, or null for a filter this parser does not read or data
   * that does not inflate (the caller decides: a page goes to OCR, a structural stream is refused).
   */
  decode(s: PdfStream): Uint8Array | null {
    const f = this.resolve(s.dict.get("Filter"));
    const filters = (Array.isArray(f) ? f : f === null ? [] : [f]).map((x) =>
      nameOf(this.resolve(x)),
    );
    const p = this.resolve(s.dict.get("DecodeParms"));
    const parms = (Array.isArray(p) ? p : [p]).map((x) => this.dict(x));
    let data = s.raw;
    for (let i = 0; i < filters.length; i++) {
      const name = filters[i];
      if (name !== "FlateDecode" && name !== "Fl") return null;
      const out = this.inflate(data);
      if (!out) return null;
      const predicted = predict(out, parms[i] ?? null);
      if (!predicted) return null;
      data = predicted;
    }
    return data;
  }

  private inflate(raw: Uint8Array): Uint8Array | null {
    const l = this.l;
    const left = l.maxTotalInflateBytes - this.inflated;
    const byRatio = Math.max(RATIO_FLOOR, raw.length * l.maxRatio);
    const cap = Math.min(l.maxStreamBytes, byRatio, left);
    if (cap <= 0) throw limit(`over ${l.maxTotalInflateBytes} bytes inflated in all`);
    let out: Buffer;
    try {
      out = inflateSync(raw, {
        maxOutputLength: cap,
        finishFlush: zlibConstants.Z_SYNC_FLUSH,
      });
    } catch (e) {
      if ((e as { code?: string }).code === "ERR_BUFFER_TOO_LARGE" || e instanceof RangeError) {
        if (cap === left) throw limit(`over ${l.maxTotalInflateBytes} bytes inflated in all`);
        if (cap === l.maxStreamBytes)
          throw limit(`a stream inflates past ${l.maxStreamBytes} bytes`);
        throw limit(`a stream's compression ratio is over ${l.maxRatio}`);
      }
      return null;
    }
    this.inflated += out.length;
    return out;
  }
}

/** PNG (10 to 15) and TIFF (2) predictors, as cross-reference and object streams use them. */
function predict(data: Uint8Array, parms: PdfDict | null): Uint8Array | null {
  const pred = num(parms?.get("Predictor"), 1);
  if (pred <= 1) return data;
  const colors = num(parms?.get("Colors"), 1);
  const bpc = num(parms?.get("BitsPerComponent"), 8);
  const cols = num(parms?.get("Columns"), 1);
  if (![1, 2, 4, 8, 16].includes(bpc) || colors < 1 || colors > 32 || cols < 1 || cols > 1 << 20)
    return null;
  const bpp = Math.max(1, Math.ceil((colors * bpc) / 8));
  const rowLen = Math.ceil((colors * bpc * cols) / 8);
  if (pred === 2) {
    if (bpc !== 8) return null;
    const out = Uint8Array.from(data);
    for (let r = 0; r < out.length; r += rowLen)
      for (let i = bpp; i < rowLen && r + i < out.length; i++)
        out[r + i] = (out[r + i]! + out[r + i - bpp]!) & 0xff;
    return out;
  }
  if (pred < 10) return null;
  const rows = Math.floor(data.length / (rowLen + 1));
  const out = new Uint8Array(rows * rowLen);
  let prev = new Uint8Array(rowLen);
  for (let r = 0; r < rows; r++) {
    const type = data[r * (rowLen + 1)]!;
    const src = data.subarray(r * (rowLen + 1) + 1, (r + 1) * (rowLen + 1));
    const cur = out.subarray(r * rowLen, (r + 1) * rowLen);
    for (let i = 0; i < rowLen; i++) {
      const a = i >= bpp ? cur[i - bpp]! : 0;
      const b = prev[i]!;
      const c = i >= bpp ? prev[i - bpp]! : 0;
      const x = src[i]!;
      let v: number;
      switch (type) {
        case 0:
          v = x;
          break;
        case 1:
          v = x + a;
          break;
        case 2:
          v = x + b;
          break;
        case 3:
          v = x + ((a + b) >> 1);
          break;
        case 4: {
          const pa = Math.abs(b - c);
          const pb = Math.abs(a - c);
          const pc = Math.abs(a + b - 2 * c);
          v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default:
          return null;
      }
      cur[i] = v & 0xff;
    }
    prev = cur;
  }
  return out;
}

// ---- fonts and encodings -----------------------------------------------------------------------

const WIN_ANSI_HIGH: Record<number, string> = {
  0x80: "€",
  0x82: "‚",
  0x83: "ƒ",
  0x84: "„",
  0x85: "…",
  0x86: "†",
  0x87: "‡",
  0x88: "ˆ",
  0x89: "‰",
  0x8a: "Š",
  0x8b: "‹",
  0x8c: "Œ",
  0x8e: "Ž",
  0x91: "‘",
  0x92: "’",
  0x93: "“",
  0x94: "”",
  0x95: "•",
  0x96: "–",
  0x97: "—",
  0x98: "˜",
  0x99: "™",
  0x9a: "š",
  0x9b: "›",
  0x9c: "œ",
  0x9e: "ž",
  0x9f: "Ÿ",
  0xa0: " ",
  0xad: "-",
};

const STANDARD_HIGH: Record<number, string> = {
  0x27: "’",
  0x60: "‘",
  0xa1: "¡",
  0xa2: "¢",
  0xa3: "£",
  0xa4: "⁄",
  0xa5: "¥",
  0xa6: "ƒ",
  0xa7: "§",
  0xa8: "¤",
  0xa9: "'",
  0xaa: "“",
  0xab: "«",
  0xac: "‹",
  0xad: "›",
  0xae: "ﬁ",
  0xaf: "ﬂ",
  0xb1: "–",
  0xb2: "†",
  0xb3: "‡",
  0xb4: "·",
  0xb6: "¶",
  0xb7: "•",
  0xb8: "‚",
  0xb9: "„",
  0xba: "”",
  0xbb: "»",
  0xbc: "…",
  0xbd: "‰",
  0xbf: "¿",
  0xd0: "—",
  0xe1: "Æ",
  0xe3: "ª",
  0xe8: "Ł",
  0xe9: "Ø",
  0xea: "Œ",
  0xeb: "º",
  0xf1: "æ",
  0xf5: "ı",
  0xf8: "ł",
  0xf9: "ø",
  0xfa: "œ",
  0xfb: "ß",
};

function baseTable(name: string | null): string[] {
  const t: string[] = [];
  for (let c = 0; c < 256; c++) {
    if (name === "StandardEncoding") {
      t.push(STANDARD_HIGH[c] ?? (c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : ""));
    } else {
      t.push(
        WIN_ANSI_HIGH[c] ??
          (c >= 0x20 && c !== 0x7f && !(c >= 0x80 && c < 0xa0) ? String.fromCharCode(c) : ""),
      );
    }
  }
  return t;
}

const GLYPHS: Record<string, string> = {
  space: " ",
  exclam: "!",
  quotedbl: '"',
  numbersign: "#",
  dollar: "$",
  percent: "%",
  ampersand: "&",
  quotesingle: "'",
  parenleft: "(",
  parenright: ")",
  asterisk: "*",
  plus: "+",
  comma: ",",
  hyphen: "-",
  period: ".",
  slash: "/",
  zero: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  colon: ":",
  semicolon: ";",
  less: "<",
  equal: "=",
  greater: ">",
  question: "?",
  at: "@",
  bracketleft: "[",
  backslash: "\\",
  bracketright: "]",
  asciicircum: "^",
  underscore: "_",
  grave: "`",
  braceleft: "{",
  bar: "|",
  braceright: "}",
  asciitilde: "~",
  quoteleft: "‘",
  quoteright: "’",
  quotedblleft: "“",
  quotedblright: "”",
  quotesinglbase: "‚",
  quotedblbase: "„",
  bullet: "•",
  endash: "–",
  emdash: "—",
  ellipsis: "…",
  minus: "−",
  nbspace: " ",
  fi: "fi",
  fl: "fl",
  ff: "ff",
  ffi: "ffi",
  ffl: "ffl",
  Euro: "€",
  rupee: "₹",
  rupeeindian: "₹",
  sterling: "£",
  yen: "¥",
  cent: "¢",
  section: "§",
  paragraph: "¶",
  copyright: "©",
  registered: "®",
  trademark: "™",
  degree: "°",
  dagger: "†",
  daggerdbl: "‡",
  periodcentered: "·",
  multiply: "×",
  divide: "÷",
  plusminus: "±",
};

/** A glyph name to text: the table above, `uniXXXX…`, `uXXXX[XX]`, single letters, ligature parts. */
export function glyphText(name: string): string {
  const base = name.split(".")[0] ?? "";
  if (base.includes("_")) return base.split("_").map(glyphText).join("");
  if (GLYPHS[base] !== undefined) return GLYPHS[base]!;
  if (/^[A-Za-z]$/.test(base)) return base;
  const uni = /^uni((?:[0-9A-F]{4})+)$/.exec(base);
  if (uni) {
    let s = "";
    for (let i = 0; i < uni[1]!.length; i += 4)
      s += String.fromCharCode(parseInt(uni[1]!.slice(i, i + 4), 16));
    return safeText(s);
  }
  const u = /^u([0-9A-F]{4,6})$/.exec(base);
  if (u) {
    const cp = parseInt(u[1]!, 16);
    return cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : "";
  }
  return "";
}

/** A text string: UTF-16BE after a byte-order mark, else PDFDocEncoding (taken as Latin-1). */
function textString(b: Uint8Array): string {
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return utf16be(b.subarray(2));
  return Buffer.from(b).toString("latin1");
}

/** UTF-16BE (a ToUnicode destination) to a string; lone surrogates dropped. */
function utf16be(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode((b[i]! << 8) | b[i + 1]!);
  return safeText(s);
}

function safeText(s: string): string {
  return s.replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "");
}

function codeOf(b: Uint8Array): number {
  let v = 0;
  for (const x of b) v = v * 256 + x;
  return v;
}

interface CMap {
  /** Codespace ranges by byte length. */
  spaces: Array<{ len: number; lo: number; hi: number }>;
  chars: Map<string, string>;
  ranges: Array<{ len: number; lo: number; hi: number; dst: Uint8Array | string[] }>;
}

/** A ToUnicode CMap: codespace ranges, bfchar and bfrange (ranges stay unexpanded). */
function parseCMap(data: Uint8Array, maxDepth: number): CMap {
  const cm: CMap = { spaces: [], chars: new Map(), ranges: [] };
  const lx = new Lexer(data, 0, maxDepth);
  let mode: "" | "space" | "char" | "range" = "";
  const buf: PdfValue[] = [];
  for (;;) {
    const v = lx.value(false);
    if (v === undefined) {
      if (lx.p >= data.length) break;
      continue;
    }
    if ((v as PdfOp | null)?.k === "op") {
      const op = (v as PdfOp).v;
      if (op === "begincodespacerange") mode = "space";
      else if (op === "beginbfchar") mode = "char";
      else if (op === "beginbfrange") mode = "range";
      else if (op.startsWith("end")) mode = "";
      buf.length = 0;
      continue;
    }
    if (!mode) continue;
    buf.push(v as PdfValue);
    if (mode === "space" && buf.length === 2) {
      const [lo, hi] = buf as [PdfValue, PdfValue];
      if (isStr(lo) && isStr(hi) && lo.v.length >= 1 && lo.v.length <= 4)
        cm.spaces.push({ len: lo.v.length, lo: codeOf(lo.v), hi: codeOf(hi.v) });
      buf.length = 0;
    } else if (mode === "char" && buf.length === 2) {
      const [src, dst] = buf as [PdfValue, PdfValue];
      if (isStr(src) && src.v.length >= 1 && src.v.length <= 4) {
        const text = isStr(dst) ? utf16be(dst.v) : isName(dst) ? glyphText(dst.v) : "";
        cm.chars.set(`${src.v.length}:${codeOf(src.v)}`, text);
      }
      buf.length = 0;
    } else if (mode === "range" && buf.length === 3) {
      const [lo, hi, dst] = buf as [PdfValue, PdfValue, PdfValue];
      if (isStr(lo) && isStr(hi) && lo.v.length >= 1 && lo.v.length <= 4) {
        if (isStr(dst))
          cm.ranges.push({ len: lo.v.length, lo: codeOf(lo.v), hi: codeOf(hi.v), dst: dst.v });
        else if (Array.isArray(dst))
          cm.ranges.push({
            len: lo.v.length,
            lo: codeOf(lo.v),
            hi: codeOf(hi.v),
            dst: dst.map((d) => (isStr(d) ? utf16be(d.v) : "")),
          });
      }
      buf.length = 0;
    }
  }
  return cm;
}

function cmapLookup(cm: CMap, len: number, code: number): string | undefined {
  const c = cm.chars.get(`${len}:${code}`);
  if (c !== undefined) return c;
  for (const r of cm.ranges) {
    if (r.len !== len || code < r.lo || code > r.hi) continue;
    const k = code - r.lo;
    if (Array.isArray(r.dst)) return r.dst[k] ?? "";
    // The destination's last byte is incremented by the offset into the range.
    const d = Uint8Array.from(r.dst);
    let carry = k;
    for (let i = d.length - 1; i >= 0 && carry > 0; i--) {
      const v = d[i]! + carry;
      d[i] = v & 0xff;
      carry = v >> 8;
    }
    return utf16be(d);
  }
  return undefined;
}

/** A shown string: its text, its advance in glyph units (1/1000 em), and its code counts. */
interface Shown {
  text: string;
  width: number;
  codes: number;
  /** Single-byte code 32, which word spacing (Tw) applies to. */
  spaces: number;
}

interface Font {
  show(b: Uint8Array): Shown;
}

/** Glyph widths: an explicit table, ranges of one width, and a default. */
interface Widths {
  table: Map<number, number>;
  ranges: Array<[number, number, number]>;
  dflt: number;
}

function widthOf(w: Widths, code: number): number {
  const v = w.table.get(code);
  if (v !== undefined) return v;
  for (const [lo, hi, x] of w.ranges) if (code >= lo && code <= hi) return x;
  return w.dflt;
}

/** `/W` of a CIDFont: `c [w1 w2 …]` and `c_first c_last w` entries. */
function cidWidths(doc: Doc, desc: PdfDict | null): Widths {
  const w: Widths = { table: new Map(), ranges: [], dflt: num(doc.resolve(desc?.get("DW")), 1000) };
  const arr = doc.resolve(desc?.get("W"));
  if (!Array.isArray(arr)) return w;
  let i = 0;
  while (i + 1 < arr.length) {
    const first = num(doc.resolve(arr[i]), -1);
    const next = doc.resolve(arr[i + 1]);
    if (Array.isArray(next)) {
      next.forEach((x, k) => w.table.set(first + k, num(doc.resolve(x), w.dflt)));
      i += 2;
    } else {
      w.ranges.push([first, num(next, -1), num(doc.resolve(arr[i + 2]), w.dflt)]);
      i += 3;
    }
  }
  return w;
}

function makeFont(doc: Doc, fd: PdfDict): Font {
  const subtype = nameOf(doc.resolve(fd.get("Subtype")));
  const tu = doc.resolve(fd.get("ToUnicode"));
  let cmap: CMap | null = null;
  if (isStream(tu)) {
    const data = doc.decode(tu);
    if (data) cmap = parseCMap(data, doc.l.maxDepth);
  }
  if (subtype === "Type0") {
    const spaces = cmap?.spaces.length ? cmap.spaces : [{ len: 2, lo: 0, hi: 0xffff }];
    const desc = doc.resolve(fd.get("DescendantFonts"));
    // The code is taken as the CID (Identity-H and -V, what embedded subsets use).
    const widths = cidWidths(doc, doc.dict(Array.isArray(desc) ? desc[0] : desc));
    return {
      show(b: Uint8Array): Shown {
        const r: Shown = { text: "", width: 0, codes: 0, spaces: 0 };
        let i = 0;
        while (i < b.length) {
          let len = 0;
          for (let n = 1; n <= 4 && i + n <= b.length && !len; n++) {
            const code = codeOf(b.subarray(i, i + n));
            if (spaces.some((s) => s.len === n && code >= s.lo && code <= s.hi)) len = n;
          }
          if (!len) len = Math.min(spaces[0]!.len, b.length - i);
          const code = codeOf(b.subarray(i, i + len));
          if (cmap) r.text += cmapLookup(cmap, len, code) ?? "";
          r.width += widthOf(widths, code);
          r.codes += 1;
          if (len === 1 && code === 32) r.spaces += 1;
          i += len;
        }
        return r;
      },
    };
  }
  // A simple font: one byte per code, through the ToUnicode map, else the encoding.
  const enc = doc.resolve(fd.get("Encoding"));
  const encDict = isDict(enc) ? enc : null;
  const table = baseTable(nameOf(encDict ? doc.resolve(encDict.get("BaseEncoding")) : enc));
  const diffs = encDict ? doc.resolve(encDict.get("Differences")) : null;
  if (Array.isArray(diffs)) {
    let code = 0;
    for (const d of diffs) {
      const v = doc.resolve(d);
      if (typeof v === "number") code = v;
      else if (isName(v) && code >= 0 && code < 256) {
        table[code] = glyphText(v.v);
        code += 1;
      }
    }
  }
  const descriptor = doc.dict(fd.get("FontDescriptor"));
  const widths: Widths = {
    table: new Map(),
    ranges: [],
    dflt: num(doc.resolve(descriptor?.get("MissingWidth")), 0) || SIMPLE_WIDTH,
  };
  const first = num(doc.resolve(fd.get("FirstChar")), 0);
  const ws = doc.resolve(fd.get("Widths"));
  if (Array.isArray(ws))
    ws.slice(0, 256).forEach((x, k) => widths.table.set(first + k, num(doc.resolve(x), 0)));
  return simpleFont(table, widths, cmap);
}

/** The average advance assumed for a simple font that declares no widths (the standard 14). */
const SIMPLE_WIDTH = 500;

function simpleFont(table: string[], widths: Widths, cmap: CMap | null): Font {
  return {
    show(b: Uint8Array): Shown {
      const r: Shown = { text: "", width: 0, codes: b.length, spaces: 0 };
      for (const c of b) {
        r.text += (cmap && cmapLookup(cmap, 1, c)) ?? table[c] ?? "";
        r.width += widthOf(widths, c);
        if (c === 32) r.spaces += 1;
      }
      return r;
    },
  };
}

// ---- content streams ---------------------------------------------------------------------------

/** Used when a page shows text with no font, or a font the resources do not define. */
const DEFAULT_FONT: Font = simpleFont(
  baseTable(null),
  { table: new Map(), ranges: [], dflt: SIMPLE_WIDTH },
  null,
);

class TruncatedText extends Error {}

class TextSink {
  private readonly parts: string[] = [];
  private y: number | null = null;
  /** Where the last text shown ended on its line (text space, across BT/ET). */
  private endX: number | null = null;
  private gap = false;
  private newline = false;
  private chars = 0;
  readonly budget: { left: number };
  constructor(budget: { left: number }) {
    this.budget = budget;
  }

  private last(): string {
    const p = this.parts[this.parts.length - 1];
    return p ? p[p.length - 1]! : "\n";
  }

  /**
   * A move of the text position: a line break when y changes by over half the font size, a word
   * gap when x moves right of where the last text ended by over a sixth of it.
   */
  moved(newX: number, newY: number, size: number, forceLine: boolean): void {
    const s = Math.abs(size);
    if (forceLine) this.newline = true;
    else if (this.y !== null && Math.abs(newY - this.y) > Math.max(1, s * 0.5)) this.newline = true;
    else if (this.endX !== null && newX - this.endX > Math.max(0.5, s / 6)) this.gap = true;
  }

  /** The text just shown ended at `x`. */
  ended(x: number): void {
    this.endX = x;
  }

  space(): void {
    this.gap = true;
  }

  show(s: string, y: number): void {
    if (!s) return;
    if (this.chars > 0) {
      if (this.newline) this.push("\n");
      else if (this.gap && !/\s/.test(this.last())) this.push(" ");
    }
    this.newline = false;
    this.gap = false;
    this.y = y;
    this.push(s);
  }

  private push(s: string): void {
    if (s.length > this.budget.left) {
      this.parts.push(s.slice(0, this.budget.left));
      this.budget.left = 0;
      throw new TruncatedText();
    }
    this.budget.left -= s.length;
    this.chars += s.length;
    this.parts.push(s);
  }

  text(): string {
    return tidy(this.parts.join(""));
  }
}

function tidy(s: string): string {
  return (
    s
      .normalize("NFC")
      .replace(/\r\n?/g, "\n")
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\ufffd]/g, "")
      .split("\n")
      .map((l) => l.replace(/[ \t\u00a0]+/g, " ").trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

interface PageState {
  unreadable: boolean;
}

class Interpreter {
  private readonly doc: Doc;
  private readonly sink: TextSink;
  private readonly fonts = new Map<PdfDict, Font>();
  private readonly forms = new Set<PdfStream>();
  /** Marked-content depth, and the open /ActualText span (its text, not yet shown). */
  private marked = 0;
  private actual: { text: string; depth: number } | null = null;
  readonly state: PageState = { unreadable: false };

  constructor(doc: Doc, sink: TextSink) {
    this.doc = doc;
    this.sink = sink;
  }

  run(data: Uint8Array, resources: PdfDict | null, depth: number): void {
    const doc = this.doc;
    if (depth > doc.l.maxDepth) throw limit(`form XObjects nested deeper than ${doc.l.maxDepth}`);
    const lx = new Lexer(data, 0, doc.l.maxDepth);
    const ops: PdfValue[] = [];
    let font: Font = DEFAULT_FONT;
    let size = 0;
    let leading = 0;
    let charSpace = 0;
    let wordSpace = 0;
    let hScale = 1;
    let tm = [1, 0, 0, 1, 0, 0];
    let tlm = [1, 0, 0, 1, 0, 0];
    const lineMove = (tx: number, ty: number, force: boolean) => {
      const nt = [
        tlm[0]!,
        tlm[1]!,
        tlm[2]!,
        tlm[3]!,
        tx * tlm[0]! + ty * tlm[2]! + tlm[4]!,
        tx * tlm[1]! + ty * tlm[3]! + tlm[5]!,
      ];
      this.sink.moved(nt[4]!, nt[5]!, size * Math.hypot(tlm[2]!, tlm[3]!), force);
      tlm = nt;
      tm = [...nt];
    };
    /** Moves the text position along the baseline by `tx` text-space units. */
    const advance = (tx: number) => {
      tm[4] = tm[4]! + tx * tm[0]!;
      tm[5] = tm[5]! + tx * tm[1]!;
    };
    const show = (s: PdfValue | undefined) => {
      if (!isStr(s)) return;
      const r = font.show(s.v);
      // Inside a span with /ActualText, that text replaces the glyphs (shown once, at the first).
      if (this.actual) {
        r.text = this.actual.text;
        this.actual.text = "";
      }
      this.sink.show(r.text, tm[5]!);
      advance(((r.width / 1000) * size + r.codes * charSpace + r.spaces * wordSpace) * hScale);
      if (r.text) this.sink.ended(tm[4]!);
    };
    for (;;) {
      const v = lx.value(false);
      if (v === undefined) {
        if (lx.p >= data.length) break;
        continue;
      }
      if ((v as PdfOp | null)?.k !== "op") {
        if (ops.length >= MAX_OPERANDS) ops.shift();
        ops.push(v as PdfValue);
        continue;
      }
      const op = (v as PdfOp).v;
      const n = (i: number) => num(ops[ops.length - 1 - i]);
      switch (op) {
        case "BT":
          tm = [1, 0, 0, 1, 0, 0];
          tlm = [1, 0, 0, 1, 0, 0];
          break;
        case "Tf": {
          const fname = nameOf(ops[ops.length - 2]);
          size = n(0);
          font = (fname ? this.font(resources, fname) : null) ?? DEFAULT_FONT;
          break;
        }
        case "TL":
          leading = n(0);
          break;
        case "Tc":
          charSpace = n(0);
          break;
        case "Tw":
          wordSpace = n(0);
          break;
        case "Tz":
          hScale = n(0) / 100;
          break;
        case "Td":
          lineMove(n(1), n(0), false);
          break;
        case "TD":
          leading = -n(0);
          lineMove(n(1), n(0), false);
          break;
        case "Tm": {
          const m = [n(5), n(4), n(3), n(2), n(1), n(0)];
          this.sink.moved(m[4]!, m[5]!, size * Math.hypot(m[2]!, m[3]!), false);
          tlm = m;
          tm = [...m];
          break;
        }
        case "T*":
          lineMove(0, -leading, true);
          break;
        case "Tj":
          show(ops[ops.length - 1]);
          break;
        case "'":
          lineMove(0, -leading, true);
          show(ops[ops.length - 1]);
          break;
        case '"':
          wordSpace = n(2);
          charSpace = n(1);
          lineMove(0, -leading, true);
          show(ops[ops.length - 1]);
          break;
        case "TJ": {
          const arr = ops[ops.length - 1];
          if (Array.isArray(arr))
            for (const el of arr) {
              if (typeof el === "number") {
                // A gap wider than a fifth of an em is a word space.
                if (el < -200) this.sink.space();
                advance((-el / 1000) * size * hScale);
              } else show(el);
            }
          break;
        }
        case "Do": {
          const xname = nameOf(ops[ops.length - 1]);
          if (xname) this.xobject(resources, xname, depth);
          break;
        }
        case "BI":
          skipInlineImage(lx);
          break;
        case "BMC":
          this.marked += 1;
          break;
        case "BDC": {
          this.marked += 1;
          const props = ops[ops.length - 1];
          const pd = isDict(props)
            ? props
            : isName(props)
              ? doc.dict(doc.dict(resources?.get("Properties"))?.get(props.v))
              : null;
          const at = pd ? doc.resolve(pd.get("ActualText")) : null;
          if (!this.actual && isStr(at))
            this.actual = { text: textString(at.v), depth: this.marked };
          break;
        }
        case "EMC":
          if (this.actual?.depth === this.marked) this.actual = null;
          this.marked = Math.max(0, this.marked - 1);
          break;
        default:
          break;
      }
      ops.length = 0;
    }
  }

  private font(resources: PdfDict | null, name: string): Font | null {
    const fonts = this.doc.dict(resources?.get("Font"));
    const fd = this.doc.dict(fonts?.get(name));
    if (!fd) return null;
    let f = this.fonts.get(fd);
    if (!f) {
      f = makeFont(this.doc, fd);
      this.fonts.set(fd, f);
    }
    return f;
  }

  private xobject(resources: PdfDict | null, name: string, depth: number): void {
    const xs = this.doc.dict(resources?.get("XObject"));
    const x = this.doc.resolve(xs?.get(name));
    if (!isStream(x) || nameOf(this.doc.resolve(x.dict.get("Subtype"))) !== "Form") return;
    if (this.forms.has(x)) return;
    this.forms.add(x);
    try {
      const data = this.doc.decode(x);
      if (!data) {
        this.state.unreadable = true;
        return;
      }
      this.run(data, this.doc.dict(x.dict.get("Resources")) ?? resources, depth + 1);
    } finally {
      this.forms.delete(x);
    }
  }
}

/** Past `BI … ID <bytes> EI`: the image data ends at whitespace, `EI` and whitespace or the end. */
function skipInlineImage(lx: Lexer): void {
  const b = lx.b;
  for (;;) {
    const t = lx.token();
    if (t.t === "eof") return;
    if (t.t === "kw" && t.v === "ID") break;
  }
  let i = lx.p + 1;
  while (i + 1 < b.length) {
    if (
      WS[b[i - 1]!] &&
      b[i] === 0x45 &&
      b[i + 1] === 0x49 &&
      (i + 2 >= b.length || WS[b[i + 2]!] || DELIM[b[i + 2]!])
    ) {
      lx.p = i + 2;
      return;
    }
    i += 1;
  }
  lx.p = b.length;
}

// ---- pages -------------------------------------------------------------------------------------

interface PageRef {
  dict: PdfDict;
  resources: PdfDict | null;
}

function pageList(doc: Doc): PageRef[] {
  const root = doc.dict(doc.trailer.get("Root"));
  if (!root) throw malformed("no document catalog");
  const top = doc.dict(root.get("Pages"));
  if (!top) throw malformed("no page tree");
  const declared = num(doc.resolve(top.get("Count")), 0);
  if (declared > doc.l.maxPages) throw limit(`more than ${doc.l.maxPages} pages`);
  const out: PageRef[] = [];
  const seen = new Set<PdfDict>();
  const walk = (node: PdfDict, inherited: PdfDict | null, depth: number): void => {
    if (depth > doc.l.maxDepth) throw limit(`a page tree deeper than ${doc.l.maxDepth}`);
    if (seen.has(node)) throw malformed("a cycle in the page tree");
    seen.add(node);
    const resources = doc.dict(node.get("Resources")) ?? inherited;
    const kids = doc.resolve(node.get("Kids"));
    const type = nameOf(doc.resolve(node.get("Type")));
    if (Array.isArray(kids) && type !== "Page") {
      for (const k of kids) {
        const kd = doc.dict(k);
        if (kd) walk(kd, resources, depth + 1);
      }
      return;
    }
    out.push({ dict: node, resources });
    if (out.length > doc.l.maxPages) throw limit(`more than ${doc.l.maxPages} pages`);
  };
  walk(top, null, 0);
  return out;
}

function pageText(
  doc: Doc,
  page: PageRef,
  budget: { left: number },
): ParsedPdfPage & { cut: boolean } {
  const sink = new TextSink(budget);
  const it = new Interpreter(doc, sink);
  const c = doc.resolve(page.dict.get("Contents"));
  const streams = (Array.isArray(c) ? c.map((x) => doc.resolve(x)) : [c]).filter(isStream);
  const parts: Uint8Array[] = [];
  for (const s of streams) {
    const d = doc.decode(s);
    if (d) parts.push(d, Uint8Array.of(10));
    else it.state.unreadable = true;
  }
  let cut = false;
  try {
    if (parts.length) it.run(Buffer.concat(parts), page.resources, 0);
  } catch (e) {
    if (!(e instanceof TruncatedText)) throw e;
    cut = true;
  }
  const text = sink.text();
  const visible = /[\p{L}\p{N}\p{S}\p{P}]/u.test(text);
  return { index: 0, text, needsOcr: it.state.unreadable || !visible, cut };
}

/** Text per page, within the limits. Throws `PdfRefusal`. Run it in the worker (`text.ts`). */
export function extractPdfText(bytes: Uint8Array, limits: PdfParseLimits): ParsedPdf {
  const doc = new Doc(bytes, limits);
  doc.open();
  const list = pageList(doc);
  const budget = { left: limits.maxTextChars };
  const pages: ParsedPdfPage[] = [];
  let truncated = false;
  for (let i = 0; i < list.length; i++) {
    const p = pageText(doc, list[i]!, budget);
    pages.push({ index: i + 1, text: p.text, needsOcr: p.needsOcr });
    if (p.cut || budget.left <= 0) {
      truncated = i + 1 < list.length || p.cut;
      break;
    }
  }
  return { pages, pageCount: list.length, truncated };
}

// ---- worker entry ------------------------------------------------------------------------------

export const PDF_TEXT_WORKER_TASK = "infrabyx-pdf-text";

export type WorkerReply =
  | { ok: true; result: ParsedPdf }
  | { ok: false; code: PdfRefusalCode; reason: string; detail: string };

const job = workerData as { task?: unknown; bytes?: ArrayBuffer; limits?: PdfParseLimits } | null;
if (!isMainThread && parentPort && job?.task === PDF_TEXT_WORKER_TASK && job.bytes && job.limits) {
  let reply: WorkerReply;
  try {
    reply = { ok: true, result: extractPdfText(new Uint8Array(job.bytes), job.limits) };
  } catch (e) {
    reply =
      e instanceof PdfRefusal
        ? { ok: false, code: e.code, reason: e.reason, detail: e.message }
        : e instanceof RangeError
          ? {
              ok: false,
              code: "IPB-SEC-013",
              reason: "limit",
              detail: "a parser limit was reached",
            }
          : {
              ok: false,
              code: "IPB-SEC-010",
              reason: "malformed",
              detail: "the file could not be parsed",
            };
  }
  parentPort.postMessage(reply);
}
