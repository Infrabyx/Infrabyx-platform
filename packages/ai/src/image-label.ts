// Labelling of generated images (IPB-03-06; owner decision OWN-10; PL4 plan §6). Every generated
// image is labelled before it is stored:
// - a visible caption band "AI-generated image" is composited below the picture;
// - an XMP packet (PNG iTXt `XML:com.adobe.xmp`) records `infrabyx:SGI="true"`, the model and the
//   run, the IPB-03-06 statement `Infrabyx-SGI: true; model=<id>; run=<run_id>` and the IPTC
//   digital source type `trainedAlgorithmicMedia`; a PNG text chunk `Infrabyx-SGI` repeats the
//   statement for readers without XMP.
// Only 8-bit RGB or RGBA, non-interlaced PNG is accepted (the adapters ask the providers for PNG);
// anything else cannot be labelled and is refused, so no unlabelled image is ever stored. C2PA
// signing waits for IPB-OI-03-06 (`ai.image.c2pa_sign` stays off). No dependency: zlib and CRC-32
// come from Node.
import { crc32, deflateSync, inflateSync } from "node:zlib";

export const SGI_LABEL_TEXT = "AI-generated image";
export const SGI_NAMESPACE = "urn:infrabyx:sgi:1.0";
const PNG_SIG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const IPTC_AI = "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia";

export class ImageLabelError extends Error {}

interface Chunk {
  type: string;
  data: Uint8Array;
}

function readChunks(png: Uint8Array): Chunk[] {
  if (png.length < 8 || !PNG_SIG.every((b, i) => png[i] === b))
    throw new ImageLabelError("not a PNG");
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const out: Chunk[] = [];
  let p = 8;
  while (p + 12 <= png.length) {
    const len = dv.getUint32(p);
    const type = String.fromCharCode(...png.subarray(p + 4, p + 8));
    if (p + 12 + len > png.length) throw new ImageLabelError("truncated PNG");
    out.push({ type, data: png.subarray(p + 8, p + 8 + len) });
    p += 12 + len;
    if (type === "IEND") break;
  }
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

const concat = (parts: readonly Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

interface Raster {
  width: number;
  height: number;
  channels: 3 | 4;
  pixels: Uint8Array;
}

function decode(png: Uint8Array): Raster {
  const chunks = readChunks(png);
  const ihdr = chunks.find((c) => c.type === "IHDR");
  if (!ihdr || ihdr.data.length !== 13) throw new ImageLabelError("no IHDR");
  const dv = new DataView(ihdr.data.buffer, ihdr.data.byteOffset, 13);
  const width = dv.getUint32(0);
  const height = dv.getUint32(4);
  const [depth, colour, , , interlace] = [...ihdr.data.subarray(8, 13)];
  if (depth !== 8 || (colour !== 2 && colour !== 6) || interlace !== 0)
    throw new ImageLabelError("only 8-bit RGB or RGBA, non-interlaced PNG can be labelled");
  if (width < 1 || height < 1 || width * height > 40_000_000)
    throw new ImageLabelError("image size out of range");
  const channels = colour === 6 ? 4 : 3;
  const raw = inflateSync(concat(chunks.filter((c) => c.type === "IDAT").map((c) => c.data)));
  const stride = width * channels;
  if (raw.length !== (stride + 1) * height) throw new ImageLabelError("bad image data");
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y ? pixels.subarray((y - 1) * stride, y * stride) : new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? (row[x - channels] as number) : 0;
      const b = prev[x] as number;
      const c = x >= channels ? (prev[x - channels] as number) : 0;
      const v = line[x] as number;
      let out: number;
      if (f === 0) out = v;
      else if (f === 1) out = v + a;
      else if (f === 2) out = v + b;
      else if (f === 3) out = v + ((a + b) >> 1);
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        out = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      } else throw new ImageLabelError("bad PNG filter");
      row[x] = out & 0xff;
    }
  }
  return { width, height, channels, pixels };
}

// A 5×7 bitmap font with exactly the glyphs the label needs.
const GLYPHS: Record<string, string[]> = {
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  I: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"],
  "-": [".....", ".....", ".....", "#####", ".....", ".....", "....."],
  " ": [".....", ".....", ".....", ".....", ".....", ".....", "....."],
  a: [".....", ".....", ".###.", "....#", ".####", "#...#", ".####"],
  d: ["....#", "....#", ".####", "#...#", "#...#", "#...#", ".####"],
  e: [".....", ".....", ".###.", "#...#", "#####", "#....", ".###."],
  g: [".....", ".####", "#...#", "#...#", ".####", "....#", ".###."],
  i: ["..#..", ".....", ".##..", "..#..", "..#..", "..#..", ".###."],
  m: [".....", ".....", "##.#.", "#.#.#", "#.#.#", "#.#.#", "#.#.#"],
  n: [".....", ".....", "#.##.", "##..#", "#...#", "#...#", "#...#"],
  r: [".....", ".....", "#.##.", "##..#", "#....", "#....", "#...."],
  t: ["..#..", "..#..", "#####", "..#..", "..#..", "..#.#", "...#."],
};

function caption(r: Raster): Raster {
  const bandH = Math.max(20, Math.round(r.height * 0.08));
  const height = r.height + bandH;
  const stride = r.width * r.channels;
  const pixels = new Uint8Array(stride * height);
  pixels.set(r.pixels);
  // Dark band, opaque.
  for (let y = r.height; y < height; y++)
    for (let x = 0; x < r.width; x++) {
      const o = y * stride + x * r.channels;
      pixels[o] = 17;
      pixels[o + 1] = 17;
      pixels[o + 2] = 17;
      if (r.channels === 4) pixels[o + 3] = 255;
    }
  const scale = Math.max(1, Math.floor((bandH - 6) / 7));
  const textW = SGI_LABEL_TEXT.length * 6 * scale;
  const x0 = Math.max(2, Math.floor((r.width - textW) / 2));
  const y0 = r.height + Math.floor((bandH - 7 * scale) / 2);
  [...SGI_LABEL_TEXT].forEach((ch, i) => {
    const g = GLYPHS[ch] as string[];
    for (let gy = 0; gy < 7; gy++)
      for (let gx = 0; gx < 5; gx++) {
        if (g[gy]?.[gx] !== "#") continue;
        for (let sy = 0; sy < scale; sy++)
          for (let sx = 0; sx < scale; sx++) {
            const x = x0 + (i * 6 + gx) * scale + sx;
            const y = y0 + gy * scale + sy;
            if (x >= r.width || y >= height) continue;
            const o = y * stride + x * r.channels;
            pixels[o] = 255;
            pixels[o + 1] = 255;
            pixels[o + 2] = 255;
          }
      }
  });
  return { ...r, height, pixels };
}

const xmlEscape = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The IPB-03-06 statement. */
export const sgiStatement = (o: { modelId: string; runId: string }): string =>
  `Infrabyx-SGI: true; model=${o.modelId}; run=${o.runId}`;

export function xmpPacket(o: { modelId: string; runId: string }): string {
  return (
    `<?xpacket begin="\u{feff}" id="W5M0MpCehiHzreSzNTczkc9d"?>` +
    `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">` +
    `<rdf:Description rdf:about="" xmlns:infrabyx="${SGI_NAMESPACE}" xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"` +
    ` infrabyx:SGI="true" infrabyx:Label="${xmlEscape(SGI_LABEL_TEXT)}" infrabyx:Model="${xmlEscape(o.modelId)}" infrabyx:Run="${xmlEscape(o.runId)}" infrabyx:Statement="${xmlEscape(sgiStatement(o))}"` +
    ` Iptc4xmpExt:DigitalSourceType="${IPTC_AI}"/>` +
    `</rdf:RDF></x:xmpmeta><?xpacket end="r"?>`
  );
}

export interface LabelledImage {
  bytes: Uint8Array;
  width: number;
  height: number;
  mimeType: "image/png";
}

/** Composite the caption band and embed the XMP packet; refuses what it cannot label. */
export function labelImage(
  bytes: Uint8Array,
  mimeType: string,
  o: { modelId: string; runId: string },
): LabelledImage {
  if (mimeType !== "image/png") throw new ImageLabelError(`${mimeType} cannot be labelled`);
  const r = caption(decode(bytes));
  const stride = r.width * r.channels;
  const raw = new Uint8Array((stride + 1) * r.height);
  for (let y = 0; y < r.height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(r.pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, r.width);
  dv.setUint32(4, r.height);
  ihdr.set([8, r.channels === 4 ? 6 : 2, 0, 0, 0], 8);
  const enc = new TextEncoder();
  const keyword = enc.encode("XML:com.adobe.xmp");
  // iTXt: keyword, NUL, compression flag 0, method 0, empty language tag NUL, empty translated NUL.
  const itxt = concat([keyword, Uint8Array.from([0, 0, 0, 0, 0]), enc.encode(xmpPacket(o))]);
  return {
    bytes: concat([
      PNG_SIG,
      chunk("IHDR", ihdr),
      chunk("iTXt", itxt),
      chunk(
        "tEXt",
        concat([
          enc.encode("Infrabyx-SGI"),
          Uint8Array.from([0]),
          enc.encode(sgiStatement(o).slice(14)),
        ]),
      ),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", new Uint8Array(0)),
    ]),
    width: r.width,
    height: r.height,
    mimeType: "image/png",
  };
}

/** The XMP packet of a PNG, if any. */
export function readXmp(png: Uint8Array): string | null {
  for (const c of readChunks(png)) {
    if (c.type !== "iTXt") continue;
    const text = new TextDecoder().decode(c.data);
    if (text.startsWith("XML:com.adobe.xmp\0")) return text.slice(text.indexOf("<?xpacket"));
  }
  return null;
}

/** Size of a PNG without decoding it. */
export function pngSize(png: Uint8Array): { width: number; height: number } {
  const ihdr = readChunks(png).find((c) => c.type === "IHDR");
  if (!ihdr) throw new ImageLabelError("no IHDR");
  const dv = new DataView(ihdr.data.buffer, ihdr.data.byteOffset, 8);
  return { width: dv.getUint32(0), height: dv.getUint32(4) };
}

/** A solid-colour RGB PNG (stubs and tests). */
export function solidPng(width: number, height: number, rgb: [number, number, number]): Uint8Array {
  const raw = new Uint8Array((width * 3 + 1) * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) raw.set(rgb, y * (width * 3 + 1) + 1 + x * 3);
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return concat([
    PNG_SIG,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ]);
}
