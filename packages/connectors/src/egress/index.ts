// EGRESS adapters (IPB-01 EGRESS; IPB-04 §04.4.4; PR-LDC-40, R1-D-176): `governed`, the in-process
// SSRF guard (the reference: IPB-01's internal egress proxy with an allow-list), off behind
// `int.egress.governed.enabled`. The IPB-01 alternative (cloud NAT with egress rules) is the
// deployment's network layer, not an adapter.
export * from "./governed.js";
