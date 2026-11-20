// ESTAMP adapters (owner answer #100, R1-D-62; Udofin PR-UDF-054, R1-D-245): `nesl-dde`, NeSL
// Digital Document Execution only; and the recording adapters `shcil-estamp`, `digio-estamp` and
// `manual-paper`, which record a stamp the RE already bought through its own channel and never buy
// one. All off and `unproven` until their owner's accounts (or, for paper, evidence rules) exist.
// No stamp-duty purchase adapter is approved.
export * from "./nesl-dde.js";
export * from "./record.js";
export * from "./manual-paper.js";
export * from "./shcil.js";
export * from "./digio-estamp.js";
