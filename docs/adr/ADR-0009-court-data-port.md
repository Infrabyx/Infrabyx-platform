# ADR-0009 — Register the COURT_DATA port

- **Status:** Accepted — Finbyx PR-FBX-42, accepted into wave 10 (5 Nov 2026; R1-D-104); interface, fake and contract cases only
- **Date:** 2026-11-05
- **Deciders:** owner (`@infrabyx/platform-owners`)
- **IPB sections:** IPB-01 §01.4.4.0 (port registration), IPB-01-14, IPB-01-15, IPB-02-10 (agents are makers only), IPB-02-19 (data classes); ADR-0007 for the pattern

## Context

Finbyx's litigation desk tracks cases a lender is party to: their status and next hearing by CNR, their hearings and orders, and each day's cause lists, to match listed cases (Ecosystem Spec 6.10 `HearingScheduled`, `OrderRecorded`). IPB-01 has no such port, so Finbyx keeps a product-local `CourtDataPort` with a fake and manual entry (PR-FBX-42). This ADR registers the port.

## Decision

| §01.4.4.0 item         | COURT_DATA                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Interface              | `CourtDataPort` (`lookupCase`, `hearings`, `orders`, `fetchOrder`, `causeList`) in `packages/contracts/src/ports/court-data.ts`      |
| Contract suite         | `courtDataContractCases` in `packages/testing/src/ports/court-data.ts`                                                               |
| Catalogue row          | `COURT_DATA`, tier 3, `int.court_data.`, owner ADR-0009 (Finbyx PR-FBX-42)                                                           |
| Reference adapter      | eCourts services or a court-data aggregator: waits for the owner's choice of source (an external account, possibly a recurring cost) |
| Alternatives           | A second source (same wait); `FakeCourtData` as the in-memory alternative meanwhile; manual entry in the product                     |
| Config keys            | none yet: `int.court_data.*` keys come with the first adapter                                                                        |
| Residency / data class | `IN`, CONFIDENTIAL (party names in titles; order documents)                                                                          |

The rules every adapter keeps: it only reads; every result names its source and the time it was read, and is what the source said then, not a verified record (a product verifies an order before it acts on it or emits `OrderRecorded`); a case is found by its 16-character CNR or by court, type, number and year, and one the source does not know is `IPB-PORT-005`; an order's document is stored in the tenant's STORAGE under the request's output prefix with its SHA-256, once.

## Verification

`contracts` unit tests: the catalogue lists `COURT_DATA` under `R1_PORTS` with its interface defined. `testing`: the contract suite runs green against the fake. No connector folder exists, so the port has no `port-contract` leg; one is added with the first adapter.

## Consequences

- Finbyx replaces its product-local `CourtDataPort` with this interface and `FakeCourtData`, and keeps manual entry until an adapter lands.
- LawDocs can use the same port for its court tracking when it adopts it.
- The first adapter brings its keys, a `PORT_EXIT` entry, a `port-contract` leg and its terms-of-use review.
