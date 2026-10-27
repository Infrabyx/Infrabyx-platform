// @infrabyx/rules — the RULES_PORT service (IPB-01 RULES; PL3 plan §4): rule sets as versioned
// decision tables, published through maker-checker at R4, evaluated with a decision log, simulated
// and explained. Engine adapters (`zen`, `json-rules`) are in `@infrabyx/connectors/rules`.
// Migration: `rules/0001_init.sql`, applied by `infrabyx-migrate` when this package is installed.
export const PACKAGE_NAME = "@infrabyx/rules" as const;
export * from "./service.js";
