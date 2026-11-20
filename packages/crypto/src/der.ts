// A strict, bounded DER reader (X.690 DER subset) for the PAdES/CMS verifier (C-28, R1-D-246).
// Definite lengths only, minimal length encodings, low tag numbers, bounded element counts; no
// recursion over arbitrary input (callers read fixed schemas). Every failure is a `DerError`,
// whose message is a fixed text and never carries input bytes.

export class DerError extends Error {
  constructor(what: string) {
    super(`DER: ${what}`);
    this.name = "DerError";
  }
}

export interface Tlv {
  /** The identifier octet (class, constructed bit, tag number below 31). */
  tag: number;
  /** Offset of the identifier octet. */
  start: number;
  /** Offset of the first content octet. */
  body: number;
  /** Offset just after the last content octet. */
  end: number;
}

export const TAG = {
  BOOLEAN: 0x01,
  INTEGER: 0x02,
  BIT_STRING: 0x03,
  OCTET_STRING: 0x04,
  NULL: 0x05,
  OID: 0x06,
  ENUMERATED: 0x0a,
  UTC_TIME: 0x17,
  GENERALIZED_TIME: 0x18,
  SEQUENCE: 0x30,
  SET: 0x31,
} as const;

const fail = (what: string): never => {
  throw new DerError(what);
};

/** Reads one TLV at `at`, which must end at or before `limit`. */
export function readTlv(d: Uint8Array, at: number, limit: number = d.length): Tlv {
  if (at + 2 > limit) fail("truncated");
  const tag = d[at]!;
  if ((tag & 0x1f) === 0x1f) fail("high tag number");
  let p = at + 1;
  const first = d[p++]!;
  let n = first;
  if (first & 0x80) {
    const k = first & 0x7f;
    if (k === 0) fail("indefinite length");
    if (k > 4) fail("length too long");
    if (p + k > limit) fail("truncated");
    if (d[p] === 0) fail("non-minimal length");
    n = 0;
    for (let i = 0; i < k; i++) n = n * 256 + d[p++]!;
    if (n < 0x80) fail("non-minimal length");
  }
  if (p + n > limit) fail("overruns its parent");
  return { tag, start: at, body: p, end: p + n };
}

/** Reads exactly one TLV filling `d` (no trailing bytes). */
export function readOne(d: Uint8Array): Tlv {
  const t = readTlv(d, 0, d.length);
  if (t.end !== d.length) fail("trailing bytes");
  return t;
}

/** The children of a constructed TLV, at most `max`. */
export function children(d: Uint8Array, t: Tlv, max = 64): Tlv[] {
  if (!(t.tag & 0x20)) fail("not constructed");
  const out: Tlv[] = [];
  for (let p = t.body; p < t.end;) {
    if (out.length >= max) fail("too many elements");
    const c = readTlv(d, p, t.end);
    out.push(c);
    p = c.end;
  }
  return out;
}

export function expect(t: Tlv | undefined, tag: number): Tlv {
  if (!t || t.tag !== tag) fail("unexpected element");
  return t!;
}

export const bytesOf = (d: Uint8Array, t: Tlv): Buffer =>
  Buffer.from(d.buffer, d.byteOffset + t.body, t.end - t.body);
export const encodingOf = (d: Uint8Array, t: Tlv): Buffer =>
  Buffer.from(d.buffer, d.byteOffset + t.start, t.end - t.start);

export function oidOf(d: Uint8Array, t: Tlv): string {
  expect(t, TAG.OID);
  const b = bytesOf(d, t);
  if (b.length === 0 || b.length > 64) fail("bad OID");
  const arcs: number[] = [];
  let v = 0;
  for (let i = 0; i < b.length; i++) {
    const x = b[i]!;
    if (v === 0 && x === 0x80) fail("non-minimal OID");
    v = v * 128 + (x & 0x7f);
    if (v > Number.MAX_SAFE_INTEGER / 128) fail("OID arc too large");
    if (!(x & 0x80)) {
      arcs.push(v);
      v = 0;
    } else if (i === b.length - 1) fail("truncated OID");
  }
  const f = arcs[0]!;
  const head = f < 40 ? [0, f] : f < 80 ? [1, f - 40] : [2, f - 80];
  return [...head, ...arcs.slice(1)].join(".");
}

/** An INTEGER's content octets (two's complement, minimal). */
export function integerOf(d: Uint8Array, t: Tlv, tag: number = TAG.INTEGER): Buffer {
  expect(t, tag);
  const b = bytesOf(d, t);
  if (b.length === 0) fail("empty integer");
  if (b.length > 1 && ((b[0] === 0 && !(b[1]! & 0x80)) || (b[0] === 0xff && b[1]! & 0x80)))
    fail("non-minimal integer");
  return b;
}

/** A small non-negative INTEGER (or ENUMERATED) as a number. */
export function smallIntOf(d: Uint8Array, t: Tlv, tag: number = TAG.INTEGER): number {
  const b = integerOf(d, t, tag);
  if (b.length > 4 || b[0]! & 0x80) fail("integer out of range");
  let n = 0;
  for (const x of b) n = n * 256 + x;
  return n;
}

export function booleanOf(d: Uint8Array, t: Tlv): boolean {
  expect(t, TAG.BOOLEAN);
  const b = bytesOf(d, t);
  if (b.length !== 1 || (b[0] !== 0 && b[0] !== 0xff)) fail("bad boolean");
  return b[0] === 0xff;
}

/** A BIT STRING's bytes; `unused` is the count of unused bits in the last byte. */
export function bitStringOf(d: Uint8Array, t: Tlv): { unused: number; bytes: Buffer } {
  expect(t, TAG.BIT_STRING);
  const b = bytesOf(d, t);
  if (b.length === 0 || b[0]! > 7 || (b.length === 1 && b[0] !== 0)) fail("bad bit string");
  return { unused: b[0]!, bytes: b.subarray(1) };
}

const digits = (s: string, from: number, n: number): number => {
  const part = s.slice(from, from + n);
  if (!/^[0-9]+$/.test(part) || part.length !== n) fail("bad time");
  return Number(part);
};

/** UTCTime (`YYMMDDHHMMSSZ`) or GeneralizedTime (`YYYYMMDDHHMMSS[.f]Z`), UTC only. */
export function timeOf(d: Uint8Array, t: Tlv): Date {
  const s = bytesOf(d, t).toString("latin1");
  let y: number;
  let r: number;
  if (t.tag === TAG.UTC_TIME) {
    if (!/^[0-9]{12}Z$/.test(s)) fail("bad UTCTime");
    const yy = digits(s, 0, 2);
    y = yy < 50 ? 2000 + yy : 1900 + yy;
    r = 2;
  } else if (t.tag === TAG.GENERALIZED_TIME) {
    if (!/^[0-9]{14}(\.[0-9]{1,6})?Z$/.test(s)) fail("bad GeneralizedTime");
    y = digits(s, 0, 4);
    r = 4;
  } else return fail("not a time");
  const mo = digits(s, r, 2);
  const da = digits(s, r + 2, 2);
  const h = digits(s, r + 4, 2);
  const mi = digits(s, r + 6, 2);
  const se = digits(s, r + 8, 2);
  const frac = /\.([0-9]+)Z$/.exec(s)?.[1];
  const ms = frac ? Math.floor(Number(`0.${frac}`) * 1000) : 0;
  const date = new Date(Date.UTC(y, mo - 1, da, h, mi, se, ms));
  if (
    date.getUTCMonth() !== mo - 1 ||
    date.getUTCDate() !== da ||
    h > 23 ||
    mi > 59 ||
    se > 59 ||
    Number.isNaN(date.getTime())
  )
    fail("bad time");
  return date;
}
