// PNG favicons rasterised from a sanitised SVG through the MEDIA port (OWNER-QUESTIONS #53), shared
// by Brand Studio and the tenant brand layer.
import type { KernelContext } from "@infrabyx/contracts/kernel";
import type { MediaPort } from "@infrabyx/contracts/ports";
import { FAVICON_PNG_SIZES } from "@infrabyx/contracts/ports";

export interface RasteriseOptions {
  media?: MediaPort;
  /** `cms.media.reencode_enabled` (default on, #53); off keeps PNGs to an uploaded master. */
  reencodeEnabled?: (ctx: KernelContext) => Promise<boolean>;
}

/** The favicon PNG sizes of `svg`, or none without a capable MEDIA port or with re-encoding off. */
export async function rasteriseFavicons(
  o: RasteriseOptions,
  ctx: KernelContext,
  svg: string,
): Promise<{ size: number; bytes: Uint8Array }[]> {
  const m = o.media;
  if (!m || m.descriptor.capabilities?.rasteriseSvg === "unsupported") return [];
  if (o.reencodeEnabled && !(await o.reencodeEnabled(ctx))) return [];
  try {
    return (await m.rasteriseSvg(svg, FAVICON_PNG_SIZES)).map((r) => ({
      size: r.width,
      bytes: r.bytes,
    }));
  } catch (e) {
    // Best effort: the logo is kept and the favicon set lists the PNGs as missing (IPB-04-22).
    if (/^IPB-(?:PORT|SEC)-/.test((e as { code?: string }).code ?? "")) return [];
    throw e;
  }
}
