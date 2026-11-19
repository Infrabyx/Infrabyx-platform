// STATEMENT_ANALYSIS adapters (Udofin PR-UDF-048, R1-D-202, ADR-0012; #152): `platform-statement`,
// the in-platform checksum-summary reference (no vendor, no egress), and `http-statement`, a
// vendor-neutral HTTP alternative built against a stub ([VERIFY] every vendor shape). Both off
// (`int.statement_analysis.platform.enabled`, `int.statement_analysis.http.enabled`) until the owner
// chooses an analyser; both keep their analyses in `connectors.statement_analysis` (migration 0014).
export * from "./store.js";
export * from "./common.js";
export * from "./platform.js";
export * from "./http.js";
