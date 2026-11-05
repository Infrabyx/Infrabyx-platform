# ADR-0007 — Register the TELEPHONY port

- **Status:** Accepted — Finbyx PR-FBX-38, accepted into wave 8 by the owner (5 Nov 2026; R1-D-97); interface, fake and contract cases only
- **Date:** 2026-11-05
- **Deciders:** owner (`@infrabyx/platform-owners`)
- **IPB sections:** IPB-01 §01.4.4.0 (port registration), IPB-01-14, IPB-01-15, IPB-02-10 (agents are makers only), IPB-02-19 (data classes); ADR-0004, ADR-0006 for the pattern

## Context

Finbyx's collections desk needs click-to-call from a collector's line to a borrower, the call's outcome, and its recording, kept in the tenant's own storage with a retention and played only after a recording disclosure. IPB-01 has no telephony port, so Finbyx keeps a product-local `TelephonyPort` with a fake only (PR-FBX-38). §01.4.4.0 asks a new port for an interface, a contract suite, a reference adapter and two alternatives (one may be an in-memory fake with the same guarantees), a catalogue row, config keys and an ADR. This is that ADR.

## Decision

| §01.4.4.0 item         | TELEPHONY                                                                                                                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interface              | `TelephonyPort` (`clickToCall`, `callOutcome`, `storeRecording`, `cancel`) in `packages/contracts/src/ports/telephony.ts`                                                                       |
| Contract suite         | `telephonyContractCases` in `packages/testing/src/ports/telephony.ts`                                                                                                                           |
| Catalogue row          | `TELEPHONY`, tier 2, `int.telephony.`, owner ADR-0007 (Finbyx PR-FBX-38)                                                                                                                        |
| Reference adapter      | An Indian cloud-telephony provider with click-to-call, call status webhooks and recording download: waits for a tenant's choice and the owner's word (an external account and a recurring cost) |
| Alternatives           | A second provider (same wait); `FakeTelephony` as the in-memory alternative meanwhile                                                                                                           |
| Config keys            | none yet: `int.telephony.*` keys (off by default) are registered with the first adapter                                                                                                         |
| Residency / data class | `IN`, CONFIDENTIAL (the customer's number and the recording)                                                                                                                                    |

The rules every adapter keeps are in the interface and proven by the contract cases: a call is placed by a person or by the product's service on a person's behalf, never by an agent; a call is idempotent on its key (the same request is the same call, another request under the key is `IPB-PORT-004`); a call is recorded only with a named disclosure (id and version) played before recording starts, and a recording is stored only when the adapter reports the disclosure was played, otherwise nothing is kept (`IPB-PORT-003`); a stored recording goes to the tenant's STORAGE under the request's output prefix with the request's retention and a `deleteAfter`, and the vendor keeps no copy once it is stored; unanswered outcomes (`no_answer`, `busy`, `failed`) are final and carry no recording.

Calling hours, consent to be called and the content of the disclosure are the product's rules (for Finbyx, the RBI's fair-practice rules for recovery calls); the port records the purpose of each call so they can be checked.

## Verification

`contracts` unit tests: the catalogue lists `TELEPHONY` under `R1_PORTS` with its interface defined. `testing`: the contract suite runs green against `FakeTelephony`. No connector folder exists, so the port has no `port-contract` leg; one is added with the first adapter.

## Consequences

- Finbyx replaces its product-local `TelephonyPort` with this interface and `FakeTelephony` below staging, and keeps refusing above staging until an adapter lands.
- IPB-01-15 is met only once a provider adapter exists; choosing one is the owner's (external account, recurring cost).
- The first adapter brings its `int.telephony.*` keys, a `PORT_EXIT` entry, a `port-contract` leg and a webhook verifier for call status events.
