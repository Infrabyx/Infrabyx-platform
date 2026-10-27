// Image header probe (MEDIA port): format and size from the file header only, so a size limit can be
// enforced before any decoder sees the pixels. PNG, JPEG, GIF, WebP (VP8, VP8L, VP8X) and AVIF
// (the `ispe` property). Anything else, or a header that does not match the declared type, is
// `IPB-SEC-014`.
import { PortError } from "@infrabyx/contracts/errors";
import type { MediaProbe } from "@infrabyx/contracts/ports";

const MIME_FORMAT: Record<string, MediaProbe["format"]> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
};

const ascii = (b: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...b.subarray(from, to));
const u16be = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!;
const u16le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8);
const u24le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);
const u32be = (b: Uint8Array, i: number) =>
  ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;

function size(b: Uint8Array, format: MediaProbe["format"]): [number, number] | null {
  switch (format) {
    case "png":
      return b.length >= 24 && ascii(b, 1, 4) === "PNG" && ascii(b, 12, 16) === "IHDR"
        ? [u32be(b, 16), u32be(b, 20)]
        : null;
    case "gif":
      return b.length >= 10 && ascii(b, 0, 3) === "GIF" ? [u16le(b, 6), u16le(b, 8)] : null;
    case "jpeg": {
      if (b[0] !== 0xff || b[1] !== 0xd8) return null;
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) return null;
        const m = b[i + 1]!;
        // SOF0…SOF15 except DHT (C4), JPG (C8) and DAC (CC) carry the frame size.
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
          return [u16be(b, i + 7), u16be(b, i + 5)];
        i += 2 + u16be(b, i + 2);
      }
      return null;
    }
    case "webp": {
      if (b.length < 30 || ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 12) !== "WEBP") return null;
      const kind = ascii(b, 12, 16);
      if (kind === "VP8X") return [u24le(b, 24) + 1, u24le(b, 27) + 1];
      if (kind === "VP8L") {
        const v = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
        return [(v & 0x3fff) + 1, ((v >>> 14) & 0x3fff) + 1];
      }
      if (kind === "VP8 ") return [u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff];
      return null;
    }
    case "avif": {
      if (b.length < 16 || ascii(b, 4, 8) !== "ftyp" || !/avi[fs]/.test(ascii(b, 8, 32)))
        return null;
      // The first image spatial extents property (ispe: version/flags, width, height).
      const limit = Math.min(b.length - 20, 64 * 1024);
      for (let i = 0; i < limit; i++)
        if (b[i] === 0x69 && ascii(b, i, i + 4) === "ispe")
          return [u32be(b, i + 8), u32be(b, i + 12)];
      return null;
    }
  }
}

/** Format and size from the header; refuses a mismatch with the declared type. */
export function probeHeader(bytes: Uint8Array, mime: string, adapter: string): MediaProbe {
  const format = MIME_FORMAT[mime];
  const dims = format ? size(bytes, format) : null;
  if (!format || !dims || !dims[0] || !dims[1])
    throw new PortError("IPB-SEC-014", "MEDIA", {
      adapter,
      detail: `not a decodable ${mime} image`,
    });
  return { format, width: dims[0], height: dims[1] };
}
