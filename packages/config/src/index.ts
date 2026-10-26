// @infrabyx/config — environment loader and guards (IPB-11), settings registry (IPB-07) and
// flags (IPB-09-24, IPB-02-83, IPB-12 §12.5) and provider_routing loading (IPB-01 §01.4.5).
// Subpaths: ./env, ./settings, ./flags, ./events, ./routing.
export const PACKAGE_NAME = "@infrabyx/config" as const;
export * from "./env/index.js";
export * from "./settings/index.js";
export * from "./flags/index.js";
export * from "./events.js";
export * from "./routing/index.js";
