// MEDIA reference adapter `sharp` (IPB-01 §01.4.4.3 "sharp + ffmpeg in worker"; OWNER-QUESTIONS #53,
// PL5-D-11). `sharp` (Apache-2.0) loads the prebuilt, unmodified `@img/sharp-libvips-*` binaries
// (LGPL-3.0-or-later) dynamically; the owner approved a licence exception for that package family
// only (scripts/licence-check.mjs, NOTICE). `sharp` is an optional peer dependency of this package:
// a product that re-encodes installs it, and this adapter loads it on first use.
// Hardening: the header is checked against the declared type and `MEDIA_MAX_INPUT_PIXELS` before
// libvips decodes anything, libvips enforces the same limit, `failOn: "error"` refuses truncated
// files, the libvips cache is off, every output drops EXIF/XMP/IPTC and the ICC profile (converted
// to sRGB), and SVG input must be the brand sanitiser's output (no DOCTYPE, entity, script or
// external reference).
import { PortError } from "@infrabyx/contracts/errors";
import {
  MEDIA_FORMAT_MIME,
  MEDIA_MAX_INPUT_PIXELS,
  MEDIA_REENCODE_SOURCES,
  renditionWidths,
  type AdapterDescriptor,
  type MediaFormat,
  type MediaPort,
  type MediaProbe,
  type MediaReencodeRequest,
  type MediaRendition,
  type PortHealth,
} from "@infrabyx/contracts/ports";
import type SharpType from "sharp";
import type { Sharp as SharpPipeline } from "sharp";
import { probeHeader } from "./probe.js";

export const SHARP_MEDIA_ADAPTER = "sharp";

type Sharp = typeof SharpType;

export interface SharpMediaOptions {
  /** Output quality per format (defaults: AVIF 50, WebP 75, JPEG 80). */
  quality?: Partial<Record<"avif" | "webp" | "jpeg", number>>;
  /**
   * The `sharp` module's default export, for products that bundle it themselves (typed loosely so
   * this package's declarations do not need `sharp` installed).
   */
  sharp?: unknown;
}

const fail = (code: "IPB-SEC-013" | "IPB-SEC-014", detail: string) =>
  new PortError(code, "MEDIA", { adapter: SHARP_MEDIA_ADAPTER, detail });

/** libvips errors as the port's typed errors. */
function mapError(e: unknown): never {
  if (e instanceof PortError) throw e;
  const msg = e instanceof Error ? e.message : String(e);
  if (/pixel limit/i.test(msg)) throw fail("IPB-SEC-013", "the image exceeds the pixel limit");
  throw fail("IPB-SEC-014", "the image could not be decoded");
}

const SVG_ACTIVE =
  /<!DOCTYPE|<!ENTITY|<script|<foreignObject|\bon[a-z]+\s*=|(?:xlink:)?href\s*=\s*["'](?!#)/i;

export class SharpMedia implements MediaPort {
  readonly descriptor: AdapterDescriptor = {
    port: "MEDIA",
    adapter: SHARP_MEDIA_ADAPTER,
    residency: "IN",
    maxDataClass: "INTERNAL",
  };
  private loaded: Promise<Sharp> | undefined;

  constructor(private readonly o: SharpMediaOptions = {}) {}

  private lib(): Promise<Sharp> {
    if (this.o.sharp) return Promise.resolve(this.o.sharp as Sharp);
    this.loaded ??= import("sharp").then(
      (m) => {
        const s = (m as { default: Sharp }).default;
        s.cache(false);
        return s;
      },
      () => {
        this.loaded = undefined;
        throw new PortError("IPB-PORT-001", "MEDIA", {
          adapter: SHARP_MEDIA_ADAPTER,
          detail: "sharp is not installed; add it to the product to enable re-encoding",
          meta: { reason: "not_installed" },
        });
      },
    );
    return this.loaded;
  }

  async health(): Promise<PortHealth> {
    const t = Date.now();
    try {
      await this.lib();
      return { status: "up", latency_ms: Date.now() - t, checked_at: new Date().toISOString() };
    } catch {
      return { status: "down", latency_ms: Date.now() - t, checked_at: new Date().toISOString() };
    }
  }

  private checked(bytes: Uint8Array, mime: string): MediaProbe {
    const h = probeHeader(bytes, mime, SHARP_MEDIA_ADAPTER);
    if (h.width * h.height > MEDIA_MAX_INPUT_PIXELS)
      throw fail("IPB-SEC-013", "the image exceeds the pixel limit");
    return h;
  }

  async probe(bytes: Uint8Array, mime: string): Promise<MediaProbe> {
    const h = this.checked(bytes, mime);
    const s = await this.lib();
    const m = await s(bytes, { limitInputPixels: MEDIA_MAX_INPUT_PIXELS, failOn: "error" })
      .metadata()
      .catch(mapError);
    if (m.format !== (h.format === "avif" ? "heif" : h.format) && m.format !== h.format)
      throw fail("IPB-SEC-014", `the file is ${m.format}, not ${mime}`);
    return { format: h.format, width: m.width ?? h.width, height: m.height ?? h.height };
  }

  async reencode(req: MediaReencodeRequest): Promise<MediaRendition[]> {
    if (!(MEDIA_REENCODE_SOURCES as readonly string[]).includes(req.mime))
      throw fail("IPB-SEC-014", `${req.mime} is not re-encoded`);
    const h = this.checked(req.bytes, req.mime);
    const s = await this.lib();
    const meta = await s(req.bytes, { limitInputPixels: MEDIA_MAX_INPUT_PIXELS, failOn: "error" })
      .metadata()
      .catch(mapError);
    // EXIF orientations 5–8 swap the displayed width and height.
    const turned = (meta.orientation ?? 1) >= 5;
    const W = turned ? h.height : h.width;
    const H = turned ? h.width : h.height;
    const crop = req.aspect ? cropBox(W, H, req.aspect, req.focal) : null;
    const q = { avif: 50, webp: 75, jpeg: 80, ...this.o.quality };
    const out: MediaRendition[] = [];
    for (const format of req.formats)
      for (const width of renditionWidths(crop?.width ?? W, req.widths)) {
        let p = s(req.bytes, {
          limitInputPixels: MEDIA_MAX_INPUT_PIXELS,
          failOn: "error",
        }).rotate();
        if (crop) p = p.extract(crop);
        p = p.resize({ width, withoutEnlargement: true });
        p = toFormat(p, format, q);
        const r = await p.toBuffer({ resolveWithObject: true }).catch(mapError);
        out.push({
          format,
          mime: MEDIA_FORMAT_MIME[format],
          width: r.info.width,
          height: r.info.height,
          bytes: new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength),
        });
      }
    return out;
  }

  async rasteriseSvg(svg: string, sizes: readonly number[]): Promise<MediaRendition[]> {
    if (SVG_ACTIVE.test(svg))
      throw new PortError("IPB-SEC-012", "MEDIA", {
        adapter: SHARP_MEDIA_ADAPTER,
        detail: "only the brand sanitiser's SVG output is rasterised",
      });
    if (!sizes.length || sizes.some((n) => !Number.isInteger(n) || n < 16 || n > 1024))
      throw fail("IPB-SEC-013", "favicon sizes are 16 to 1024 pixels");
    const s = await this.lib();
    const input = Buffer.from(svg, "utf8");
    const m = await s(input, { limitInputPixels: MEDIA_MAX_INPUT_PIXELS })
      .metadata()
      .catch(mapError);
    if (m.format !== "svg") throw fail("IPB-SEC-014", "not an SVG");
    const longest = Math.max(m.width ?? 1, m.height ?? 1);
    const out: MediaRendition[] = [];
    for (const size of sizes) {
      // Render at the target size (72 dpi is 1 px per SVG unit), capped by libvips' own limit.
      const density = Math.min(2400, Math.max(1, (72 * size) / longest));
      const r = await s(input, { density, limitInputPixels: MEDIA_MAX_INPUT_PIXELS })
        .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png({ compressionLevel: 9 })
        .toBuffer({ resolveWithObject: true })
        .catch(mapError);
      out.push({
        format: "png",
        mime: "image/png",
        width: r.info.width,
        height: r.info.height,
        bytes: new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength),
      });
    }
    return out;
  }
}

/** The largest box of `aspect` (width / height) inside W×H, centred on the focal point. */
export function cropBox(
  W: number,
  H: number,
  aspect: number,
  focal: { x: number; y: number } = { x: 0.5, y: 0.5 },
): { left: number; top: number; width: number; height: number } {
  const width = Math.min(W, Math.round(H * aspect));
  const height = Math.min(H, Math.round(width / aspect));
  const clamp = (v: number, max: number) => Math.max(0, Math.min(max, Math.round(v)));
  return {
    left: clamp(focal.x * W - width / 2, W - width),
    top: clamp(focal.y * H - height / 2, H - height),
    width,
    height,
  };
}

function toFormat(
  p: SharpPipeline,
  format: MediaFormat,
  q: { avif: number; webp: number; jpeg: number },
): SharpPipeline {
  switch (format) {
    case "avif":
      return p.avif({ quality: q.avif, effort: 4 });
    case "webp":
      return p.webp({ quality: q.webp });
    case "jpeg":
      return p.jpeg({ quality: q.jpeg, mozjpeg: true });
    case "png":
      return p.png({ compressionLevel: 9 });
  }
}
