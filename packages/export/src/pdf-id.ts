// What a PDF claims to conform to (Udofin PR-UDF-077, R1-D-259): the PDF/A and PDF/UA
// identification in the XMP metadata of the document catalog (ISO 19005 `pdfaid:part` and
// `pdfaid:conformance`, ISO 14289 `pdfuaid:part`). It reports the CLAIM only, never whether the
// file conforms: only a validator (veraPDF, as the integration suite runs it) can say that.
//
// A bounded reader, not a PDF parser: no object model, no page tree, nothing executed or fetched.
//   * The file is capped (`maxBytes`, default 64 MiB) and must start `%PDF-` within 1 KiB.
//   * The catalog is the last top-level `/Type /Catalog` object (an incremental update appends a
//     new one), else the last one inside an object stream (`/Type /ObjStm`, FlateDecode, at most
//     `PDF_ID_MAX_OBJECT_STREAMS` of them, each inflated to at most 4 MiB).
//   * Its `/Metadata n g R` names the stream, read from the last `n g obj`; uncompressed or
//     FlateDecode only (inflated to at most 4 MiB); any other filter is no claim.
//   * The XMP is read as UTF-8, for the prefixes bound to the PDF/A and PDF/UA identification
//     namespaces, in element or attribute form. Other metadata streams (pages, images, fonts)
//     never count.
// Anything missing, malformed or over a limit is no claim (`{}`), except a file over `maxBytes`,
// which is refused (`too_large`).
import { inflateSync } from "node:zlib";
import { OFFICE_MAX_BYTES_LIMIT, OfficeExportError } from "./ooxml.js";

/** The identification a PDF's catalog metadata claims; each part only when claimed. */
export interface PdfIdentification {
  /** PDF/A (ISO 19005): `part` 1 to 4 and, when given, `conformance` (`A`, `B`, `U`, `E`, `F`). */
  pdfa?: { part: number; conformance?: string };
  /** PDF/UA (ISO 14289): `part` 1 or 2. */
  pdfua?: { part: number };
}

export interface PdfIdentificationOptions {
  /** The largest file read (default 64 MiB); a larger one is refused (`too_large`). */
  maxBytes?: number;
}

export const PDF_ID_DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
/** The most object streams searched for the catalog. */
export const PDF_ID_MAX_OBJECT_STREAMS = 64;
const MAX_INFLATE = 4 * 1024 * 1024;
const MAX_INFLATE_TOTAL = 32 * 1024 * 1024;
const PDFA_NS = "http://www.aiim.org/pdfa/ns/id/";
const PDFUA_NS = "http://www.aiim.org/pdfua/ns/id/";

function inflate(b: Buffer): Buffer | undefined {
  try {
    return inflateSync(b, { maxOutputLength: MAX_INFLATE });
  } catch {
    return undefined;
  }
}

/** Where object `n g` starts (the last definition wins), or -1. */
function lastObject(text: string, n: string, g: string): number {
  const re = new RegExp(`(?:^|[^0-9])${n}[ \\t\\r\\n\\f\\0]+${g}[ \\t\\r\\n\\f\\0]+obj\\b`, "g");
  let at = -1;
  for (let m = re.exec(text); m; m = re.exec(text)) at = m.index;
  return at;
}

/** An object's dictionary text: from `at` to its `stream` or `endobj`, at most 64 KiB. */
function dictText(text: string, at: number): string {
  const end = text.slice(at, at + 65_536);
  const stop = end.search(/\bstream\b|\bendobj\b/);
  return stop < 0 ? end : end.slice(0, stop);
}

/** The bytes of the stream of the object at `at`, decoded, or undefined. */
function streamOf(buf: Buffer, text: string, at: number): Buffer | undefined {
  const dict = dictText(text, at);
  const kw = text.indexOf("stream", at + dict.length);
  if (kw !== at + dict.length) return undefined;
  let start = kw + 6;
  if (text[start] === "\r") start++;
  if (text[start] === "\n") start++;
  let len: number | undefined;
  const direct = /\/Length[ \t\r\n]+(\d{1,10})(?![0-9]|[ \t\r\n]+\d+[ \t\r\n]+R)/.exec(dict);
  if (direct) len = Number(direct[1]);
  else {
    const ref = /\/Length[ \t\r\n]+(\d{1,10})[ \t\r\n]+(\d{1,5})[ \t\r\n]+R/.exec(dict);
    if (ref) {
      const o = lastObject(text, ref[1]!, ref[2]!);
      const v =
        o < 0 ? null : /obj[ \t\r\n]*(\d{1,10})[ \t\r\n]*endobj/.exec(text.slice(o, o + 64));
      if (v) len = Number(v[1]);
    }
  }
  if (len === undefined || start + len > buf.length) {
    const e = text.indexOf("endstream", start);
    if (e < 0) return undefined;
    len = e - start;
  }
  const raw = buf.subarray(start, start + len);
  const filter = /\/Filter[ \t\r\n]*(\[[^\]]{0,200}\]|\/[A-Za-z0-9]+)/.exec(dict)?.[1];
  if (filter === undefined) return raw;
  const names = filter.match(/\/[A-Za-z0-9]+/g) ?? [];
  if (names.length === 1 && names[0] === "/FlateDecode") return inflate(raw);
  return undefined;
}

const CATALOG = /\/Type[ \t\r\n]*\/Catalog(?![A-Za-z0-9])/;
const METADATA_REF = /\/Metadata[ \t\r\n]+(\d{1,10})[ \t\r\n]+(\d{1,5})[ \t\r\n]+R/;

const WINDOW = 65_536;

/** Where the object holding position `i` starts (`n g obj`), looking back at most 64 KiB. */
function objectStart(text: string, i: number): number {
  const from = Math.max(0, i - WINDOW);
  const objAt = text.slice(from, i).lastIndexOf("obj");
  if (objAt < 0) return -1;
  const lead = Math.max(0, from + objAt - 32);
  const h = text.slice(lead, from + objAt).search(/\d+[ \t\r\n]+\d+[ \t\r\n]+$/);
  return h < 0 ? -1 : lead + h;
}

/** The catalog's `/Metadata` reference, from a top-level catalog or one in an object stream. */
function metadataRef(buf: Buffer, text: string): [string, string] | undefined {
  // The last top-level catalog: an incremental update appends its new catalog after the old one.
  const top = new RegExp(CATALOG.source, "g");
  let lastAt = -1;
  for (let m = top.exec(text); m; m = top.exec(text)) lastAt = m.index;
  if (lastAt >= 0) {
    const at = objectStart(text, lastAt);
    if (at < 0) return undefined;
    const body = text.slice(at, lastAt + WINDOW);
    const end = body.indexOf("endobj");
    const r = METADATA_REF.exec(end < 0 ? body : body.slice(0, end));
    return r ? [r[1]!, r[2]!] : undefined;
  }
  // A catalog compressed into an object stream (PDF 1.5): the last one found wins.
  const objstm = /\/Type[ \t\r\n]*\/ObjStm(?![A-Za-z0-9])/g;
  let found: [string, string] | undefined;
  let streams = 0;
  let total = 0;
  for (let m = objstm.exec(text); m && streams < PDF_ID_MAX_OBJECT_STREAMS; m = objstm.exec(text)) {
    streams++;
    const at = objectStart(text, m.index);
    if (at < 0) continue;
    const body = streamOf(buf, text, at);
    if (!body) continue;
    total += body.length;
    if (total > MAX_INFLATE_TOTAL) break;
    const dict = dictText(text, at);
    const n = /\/N[ \t\r\n]+(\d{1,6})(?![0-9])/.exec(dict);
    const first = /\/First[ \t\r\n]+(\d{1,9})(?![0-9])/.exec(dict);
    if (!n || !first) continue;
    // The header: `objnum offset` pairs; each object runs from its offset to the next one's.
    // Offsets that do not increase, or point outside the stream, end the stream's reading.
    const inner = body.toString("latin1");
    const f = Number(first[1]);
    if (f > inner.length) continue;
    const nums = inner
      .slice(0, f)
      .trim()
      .split(/[ \t\r\n]+/)
      .map(Number);
    const offsets: number[] = [];
    for (let i = 1; i < nums.length && offsets.length < Number(n[1]); i += 2) {
      const o = nums[i]!;
      if (!Number.isSafeInteger(o) || f + o > inner.length) break;
      if (offsets.length > 0 && o <= offsets[offsets.length - 1]!) break;
      offsets.push(o);
    }
    for (let i = 0; i < offsets.length; i++) {
      const obj = inner.slice(
        f + offsets[i]!,
        i + 1 < offsets.length ? f + offsets[i + 1]! : undefined,
      );
      if (!CATALOG.test(obj)) continue;
      const r = METADATA_REF.exec(obj);
      found = r ? [r[1]!, r[2]!] : undefined;
    }
  }
  return found;
}

/** The value of `prefix:name` in element or attribute form, or undefined. */
function xmpValue(xmp: string, prefix: string, name: string): string | undefined {
  const p = prefix.replace(/[.-]/g, "\\$&");
  const el = new RegExp(
    `<${p}:${name}>[ \\t\\r\\n]*([^<]{1,16}?)[ \\t\\r\\n]*</${p}:${name}>`,
  ).exec(xmp);
  if (el) return el[1];
  const at = new RegExp(
    `[ \\t\\r\\n]${p}:${name}[ \\t\\r\\n]*=[ \\t\\r\\n]*["']([^"'<]{1,16})["']`,
  ).exec(xmp);
  return at?.[1];
}

/** Prefixes bound to `ns` in the packet (`xmlns:pfx="ns"`). */
function prefixesOf(xmp: string, ns: string): string[] {
  const out: string[] = [];
  const re = /xmlns:([A-Za-z_][A-Za-z0-9_.-]{0,63})[ \t\r\n]*=[ \t\r\n]*["']([^"']{1,256})["']/g;
  for (let m = re.exec(xmp); m; m = re.exec(xmp)) if (m[2] === ns) out.push(m[1]!);
  return out;
}

function partOf(v: string | undefined, max: number): number | undefined {
  if (v === undefined || !/^[1-9]$/.test(v)) return undefined;
  const n = Number(v);
  return n <= max ? n : undefined;
}

/** The identification claims of an XMP packet. */
function claimsOf(xmp: string): PdfIdentification {
  const out: PdfIdentification = {};
  for (const p of prefixesOf(xmp, PDFA_NS)) {
    const part = partOf(xmpValue(xmp, p, "part"), 4);
    if (part === undefined) continue;
    const c = xmpValue(xmp, p, "conformance");
    out.pdfa =
      c !== undefined && /^[A-Za-z]$/.test(c) ? { part, conformance: c.toUpperCase() } : { part };
    break;
  }
  for (const p of prefixesOf(xmp, PDFUA_NS)) {
    const part = partOf(xmpValue(xmp, p, "part"), 2);
    if (part === undefined) continue;
    out.pdfua = { part };
    break;
  }
  return out;
}

/**
 * The PDF/A and PDF/UA identification `bytes` claims in its catalog's XMP metadata. A claim, not
 * a validation: a file can claim what it does not meet. `{}` for no claim, a file that is not a
 * PDF, or one this reader cannot follow; a file over `maxBytes` is refused (`too_large`).
 */
export function pdfIdentification(
  bytes: Uint8Array,
  o: PdfIdentificationOptions = {},
): PdfIdentification {
  const max = o.maxBytes ?? PDF_ID_DEFAULT_MAX_BYTES;
  if (!Number.isSafeInteger(max) || max < 1 || max > OFFICE_MAX_BYTES_LIMIT)
    throw new OfficeExportError(
      "max_bytes_invalid",
      `maxBytes must be an integer from 1 to ${OFFICE_MAX_BYTES_LIMIT}`,
    );
  if (!(bytes instanceof Uint8Array)) throw new OfficeExportError("block_invalid", "bytes needed");
  if (bytes.length > max) throw new OfficeExportError("too_large", `the file is over ${max} bytes`);
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const head = buf.subarray(0, 1024).toString("latin1");
  if (!head.includes("%PDF-")) return {};
  const text = buf.toString("latin1");
  const ref = metadataRef(buf, text);
  if (!ref) return {};
  const at = lastObject(text, ref[0], ref[1]);
  if (at < 0) return {};
  const xmp = streamOf(buf, text, at);
  return xmp ? claimsOf(xmp.toString("utf8")) : {};
}

/** Whether `bytes` claims PDF/UA in its catalog's XMP (`pdfIdentification`; a claim only). */
export function pdfUaClaimed(bytes: Uint8Array, o: PdfIdentificationOptions = {}): boolean {
  return pdfIdentification(bytes, o).pdfua !== undefined;
}
