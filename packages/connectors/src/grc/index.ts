// GRC adapters (Finbyx PR-FBX-51, R1-D-220, ADR-0013): `generic-grc`, the Ecosystem Spec §9.2
// generic connector contract to one configured counterparty (stub-shaped [VERIFY] where §9.2 is
// silent), off (`int.grc.generic.enabled`) and unproven until a counterparty sandbox exists. The
// fake `FakeGrc` (@infrabyx/fakes) is the CI-green alternative. No migration: the GRC system is the
// system of record, and the product keeps its own evidence.
export * from "./generic.js";
