// MEDIA adapters (OWNER-QUESTIONS #53, PL5-D-11): `sharp` (reference; libvips through the approved
// licence exception) and `passthrough` (alternative; uploads served as uploaded).
export { SharpMedia, SHARP_MEDIA_ADAPTER, cropBox, type SharpMediaOptions } from "./sharp.js";
export { PassthroughMedia, PASSTHROUGH_MEDIA_ADAPTER } from "./passthrough.js";
export { probeHeader } from "./probe.js";
