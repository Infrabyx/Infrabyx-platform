# ADR-0013 — Register the GRC port

- **Status:** Accepted — Finbyx PR-FBX-51, accepted by the owner on 19 Nov 2026 (night, item E4 of E1 to E8); planned and built in R1-D-220; no vendor or counterparty chosen
- **Date:** 2026-11-20
- **Deciders:** owner (`@infrabyx/platform-owners`)
- **IPB sections:** IPB-01 §01.4.4.0 (port registration), §01.4.4.1 (common conventions), §01.4.13 (exit), IPB-01-15, IPB-01-16, IPB-02-19 (data classes), IPB-02-43 (egress); Ecosystem Specification §6.15 (events), §9.1 (compliance modes), §9.2 (generic GRC connector contract), §9.4 (OSCAL); ADR-0010 and ADR-0012 for the pattern

## Context

Finbyx Phase 14 reports to a GRC system of record: LawDocsComply (`LDC_EXTERNAL`, `LDC_GROUP`), its own embedded module (`EMBEDDED`), or a regulated entity's own tool (`THIRD_PARTY_GRC`) (§9.1). The Ecosystem Specification fixes one generic contract for all of them (§9.2: REST with JSON Schema 2020-12, cursor pagination, an `Idempotency-Key` on every POST; references, hashes, aggregate counts and masked sample ids, never raw personal data) and the events that carry the data (§6.15). IPB-01 has no port for it, so each product would build its own client, and only two of the §6.15 events (`EvidenceSubmitted`, `ObligationPublished`) had published schemas.

## Decision

| §01.4.4.0 item         | GRC                                                                                                                                                                                                            |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interface              | `GrcPort` (`listObligations`, `publishControlTestResult`, `submitEvidence`, `raiseIssue`, `notifyIncident`, `updateReturnStatus`, `recordPolicyAttestation`) in `packages/contracts/src/ports/grc.ts`          |
| Event schemas          | `ControlTestResultPublished`, `ComplianceIssueRaised`, `ReturnStatusUpdated`, `PolicyAttested`, `SecurityIncidentNotified` (v1) in `packages/contracts/src/events/grc-events.ts`; `GRC_EVENTS` lists all seven |
| Contract suite         | `grcContractCases` in `packages/testing/src/ports/grc.ts`                                                                                                                                                      |
| Catalogue row          | `GRC`, tier 2, `int.grc.`, owner ADR-0013 (Finbyx PR-FBX-51); the request to add it to IPB-01 §01.4.4.3 is platform request PR-048                                                                             |
| Reference adapter      | `generic-grc`: the §9.2 contract over HTTPS to one configured counterparty; shapes §9.2 does not fix are stub-shaped (`[VERIFY]`); off and unproven                                                            |
| Alternatives           | `FakeGrc` (`@infrabyx/fakes`), the CI-green alternative                                                                                                                                                        |
| Config keys            | `int.grc.generic.enabled` (false), `int.grc.generic.host` (empty); the token in SECRETS (`secrets/<env>/grc/generic/token`)                                                                                    |
| Residency / data class | `IN`, at most CONFIDENTIAL (the port default); no personal data                                                                                                                                                |

The rules every adapter keeps: a call class above CONFIDENTIAL, or below the port default, is refused `IPB-PORT-003` `data_class`; a body holding an Aadhaar-like number (`findAadhaarLike`) or a PAN anywhere, unknown fields included, is refused `IPB-PORT-003` `personal_data` before anything is sent; every body is the §6.15 event's v1 data; every POST is keyed (the caller's `idempotencyKey`, else the event's own Specification key), the same key and body answering the same receipt with one record and the key with another body refused `IPB-PORT-004`; an incident update at or below one already taken is refused `out_of_order`; obligations come in pages by an opaque cursor bound to its query, cut to the §9.2 fields (never the text). The platform keeps no state for the port (no migration): the GRC system is the system of record and the product keeps its own evidence. No new cryptography. OSCAL export (§9.4) is not built.

## Verification

`contracts` unit tests (event schemas, port checks, catalogue); the contract suite on the fake (`testing`) and on `generic-grc` against a §9.2 stub and on the fake in the `port-contract` leg (`pnpm --filter @infrabyx/connectors test:contract -- --port GRC`); `PORT_EXIT` and the exit runbook (`generic-grc` → `fake-grc`).

## Consequences

- Finbyx replaces its product-local shim with this port and the event schemas; LawDocsComply's native connector (§9.3) can be certified against the same contract cases.
- When the first counterparty's sandbox exists, the generic adapter's stub-shaped paths, answers and authentication (§9.2's mTLS-bound client credentials) are confirmed or corrected, its sandbox leg and `sandbox-status.json` entry are added, and its flag can be turned on per environment.
- A third-party GRC adapter (§9.4 mapping packs) is another adapter of this port, built when a regulated entity needs it.
