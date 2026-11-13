// A minimal TrueType reader for `toPdf` (R1-D-96): the metrics and the character map of the
// bundled, already-subset Noto Sans fonts (`fonts/FONTS.md`), enough to embed them whole as
// CIDFontType2 fonts. It reads `head`, `hhea`, `hmtx`, `cmap` (formats 4 and 12), `OS/2` and
// `post`; it never parses outlines, and it only ever reads the files shipped with the package.
import { readFileSync } from "node:fs";

export interface TrueTypeFont {
  /** The PostScript name (name ID 6), for `/BaseFont`. */
  postScriptName: string;
  bytes: Buffer;
  unitsPerEm: number;
  bbox: [number, number, number, number];
  ascent: number;
  descent: number;
  capHeight: number;
  italicAngle: number;
  /** Code point to glyph id. */
  cmap: ReadonlyMap<number, number>;
  /** Advance width of a glyph, in font units. */
  advance(gid: number): number;
}

export function parseTrueType(bytes: Buffer): TrueTypeFont {
  if (bytes.readUInt32BE(0) !== 0x00010000) throw new Error("not a TrueType font");
  const tables = new Map<string, { offset: number; length: number }>();
  const n = bytes.readUInt16BE(4);
  for (let i = 0; i < n; i++) {
    const at = 12 + i * 16;
    tables.set(bytes.toString("latin1", at, at + 4), {
      offset: bytes.readUInt32BE(at + 8),
      length: bytes.readUInt32BE(at + 12),
    });
  }
  const t = (tag: string) => {
    const x = tables.get(tag);
    if (!x) throw new Error(`the font has no ${tag} table`);
    return x.offset;
  };
  const head = t("head");
  const unitsPerEm = bytes.readUInt16BE(head + 18);
  const bbox: [number, number, number, number] = [
    bytes.readInt16BE(head + 36),
    bytes.readInt16BE(head + 38),
    bytes.readInt16BE(head + 40),
    bytes.readInt16BE(head + 42),
  ];
  const hhea = t("hhea");
  const ascent = bytes.readInt16BE(hhea + 4);
  const descent = bytes.readInt16BE(hhea + 6);
  const metrics = bytes.readUInt16BE(hhea + 34);
  const hmtx = t("hmtx");
  const advance = (gid: number) => bytes.readUInt16BE(hmtx + 4 * Math.min(gid, metrics - 1));
  const os2 = t("OS/2");
  const capHeight = bytes.readUInt16BE(os2) >= 2 ? bytes.readInt16BE(os2 + 88) : ascent;
  const post = t("post");
  const italicAngle = bytes.readInt32BE(post + 4) / 65536;
  return {
    postScriptName: nameOf(bytes, t("name")),
    bytes,
    unitsPerEm,
    bbox,
    ascent,
    descent,
    capHeight,
    italicAngle,
    cmap: readCmap(bytes, t("cmap")),
    advance,
  };
}

function readCmap(b: Buffer, at: number): Map<number, number> {
  const count = b.readUInt16BE(at + 2);
  let best: { offset: number; format: number } | undefined;
  for (let i = 0; i < count; i++) {
    const rec = at + 4 + i * 8;
    const platform = b.readUInt16BE(rec);
    const encoding = b.readUInt16BE(rec + 2);
    const offset = at + b.readUInt32BE(rec + 4);
    const format = b.readUInt16BE(offset);
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (unicode && (format === 12 || (format === 4 && best?.format !== 12)))
      best = { offset, format };
  }
  if (!best) throw new Error("the font has no Unicode cmap");
  const map = new Map<number, number>();
  const o = best.offset;
  if (best.format === 12) {
    const groups = b.readUInt32BE(o + 12);
    for (let g = 0; g < groups; g++) {
      const r = o + 16 + g * 12;
      const start = b.readUInt32BE(r);
      const end = b.readUInt32BE(r + 4);
      const gid = b.readUInt32BE(r + 8);
      for (let c = start; c <= end; c++) map.set(c, gid + (c - start));
    }
    return map;
  }
  const segs = b.readUInt16BE(o + 6) / 2;
  const ends = o + 14;
  const starts = ends + segs * 2 + 2;
  const deltas = starts + segs * 2;
  const ranges = deltas + segs * 2;
  for (let s = 0; s < segs; s++) {
    const end = b.readUInt16BE(ends + s * 2);
    const start = b.readUInt16BE(starts + s * 2);
    const delta = b.readInt16BE(deltas + s * 2);
    const rangeAt = ranges + s * 2;
    const range = b.readUInt16BE(rangeAt);
    for (let c = start; c <= end && c !== 0xffff; c++) {
      let gid: number;
      if (range === 0) gid = (c + delta) & 0xffff;
      else {
        const g = b.readUInt16BE(rangeAt + range + (c - start) * 2);
        gid = g === 0 ? 0 : (g + delta) & 0xffff;
      }
      if (gid) map.set(c, gid);
    }
  }
  return map;
}

function nameOf(b: Buffer, at: number): string {
  const count = b.readUInt16BE(at + 2);
  const strings = at + b.readUInt16BE(at + 4);
  for (let i = 0; i < count; i++) {
    const r = at + 6 + i * 12;
    if (b.readUInt16BE(r + 6) !== 6) continue;
    const platform = b.readUInt16BE(r);
    const len = b.readUInt16BE(r + 8);
    const off = strings + b.readUInt16BE(r + 10);
    const raw = b.subarray(off, off + len);
    const s =
      platform === 3 || platform === 0
        ? String.fromCharCode(...Array.from({ length: len / 2 }, (_, k) => raw.readUInt16BE(k * 2)))
        : raw.toString("latin1");
    if (/^[A-Za-z0-9-]+$/.test(s)) return s;
  }
  throw new Error("the font has no PostScript name");
}

/** The four bundled styles and the Arrows fallback (`Math`, Noto Sans Math), read once. */
const cache = new Map<string, TrueTypeFont>();
export function bundledFont(
  style: "Regular" | "Bold" | "Italic" | "BoldItalic" | "Math",
): TrueTypeFont {
  let f = cache.get(style);
  if (!f) {
    const file =
      style === "Math" ? "NotoSansMath-Regular.subset.ttf" : `NotoSans-${style}.subset.ttf`;
    f = parseTrueType(readFileSync(new URL(`../fonts/${file}`, import.meta.url)));
    cache.set(style, f);
  }
  return f;
}
