// `@infrabyx/ui/studio`: the Studio screens every product mounts (OWNER-QUESTIONS #41, PL5-D-05;
// PL5 plan §9.6). Screens read through the package services and post to the app's actions; the
// handlers turn a posted form into a service call and a notice.
export * from "./types.js";
export { encodeResult, decodeResult } from "./flash.js";
export { FieldProblem, run, text, required, json, oneOf, when } from "./form.js";
export {
  STUDIO_SECTIONS,
  studioPath,
  StudioPage,
  StatusBadge,
  StudioSectionBox,
  Hidden,
  errorFor,
  type StudioSection,
} from "./layout.js";
export * from "./content.js";
export * from "./content-handlers.js";
export * from "./brand.js";
export * from "./brand-handlers.js";
export * from "./redirects.js";
export * from "./media.js";
export * from "./claims.js";
export * from "./queues.js";
export * from "./policies.js";
export * from "./consent.js";
export * from "./readonly.js";
export { STUDIO_CSS } from "./styles.js";
