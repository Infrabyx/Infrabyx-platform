// MEDIA port contract cases (IPB-01-15; OWNER-QUESTIONS #53). Every adapter passes the same suite;
// `passthrough` declares `reencode` and `rasteriseSvg` unsupported, so those cases assert the typed
// refusal instead. Fixtures are built here with node:zlib (no image library in tests' inputs).
// MEDIA port contract cases (IPB-01-15; OWNER-QUESTIONS #53). Every adapter passes the same suite;
// `passthrough` declares `reencode` and `rasteriseSvg` unsupported, so those cases assert the typed
// refusal instead. Fixtures are built here with node:zlib (no image library in tests' inputs).
import { crc32, deflateSync } from "node:zlib";
import { MEDIA_MAX_INPUT_PIXELS, type MediaFormat } from "@infrabyx/contracts/ports";

const PNG_SIG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  const td = new Uint8Array(4 + data.length);
  td.set(new TextEncoder().encode(type), 0);
  td.set(data, 4);
  out.set(td, 4);
  v.setUint32(8 + data.length, crc32(td));
  return out;
}

const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

function ihdr(width: number, height: number): Uint8Array {
  const d = new Uint8Array(13);
  const v = new DataView(d.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  d.set([8, 2, 0, 0, 0], 8); // 8-bit RGB, deflate, no filter method, no interlace
  return chunk("IHDR", d);
}

/**
 * An RGB PNG test image (a horizontal gradient), with a `tEXt` chunk the adapters must not carry
 * into any output.
 */
export function testPng(width: number, height: number): Uint8Array {
  const raw = new Uint8Array((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x++) {
      const g = Math.round((x / Math.max(1, width - 1)) * 255);
      raw.set([g, 96, 255 - g], row + 1 + x * 3);
    }
  }
  return concat([
    PNG_SIG,
    ihdr(width, height),
    chunk("tEXt", new TextEncoder().encode("Comment\0contract-secret-metadata")),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array()),
  ]);
}

/** A PNG whose header claims more pixels than `MEDIA_MAX_INPUT_PIXELS` (its data is not valid). */
export function oversizedPngHeader(): Uint8Array {
  const side = Math.ceil(Math.sqrt(MEDIA_MAX_INPUT_PIXELS)) + 1000;
  return concat([
    PNG_SIG,
    ihdr(side, side),
    chunk("IDAT", deflateSync(new Uint8Array(16))),
    chunk("IEND", new Uint8Array()),
  ]);
}

const MAGIC: Record<MediaFormat, (b: Uint8Array) => boolean> = {
  png: (b) => PNG_SIG.every((v, i) => b[i] === v),
  jpeg: (b) => b[0] === 0xff && b[1] === 0xd8,
  webp: (b) =>
    new TextDecoder().decode(b.subarray(0, 4)) === "RIFF" &&
    new TextDecoder().decode(b.subarray(8, 12)) === "WEBP",
  avif: (b) =>
    new TextDecoder().decode(b.subarray(4, 8)) === "ftyp" &&
    /avi[fs]/.test(new TextDecoder().decode(b.subarray(8, 32))),
};

/** True when the bytes are of `format` (by magic number). */
export const isFormat = (format: MediaFormat, b: Uint8Array) => MAGIC[format](b);
