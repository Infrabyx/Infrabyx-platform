// ESIGN adapters (PL3 plan §8, PL3-D-04): `leegality` (interim reference, C-25 webhook check) and
// `digio` (alternative), both test mode and `unproven` until their sandbox legs run; `nsdl-esign`
// (PR-UDF-054, R1-D-245), an off and `unproven` shell whose ASP request signing is refused until
// the owner approves it (OWNER-QUESTIONS #177).
export * from "./common.js";
export * from "./leegality.js";
export * from "./digio.js";
export * from "./nsdl.js";
