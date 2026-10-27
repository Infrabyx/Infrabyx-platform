// MEDIA port (IPB-01 §01.4.4.3 supplementary port; IPB-04-11 and §04.4.2: re-encode raster images,
// rasterise the sanitised SVG logo for favicons). Reference adapter `sharp` (libvips, OWNER-QUESTIONS
// #53, PL5-D-11), alternative `passthrough` (no re-encoding: uploads are served as uploaded). Only
// PUBLIC website assets cross this port, and the reference adapter runs in-process (IN, SELF host).
// HLS renditions and the PDF probe (IPB-04-57, -62) are later methods.
import type { Port } from "./common.js";

/** Raster formats the port writes (IPB-04-11: AVIF and WebP, plus a JPEG or PNG fallback). */
export const MEDIA_FORMATS = ["avif", "webp", "jpeg", "png"] as const;
export type MediaFormat = (typeof MEDIA_FORMATS)[number];

export const MEDIA_FORMAT_MIME: Readonly<Record<MediaFormat, string>> = {
  avif: "image/avif",
  webp: "image/webp",
  jpeg: "image/jpeg",
  png: "image/png",
};

/** Source types `reencode` accepts; GIF is served as uploaded (animation is not re-encoded). */
export const MEDIA_REENCODE_SOURCES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
] as const;

/** The fixed widths of IPB-04-11; a rendition is never wider than its source. */
export const MEDIA_RENDITION_WIDTHS = [320, 640, 960, 1280, 1920] as const;

/** Decoding limit: a larger image is refused with `IPB-SEC-013` before any pixel is decoded. */
export const MEDIA_MAX_INPUT_PIXELS = 40_000_000;

/** PNG favicon sizes rasterised from the sanitised SVG logo (IPB-04-22). */
export const FAVICON_PNG_SIZES = [32, 64, 180, 192, 512] as const;

export interface MediaProbe {
  format: MediaFormat | "gif";
  width: number;
  height: number;
}

export interface MediaRendition {
  format: MediaFormat;
  mime: string;
  width: number;
  height: number;
  bytes: Uint8Array;
}

export interface MediaReencodeRequest {
  bytes: Uint8Array;
  /** One of `MEDIA_REENCODE_SOURCES`. */
  mime: string;
  widths: readonly number[];
  formats: readonly MediaFormat[];
  /** Focal point in [0, 1] (`cms.media.focal_x`/`focal_y`), honoured when `aspect` crops. */
  focal?: { x: number; y: number };
  /** Crop to this aspect ratio (width / height) around the focal point; no crop when absent. */
  aspect?: number;
}

/**
 * Every output is stripped of EXIF, XMP, IPTC and ICC text metadata and never upscaled. Errors:
 * `IPB-SEC-014` when the bytes are not a decodable image of the declared type, `IPB-SEC-013` above
 * `MEDIA_MAX_INPUT_PIXELS`, `IPB-PORT-001` (`meta.reason: "unsupported"`) for a method the adapter
 * declares unsupported.
 */
export interface MediaPort extends Port {
  probe(bytes: Uint8Array, mime: string): Promise<MediaProbe>;
  /** One rendition per (width ≤ source width, format), widest first within each format. */
  reencode(req: MediaReencodeRequest): Promise<MediaRendition[]>;
  /** Square PNGs of a sanitised SVG (the brand sanitiser's output only), transparent padding. */
  rasteriseSvg(svg: string, sizes: readonly number[]): Promise<MediaRendition[]>;
}

/** Widths to render for a source width: the fixed widths up to it, or the source width alone. */
export function renditionWidths(
  sourceWidth: number,
  widths: readonly number[] = MEDIA_RENDITION_WIDTHS,
): number[] {
  const w = [...new Set(widths)].filter((x) => x > 0 && x <= sourceWidth).sort((a, b) => b - a);
  return w.length ? w : [sourceWidth];
}
