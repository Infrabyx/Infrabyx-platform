# ADR-0008 — Register the DISPATCH port

- **Status:** Accepted — Finbyx PR-FBX-41, accepted into wave 10 (5 Nov 2026; R1-D-104); interface, fake and contract cases only
- **Date:** 2026-11-05
- **Deciders:** owner (`@infrabyx/platform-owners`)
- **IPB sections:** IPB-01 §01.4.4.0 (port registration), IPB-01-14, IPB-01-15, IPB-02-10 (agents are makers only), IPB-02-19 (data classes); ADR-0007 for the pattern

## Context

Finbyx's recovery desk must send notices (demand notices, SARFAESI s.13(2) notices, arbitration notices) by post and keep the proof: India Post Speed Post with its booking receipt and proof of delivery first, then couriers with tracking, print-to-post services and newspaper publication. IPB-01 has no such port, so Finbyx keeps a product-local `DispatchPort` with a fake (PR-FBX-41). This ADR registers the port.

## Decision

| §01.4.4.0 item         | DISPATCH                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Interface              | `DispatchPort` (`dispatch`, `status`, `storeProof`, `cancel`) in `packages/contracts/src/ports/dispatch.ts`                          |
| Contract suite         | `dispatchContractCases` in `packages/testing/src/ports/dispatch.ts`                                                                  |
| Catalogue row          | `DISPATCH`, tier 2, `int.dispatch.`, owner ADR-0008 (Finbyx PR-FBX-41)                                                               |
| Reference adapter      | India Post Speed Post (booking, tracking, proof of delivery): waits for a tenant's choice and the owner's word (an external account) |
| Alternatives           | A courier aggregator or a print-to-post service (same wait); `FakeDispatch` as the in-memory alternative meanwhile                   |
| Config keys            | none yet: `int.dispatch.*` keys (off by default) come with the first adapter                                                         |
| Residency / data class | `IN`, CONFIDENTIAL (the addressee's name and address, the document)                                                                  |

The rules every adapter keeps, proven by the contract cases: a dispatch is made by a person or the product's service on a person's behalf, never by an agent; it is idempotent on its key (another request under the key is `IPB-PORT-004`); the document is named by its STORAGE key and SHA-256 and every proof carries that hash; the booking receipt exists once booked, the proof of delivery once delivered, the proof of return once returned, each stored in the tenant's STORAGE under the request's evidence prefix, and a proof asked for before it exists is `IPB-PORT-003`; delivered, returned, failed and cancelled are final; only an unbooked dispatch is cancelled.
Whether a notice must go by post, to which addresses, and what counts as service are the product's rules (for Finbyx, the statute the notice is under); the port records the purpose of each dispatch so they can be checked.

## Verification

`contracts` unit tests: the catalogue lists `DISPATCH` under `R1_PORTS` with its interface defined. `testing`: the contract suite runs green against the fake. No connector folder exists, so the port has no `port-contract` leg; one is added with the first adapter.

## Consequences

- Finbyx replaces its product-local `DispatchPort` with this interface and `FakeDispatch` below staging, and keeps refusing above staging until an adapter lands.
- IPB-01-15 is met only once a carrier adapter exists; choosing one is the owner's (external account).
- The first adapter brings its `int.dispatch.*` keys, a `PORT_EXIT` entry, a `port-contract` leg and the verification of the carrier's tracking callbacks.
