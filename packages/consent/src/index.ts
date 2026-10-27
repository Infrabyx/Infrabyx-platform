// @infrabyx/consent — the CMP, consent texts, the consent and acceptance ledgers, script gating and
// the consent purge (IPB-04 §04.3.9; IPB-05 template 18; PL5 plan §6).
export const PACKAGE_NAME = "@infrabyx/consent" as const;
export * from "./texts.js";
export * from "./ledger.js";
export * from "./cmp.js";
export * from "./components.js";
export * from "./controller.js";
export * from "./acceptance.js";
export * from "./purge.js";
export * from "./subjects.js";
