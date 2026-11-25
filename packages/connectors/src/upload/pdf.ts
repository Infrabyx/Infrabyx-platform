// The PDF check of the upload pipeline (IPB-02-44: PDFs checked for JavaScript and launch actions;
// PR-FBX-56, R1-D-292). Every PDF name in the file body and inside every object stream is read
// with its `#xx` escapes decoded, so a name hidden in a compressed object stream or spelt
// `/J#61vaScript` is found. Fail closed: an encrypted file, an object stream this reader cannot
// decode, or one that inflates past the limits is refused, never passed as clean.
import { inflateSync } from "node:zlib";
import {
  PDF_ACTIVE_NAMES,
  PDF_REPORTED_NAMES,
  UPLOAD_MAX_INFLATED_BYTES,
  UPLOAD_MAX_INFLATION_RATIO,
} from "@infrabyx/contracts/ports";

export type PdfCheck =
  | { ok: true; active: string[]; reported: string[] }
  | { ok: false; reason: "pdf_unreadable" | "pdf_encrypted" | "inflation_limit" };

const latin1 = (b: Uint8Array) => new TextDecoder("latin1").decode(b);

/** Every PDF name in `text`, `#xx` escapes decoded (PDF 1.7 §7.3.5). */
export function pdfNames(text: string): Set<string> {
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

/** The dictionary text before a `stream` keyword at `at` (back to the object's `obj`). */
function streamDict(text: string, at: number): string {
  const start = text.lastIndexOf(" obj", at);
  return text.slice(start >= 0 ? start : Math.max(0, at - 4096), at);
}

/** The `/Filter` names of a stream dictionary (one name or an array). */
function filters(dict: string): string[] {
  const m = /\/Filter\s*(\[[^\]]*\]|\/[^\s/<>[\]]+)/.exec(dict);
  if (!m) return [];
  return [...pdfNames(m[1]!)];
}

/**
 * Checks one PDF. `active` lists the always-active names found (`PDF_ACTIVE_NAMES`), `reported`
 * the names ordinary PDFs use (`PDF_REPORTED_NAMES`).
 */
export function checkPdf(bytes: Uint8Array): PdfCheck {
  const text = latin1(bytes);
  // The names outside stream data: a stream's bytes (an image, a font) can hold `/JS` by chance.
  const outside: string[] = [];
  let at = 0;
  const all = /(?<!end)stream\r?\n/g;
  for (let m = all.exec(text); m; m = all.exec(text)) {
    outside.push(text.slice(at, m.index));
    const start = m.index + m[0].length;
    const end = text.indexOf("endstream", start);
    if (end < 0) return { ok: false, reason: "pdf_unreadable" };
    const data = text.slice(start, end);
    // A viewer that ends the stream at a direct /Length, or that finds an object inside the data
    // through the cross-reference table, reads what follows as objects: such bytes count as
    // outside stream data, so an object hidden there is still read.
    const len = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(streamDict(text, m.index));
    if (/\d+\s+\d+\s+obj\b/.test(data)) outside.push(data);
    else if (len && Number(len[1]) < data.length) outside.push(data.slice(Number(len[1])));
    at = end;
    all.lastIndex = end + "endstream".length;
  }
  outside.push(text.slice(at));
  const names = pdfNames(outside.join(" "));
  if (names.has("Encrypt")) return { ok: false, reason: "pdf_encrypted" };
  let inflated = 0;
  // Every stream: object streams (`/Type /ObjStm`) hold dictionaries and must be read; XRef
  // streams hold only offsets. Other streams (page content, images, fonts, embedded files) hold no
  // dictionary a viewer acts on, so they are not decoded here (the AV scan read them).
  const re = /(?<!end)stream\r?\n/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const dict = streamDict(text, m.index);
    const dictNames = pdfNames(dict);
    if (!dictNames.has("ObjStm")) continue;
    const start = m.index + m[0].length;
    const end = text.indexOf("endstream", start);
    if (end < 0) return { ok: false, reason: "pdf_unreadable" };
    let body = bytes.subarray(start, end);
    const fs = filters(dict);
    for (const f of fs) {
      if (f !== "FlateDecode" && f !== "Fl") return { ok: false, reason: "pdf_unreadable" };
      try {
        const out: Uint8Array = inflateSync(body, {
          maxOutputLength: Math.max(1, UPLOAD_MAX_INFLATED_BYTES - inflated),
        });
        if (out.length > Math.max(1024 * 1024, body.length * UPLOAD_MAX_INFLATION_RATIO))
          return { ok: false, reason: "inflation_limit" };
        inflated += out.length;
        body = out;
      } catch (e) {
        if ((e as { code?: string }).code === "ERR_BUFFER_TOO_LARGE")
          return { ok: false, reason: "inflation_limit" };
        // A stream that does not inflate: some writers leave a trailing EOL inside the data.
        try {
          const trimmed = body.subarray(0, Math.max(0, body.length - 2));
          body = inflateSync(trimmed, { maxOutputLength: UPLOAD_MAX_INFLATED_BYTES - inflated });
          inflated += body.length;
        } catch {
          return { ok: false, reason: "pdf_unreadable" };
        }
      }
      if (inflated > UPLOAD_MAX_INFLATED_BYTES) return { ok: false, reason: "inflation_limit" };
    }
    for (const n of pdfNames(latin1(body))) names.add(n);
  }
  const active = PDF_ACTIVE_NAMES.filter((n) => names.has(n));
  const reported = PDF_REPORTED_NAMES.filter((n) => names.has(n));
  return { ok: true, active, reported };
}
