// MEDIA alternative adapter `passthrough` (OWNER-QUESTIONS #53, PL5-D-11): no image library, so
// nothing is re-encoded or rasterised and uploads are served as uploaded (the #43 behaviour). It
// probes headers only. This is the adapter in every environment where `sharp` is not installed or
// `cms.media.reencode_enabled` is off.
import { PortError } from "@infrabyx/contracts/errors";
import type {
  AdapterDescriptor,
  MediaPort,
  MediaProbe,
  MediaRendition,
  PortHealth,
} from "@infrabyx/contracts/ports";
import { probeHeader } from "./probe.js";

export const PASSTHROUGH_MEDIA_ADAPTER = "passthrough";

const unsupported = (method: string) =>
  new PortError("IPB-PORT-001", "MEDIA", {
    adapter: PASSTHROUGH_MEDIA_ADAPTER,
    detail: `${method} needs an image library; uploads are served as uploaded`,
    meta: { reason: "unsupported" },
  });

export class PassthroughMedia implements MediaPort {
  readonly descriptor: AdapterDescriptor = {
    port: "MEDIA",
    adapter: PASSTHROUGH_MEDIA_ADAPTER,
    residency: "IN",
    maxDataClass: "INTERNAL",
    capabilities: { reencode: "unsupported", rasteriseSvg: "unsupported" },
  };

  async health(): Promise<PortHealth> {
    return { status: "up", latency_ms: 0, checked_at: new Date().toISOString() };
  }

  async probe(bytes: Uint8Array, mime: string): Promise<MediaProbe> {
    return probeHeader(bytes, mime, PASSTHROUGH_MEDIA_ADAPTER);
  }

  reencode(): Promise<MediaRendition[]> {
    return Promise.reject(unsupported("reencode"));
  }

  rasteriseSvg(): Promise<MediaRendition[]> {
    return Promise.reject(unsupported("rasteriseSvg"));
  }
}
