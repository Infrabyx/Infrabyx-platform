// The Office check of the upload pipeline (IPB-02-44: Office files scanned for macros and refused
// unless the route allows them; PR-FBX-56, R1-D-292). An OOXML file is a zip: its central
// directory names every part, and `[Content_Types].xml` and the `.rels` files say what each part
// is, so a VBA project renamed away from `vbaProject.bin` is still found. Legacy OLE documents
// (`.doc`, `.xls`, `.ppt`) cannot be checked part by part and count as macro-bearing. Fail closed:
// a damaged zip, an encrypted entry or an entry that inflates past the limits is refused.
import { inflateRawSync } from "node:zlib";
import { UPLOAD_MAX_INFLATED_BYTES, UPLOAD_MAX_INFLATION_RATIO } from "@infrabyx/contracts/ports";

export type OfficeCheck =
  { ok: true; macros: string[] } | { ok: false; reason: "office_unreadable" | "inflation_limit" };

interface Entry {
  name: string;
  method: number;
  flags: number;
  compressed: number;
  size: number;
  offset: number;
}

const u16 = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8);
const u32 = (b: Uint8Array, i: number) =>
  (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0;

/** The central directory's entries (no ZIP64, no multi-disk; both refused as unreadable). */
function entries(b: Uint8Array): Entry[] | null {
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xffff); i--)
    if (u32(b, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) return null;
  const count = u16(b, eocd + 10);
  const cdSize = u32(b, eocd + 12);
  const cdOffset = u32(b, eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff || u16(b, eocd + 4) !== 0) return null;
  // The record must end the file (its comment exactly fills the rest) and the central directory
  // must end where it starts, so a second directory planted in a comment cannot be the one read.
  if (eocd + 22 + u16(b, eocd + 20) !== b.length || cdOffset + cdSize !== eocd) return null;
  const out: Entry[] = [];
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > b.length || u32(b, p) !== 0x02014b50) return null;
    const nameLen = u16(b, p + 28);
    const extraLen = u16(b, p + 30);
    const commentLen = u16(b, p + 32);
    const name = new TextDecoder("utf-8").decode(b.subarray(p + 46, p + 46 + nameLen));
    out.push({
      name,
      flags: u16(b, p + 8),
      method: u16(b, p + 10),
      compressed: u32(b, p + 20),
      size: u32(b, p + 24),
      offset: u32(b, p + 42),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (p !== eocd) return null;
  return out;
}

/** One entry's bytes, inflated within the limits. */
function read(
  b: Uint8Array,
  e: Entry,
  budget: { left: number },
): Uint8Array | "unreadable" | "limit" {
  if (e.flags & 0x1) return "unreadable"; // encrypted
  const h = e.offset;
  if (h + 30 > b.length || u32(b, h) !== 0x04034b50) return "unreadable";
  const start = h + 30 + u16(b, h + 26) + u16(b, h + 28);
  const data = b.subarray(start, start + e.compressed);
  if (data.length !== e.compressed) return "unreadable";
  if (e.method === 0) return data;
  if (e.method !== 8) return "unreadable";
  if (
    e.size > budget.left ||
    e.size > Math.max(1024 * 1024, e.compressed * UPLOAD_MAX_INFLATION_RATIO)
  )
    return "limit";
  try {
    const out = inflateRawSync(data, {
      maxOutputLength: Math.max(1, Math.min(budget.left, e.size + 1)),
    });
    if (out.length !== e.size) return "unreadable";
    budget.left -= out.length;
    return out;
  } catch (x) {
    return (x as { code?: string }).code === "ERR_BUFFER_TOO_LARGE" ? "limit" : "unreadable";
  }
}

const MACRO_PART =
  /(^|\/)(vbaProject\.bin|vbaData\.xml|vbaProjectSignature\.bin)$|(^|\/)(activeX|embeddings)\/|(^|\/)oleObject[^/]*\.bin$/i;
const MACRO_TYPE =
  /ms-office\.vbaProject|ms-office\.activeX|macroEnabled|vbaData|ms-excel\.(sheet\.binary\.)?macro|ms-excel\.intlmacrosheet|\.xlm\b/i;
const MACRO_REL =
  /\/relationships\/(vbaProject|activeXControl|activeXControlBinary|wordVbaData|xlMacrosheet|xlIntlMacrosheet|oleObject|package|attachedTemplate|frame|subDocument)\b/i;

/** XML character and entity references decoded, so an escaped type cannot hide (`vba&#80;roject`). */
function decodeXml(t: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  return t
    .replace(/&#x([0-9a-f]+);?/gi, (_m, h: string) =>
      String.fromCodePoint(Math.min(parseInt(h, 16), 0x10ffff)),
    )
    .replace(/&#([0-9]+);?/g, (_m, d: string) =>
      String.fromCodePoint(Math.min(parseInt(d, 10), 0x10ffff)),
    )
    .replace(/&(amp|lt|gt|quot|apos);/g, (_m, e: string) => named[e]!);
}

/**
 * Checks one OOXML package: every part name, `[Content_Types].xml` and every `.rels` file. `macros`
 * lists what was found (labels, never content): a VBA project, ActiveX controls, Excel 4 macro
 * sheets or a macro-enabled main part.
 */
export function checkOoxml(bytes: Uint8Array): OfficeCheck {
  const list = entries(bytes);
  if (!list || !list.some((e) => e.name.toLowerCase() === "[content_types].xml"))
    return { ok: false, reason: "office_unreadable" };
  const total = list.reduce((n, e) => n + e.size, 0);
  if (total > UPLOAD_MAX_INFLATED_BYTES) return { ok: false, reason: "inflation_limit" };
  const macros = new Set<string>();
  const budget = { left: UPLOAD_MAX_INFLATED_BYTES };
  for (const e of list) {
    if (MACRO_PART.test(e.name)) {
      const n = e.name.toLowerCase();
      macros.add(
        n.includes("activex")
          ? "activex"
          : /embeddings\/|oleobject/.test(n)
            ? "embedded_object"
            : "vba_project",
      );
    }
    // Every entry is inflated once within the limits, so a zip bomb anywhere in the file is found.
    const body = read(bytes, e, budget);
    if (body === "limit") return { ok: false, reason: "inflation_limit" };
    if (body === "unreadable") return { ok: false, reason: "office_unreadable" };
    const lower = e.name.toLowerCase();
    if (lower === "[content_types].xml" || lower.endsWith(".rels")) {
      // Only UTF-8 is read; a UTF-16 (or other) part could carry a type this check cannot see.
      if (body.includes(0)) return { ok: false, reason: "office_unreadable" };
      let raw: string;
      try {
        raw = new TextDecoder("utf-8", { fatal: true }).decode(body);
      } catch {
        return { ok: false, reason: "office_unreadable" };
      }
      if (/<!ENTITY|<!DOCTYPE/i.test(raw)) return { ok: false, reason: "office_unreadable" };
      const text = decodeXml(raw);
      if (MACRO_TYPE.test(text)) macros.add("macro_content_type");
      if (MACRO_REL.test(text)) macros.add("macro_relationship");
    }
  }
  return { ok: true, macros: [...macros].sort() };
}
