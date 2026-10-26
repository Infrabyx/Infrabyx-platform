// @infrabyx/seed — deterministic, idempotent, synthetic-only seeds with purge and seed credentials
// (IPB-11 §11.3.D–E, §11.4.5–11.4.8; IPB-D-04).
export const PACKAGE_NAME = "@infrabyx/seed" as const;
export * from "./guard.js";
export * from "./framework.js";
export * from "./synthetic.js";
export * from "./personas/index.js";
export * from "./platform.js";
export * from "./purge.js";
export * from "./credentials.js";
