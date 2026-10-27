// @infrabyx/brand (IPB-04 §04.3.2; Ecosystem §5.4): brand packs, Brand Studio with maker-checker
// publish and rollback, the contrast guard, the SVG sanitiser, the favicon set, the host map and
// display-name terminology.
export const PACKAGE_NAME = "@infrabyx/brand" as const;

export * from "./shape.js";
export * from "./contrast.js";
export * from "./svg.js";
export * from "./favicon.js";
export * from "./hosts.js";
export * from "./terminology.js";
export * from "./studio.js";
