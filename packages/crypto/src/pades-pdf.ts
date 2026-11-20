// Finding PDF signature dictionaries for the PAdES verifier (C-28, R1-D-246), without a PDF object
// model: each `/ByteRange` key is located, its enclosing indirect object is read by a bounded
// tokeniser, and the dictionary holding that key gives `/ByteRange`, `/Contents`, `/SubFilter`,
// `/Type` and `/M`. Internal to @infrabyx/crypto.

export class PdfSyntaxError extends Error {
  constructor() {
    super("PDF: malformed signature dictionary");
    this.name = "PdfSyntaxError";
  }
}

type PdfValue =
  | { k: "dict"; entries: Map<string, PdfValue>; keyAt: Map<string, number> }
  | { k: "array"; items: PdfValue[] }
  | { k: "name"; v: string }
  | { k: "str"; bytes: Buffer }
  | { k: "hex"; start: number; end: number }
  | { k: "num"; v: number; int: boolean }
  | { k: "ref" }
  | { k: "kw"; v: string };

const MAX_DEPTH = 16;
const MAX_TOKENS = 200_000;
const MAX_STRING = 64 * 1024;
/** Bytes read from an object header: room for a 1 MiB CMS as hex plus the dictionary. */
const MAX_OBJECT_BYTES = 4 * 1024 * 1024;
/** Earlier object headers tried when one cannot be read (a header-like text inside a string). */
const MAX_HEADER_TRIES = 2;

const isWs = (c: number) => c === 0 || c === 9 || c === 10 || c === 12 || c === 13 || c === 32;
const isDelim = (c: number) =>
  c === 0x28 ||
  c === 0x29 ||
  c === 0x3c ||
  c === 0x3e ||
  c === 0x5b ||
  c === 0x5d ||
  c === 0x7b ||
  c === 0x7d ||
  c === 0x2f ||
  c === 0x25; // ( ) < > [ ] { } / %
const isHex = (c: number) =>
  (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66);
const isDigit = (c: number) => c >= 0x30 && c <= 0x39;

class Reader {
  tokens = 0;
  constructor(
    readonly b: Buffer,
    public p: number,
  ) {}

  private fail(): never {
    throw new PdfSyntaxError();
  }

  ws(): void {
    const b = this.b;
    for (;;) {
      while (this.p < b.length && isWs(b[this.p]!)) this.p++;
      if (b[this.p] !== 0x25) return;
      while (this.p < b.length && b[this.p] !== 10 && b[this.p] !== 13) this.p++;
    }
  }

  private int(): number | undefined {
    const b = this.b;
    const s = this.p;
    while (this.p < b.length && isDigit(b[this.p]!)) this.p++;
    if (this.p === s || this.p - s > 10) {
      this.p = s;
      return undefined;
    }
    return Number(b.toString("latin1", s, this.p));
  }

  value(depth: number): PdfValue {
    if (++this.tokens > MAX_TOKENS || depth > MAX_DEPTH) this.fail();
    this.ws();
    const b = this.b;
    const c = b[this.p];
    if (c === undefined) this.fail();
    if (c === 0x3c && b[this.p + 1] === 0x3c) return this.dict(depth);
    if (c === 0x3c) return this.hex();
    if (c === 0x5b) {
      this.p++;
      const items: PdfValue[] = [];
      for (;;) {
        this.ws();
        if (b[this.p] === 0x5d) {
          this.p++;
          return { k: "array", items };
        }
        items.push(this.value(depth + 1));
      }
    }
    if (c === 0x28) return this.literal();
    if (c === 0x2f) return { k: "name", v: this.name() };
    if (isDigit(c) || c === 0x2b || c === 0x2d || c === 0x2e) return this.number();
    const s = this.p;
    while (this.p < b.length && !isWs(b[this.p]!) && !isDelim(b[this.p]!)) this.p++;
    if (this.p === s || this.p - s > 32) this.fail();
    return { k: "kw", v: b.toString("latin1", s, this.p) };
  }

  private dict(depth: number): PdfValue {
    this.p += 2;
    const entries = new Map<string, PdfValue>();
    const keyAt = new Map<string, number>();
    for (;;) {
      this.ws();
      if (this.b[this.p] === 0x3e && this.b[this.p + 1] === 0x3e) {
        this.p += 2;
        return { k: "dict", entries, keyAt };
      }
      if (this.b[this.p] !== 0x2f) this.fail();
      const at = this.p;
      const key = this.name();
      if (entries.has(key)) this.fail();
      keyAt.set(key, at);
      entries.set(key, this.value(depth + 1));
    }
  }

  private hex(): PdfValue {
    const start = this.p++;
    const b = this.b;
    while (this.p < b.length && b[this.p] !== 0x3e) {
      if (!isHex(b[this.p]!) && !isWs(b[this.p]!)) this.fail();
      this.p++;
    }
    if (this.p >= b.length) this.fail();
    this.p++;
    return { k: "hex", start, end: this.p };
  }

  private literal(): PdfValue {
    const b = this.b;
    this.p++;
    const out: number[] = [];
    let nest = 1;
    for (;;) {
      if (this.p >= b.length || out.length > MAX_STRING) this.fail();
      const c = b[this.p++]!;
      if (c === 0x5c) {
        const e = b[this.p++];
        if (e === undefined) this.fail();
        const map: Record<number, number> = { 0x6e: 10, 0x72: 13, 0x74: 9, 0x62: 8, 0x66: 12 };
        if (map[e] !== undefined) out.push(map[e]);
        else if (e >= 0x30 && e <= 0x37) {
          let v = e - 0x30;
          for (let i = 0; i < 2 && b[this.p]! >= 0x30 && b[this.p]! <= 0x37; i++)
            v = v * 8 + (b[this.p++]! - 0x30);
          out.push(v & 0xff);
        } else if (e === 10 || e === 13) {
          if (e === 13 && b[this.p] === 10) this.p++;
        } else out.push(e);
        continue;
      }
      if (c === 0x28) nest++;
      if (c === 0x29 && --nest === 0) return { k: "str", bytes: Buffer.from(out) };
      out.push(c);
    }
  }

  private name(): string {
    const b = this.b;
    this.p++;
    const s = this.p;
    while (this.p < b.length && !isWs(b[this.p]!) && !isDelim(b[this.p]!)) this.p++;
    if (this.p - s > 127) this.fail();
    return b
      .toString("latin1", s, this.p)
      .replace(/#([0-9A-Fa-f]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
  }

  private number(): PdfValue {
    const b = this.b;
    const s = this.p;
    if (b[this.p] === 0x2b || b[this.p] === 0x2d) this.p++;
    while (this.p < b.length && (isDigit(b[this.p]!) || b[this.p] === 0x2e)) this.p++;
    const text = b.toString("latin1", s, this.p);
    if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(text) || text.length > 32) this.fail();
    const int = /^[+-]?\d+$/.test(text);
    if (int && /^\d+$/.test(text)) {
      // `n g R`: an indirect reference.
      const save = this.p;
      this.ws();
      const g = this.int();
      if (g !== undefined) {
        this.ws();
        if (
          b[this.p] === 0x52 &&
          (this.p + 1 >= b.length || isWs(b[this.p + 1]!) || isDelim(b[this.p + 1]!))
        ) {
          this.p++;
          return { k: "ref" };
        }
      }
      this.p = save;
    }
    return { k: "num", v: Number(text), int };
  }
}

export interface FoundSignature {
  byteRange: [number, number, number, number];
  /** Offsets of the `/Contents` hex string, `<` to after `>`. */
  contents: { start: number; end: number };
  subFilter: string | undefined;
  type: string | undefined;
  /** The `/M` string's bytes, when present. */
  m: Buffer | undefined;
}

function findDict(v: PdfValue, keyPos: number): Extract<PdfValue, { k: "dict" }> | undefined {
  if (v.k === "dict") {
    if (v.keyAt.get("ByteRange") === keyPos) return v;
    for (const x of v.entries.values()) {
      const f = findDict(x, keyPos);
      if (f) return f;
    }
  } else if (v.k === "array") {
    for (const x of v.items) {
      const f = findDict(x, keyPos);
      if (f) return f;
    }
  }
  return undefined;
}

function toSignature(d: Extract<PdfValue, { k: "dict" }>, base: number): FoundSignature {
  const br = d.entries.get("ByteRange");
  const ct = d.entries.get("Contents");
  if (br?.k !== "array" || br.items.length !== 4 || ct?.k !== "hex") throw new PdfSyntaxError();
  const nums = br.items.map((x) =>
    x.k === "num" && x.int && x.v >= 0 && Number.isSafeInteger(x.v) ? x.v : -1,
  );
  if (nums.some((n) => n < 0)) throw new PdfSyntaxError();
  const sf = d.entries.get("SubFilter");
  const ty = d.entries.get("Type");
  const m = d.entries.get("M");
  return {
    byteRange: nums as [number, number, number, number],
    contents: { start: base + ct.start, end: base + ct.end },
    subFilter: sf?.k === "name" ? sf.v : undefined,
    type: ty?.k === "name" ? ty.v : undefined,
    m: m?.k === "str" ? m.bytes : undefined,
  };
}

/**
 * Every `/ByteRange` key in the file, each as a signature or as `null` when its dictionary cannot
 * be read (so an unreadable signature is never dropped silently).
 */
export function findSignatures(
  pdf: Buffer,
  max: number,
): Array<FoundSignature | null> | "too_many" {
  const s = pdf.toString("latin1");
  const headers: number[] = [];
  for (const m of s.matchAll(
    /(?<![0-9])[0-9]{1,10}[\0\t\n\f\r ]+[0-9]{1,5}[\0\t\n\f\r ]+obj(?![A-Za-z])/g,
  ))
    headers.push(m.index);
  const out: Array<FoundSignature | null> = [];
  const parsed = new Map<number, PdfValue | null>();
  for (let pos = s.indexOf("/ByteRange"); pos !== -1; pos = s.indexOf("/ByteRange", pos + 1)) {
    const next = pdf[pos + 10];
    if (next !== undefined && !isWs(next) && !isDelim(next)) continue;
    if (out.length >= max) return "too_many";
    let found: FoundSignature | null = null;
    let lo = 0;
    let hi = headers.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (headers[mid]! < pos) lo = mid + 1;
      else hi = mid;
    }
    for (let h = lo - 1, tries = 0; h >= 0 && tries < MAX_HEADER_TRIES && !found; h--, tries++) {
      const base = headers[h]!;
      let tree = parsed.get(base);
      if (tree === undefined) {
        // Each object is read once, from its header, at most MAX_OBJECT_BYTES.
        try {
          const r = new Reader(pdf.subarray(base, base + MAX_OBJECT_BYTES), 0);
          r.p = s.indexOf("obj", base) + 3 - base;
          tree = r.value(0);
        } catch {
          tree = null;
        }
        parsed.set(base, tree);
      }
      if (!tree) continue;
      const d = findDict(tree, pos - base);
      if (d) {
        try {
          found = toSignature(d, base);
        } catch {
          break;
        }
      }
    }
    out.push(found);
  }
  return out;
}

/** A PDF date (`D:YYYYMMDDHHmmSSOHH'mm'`), or undefined when it is not one. No offset is UTC. */
export function pdfDate(b: Buffer | undefined): Date | undefined {
  if (!b) return undefined;
  const m =
    /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(?:(Z)|([+-])(\d{2})'?(\d{2})?'?)?$/.exec(
      b.toString("latin1"),
    );
  if (!m) return undefined;
  const n = (i: number, dflt: number) => (m[i] === undefined ? dflt : Number(m[i]));
  const [y, mo, d, h, mi, se] = [n(1, 0), n(2, 1), n(3, 1), n(4, 0), n(5, 0), n(6, 0)];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 59) return undefined;
  let t = Date.UTC(y, mo - 1, d, h, mi, se);
  if (m[8]) {
    const off = (n(9, 0) * 60 + n(10, 0)) * 60_000;
    t += m[8] === "+" ? -off : off;
  }
  const date = new Date(t);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
