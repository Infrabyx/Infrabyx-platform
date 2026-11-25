// Type sniffing for the upload pipeline (IPB-02-44: magic bytes must agree with the declared type;
// PR-FBX-56, R1-D-292). The sniffed type is decided from the bytes alone; a file that also reads
// as markup (a PNG/HTML polyglot, a script after a JPEG's end) is refused before anything else.
import type { UploadKind } from "@infrabyx/contracts/ports";

export type SniffedType =
  "png" | "jpeg" | "webp" | "avif" | "gif" | "svg" | "pdf" | "zip" | "ole" | "unknown";

const ascii = (b: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...b.subarray(from, Math.min(to, b.length)));

/** The type the bytes are, from their first bytes (and, for SVG, the root element). */
export function sniffType(b: Uint8Array): SniffedType {
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 4) === "PNG" && b[4] === 0x0d) return "png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return "webp";
  if (b.length >= 12 && ascii(b, 4, 8) === "ftyp" && /^avi[fs]/.test(ascii(b, 8, 12)))
    return "avif";
  if (b.length >= 6 && /^GIF8[79]a$/.test(ascii(b, 0, 6))) return "gif";
  if (b.length >= 5 && ascii(b, 0, 5) === "%PDF-") return "pdf";
  if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04)
    return "zip";
  if (b.length >= 8 && [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((x, i) => b[i] === x))
    return "ole";
  if (isSvgText(b)) return "svg";
  return "unknown";
}

/** SVG: UTF-8 text whose first element, after an XML declaration and comments, is `<svg`. */
function isSvgText(b: Uint8Array): boolean {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(b.subarray(0, 64 * 1024));
  } catch {
    return false;
  }
  const head = text
    .replace(/^\uFEFF/, "")
    .replace(/^\s*<\?xml[^>]*\?>/, "")
    .replace(/^(\s*<!--[\s\S]*?-->)*/, "")
    .trimStart();
  return /^<svg[\s>]/i.test(head);
}

/** The sniffed types each kind may be. */
export const KIND_SNIFFS: Readonly<Record<UploadKind, readonly SniffedType[]>> = {
  raster: ["png", "jpeg", "webp", "avif"],
  svg: ["svg"],
  pdf: ["pdf"],
  office: ["zip", "ole"],
};

/** The declared raster types' sniffed formats. */
export const RASTER_SNIFF: Readonly<Record<string, SniffedType>> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/webp": "webp",
  "image/avif": "avif",
};

/**
 * Markup a browser or interpreter would run, anywhere in a binary file: the second reading of a
 * polyglot (IPB-02-AT-16's PNG with embedded HTML). Case-insensitive, at least five characters, so
 * compressed pixel data matches by chance with negligible probability.
 */
const MARKUP = [
  "<html",
  "<script",
  "<body",
  "<!doctype",
  "<iframe",
  "<object",
  "<embed",
  "<svg",
  "<?php",
  "<%@",
  "javascript:",
];

/** Whether the bytes carry markup a second parser would run (labels of what was found). */
export function polyglotMarkers(b: Uint8Array): string[] {
  // Latin-1 keeps one character per byte, so offsets and case folding are exact.
  const text = new TextDecoder("latin1").decode(b).toLowerCase();
  return MARKUP.filter((m) => text.includes(m));
}

/** Bytes after a raster's own end (PNG `IEND`, JPEG `EOI`): data no image decoder reads. */
export function trailingBytes(b: Uint8Array, kind: SniffedType): number {
  if (kind === "png") {
    // Walk the chunks: length, type, data, CRC.
    let i = 8;
    while (i + 12 <= b.length) {
      const len = ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
      const type = ascii(b, i + 4, i + 8);
      i += 12 + len;
      if (type === "IEND") return Math.max(0, b.length - i);
    }
    return 0;
  }
  if (kind === "jpeg") {
    for (let i = b.length - 2; i >= 2; i--)
      if (b[i] === 0xff && b[i + 1] === 0xd9) return b.length - (i + 2);
  }
  return 0;
}
