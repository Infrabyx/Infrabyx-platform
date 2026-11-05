# ADR-0010 — Register the ODR port

- **Status:** Accepted — Finbyx PR-FBX-44, accepted into wave 10 (5 Nov 2026; R1-D-104); interface, fake and contract cases only
- **Date:** 2026-11-05
- **Deciders:** owner (`@infrabyx/platform-owners`)
- **IPB sections:** IPB-01 §01.4.4.0 (port registration), IPB-01-14, IPB-01-15, IPB-02-10 (agents are makers only), IPB-02-19 (data classes); ADR-0007 for the pattern

## Context

The Ecosystem Specification names `ODR` among the product ports and `OdrProvider` as the provider-neutral adapter behind it (Part 8.9): an RE refers a dispute to Equator Resolution or another institution through API, webhook, file or portal-manual modes. IPB-01 has no interface for it yet, so Finbyx keeps a product-local `OdrProvider` with an Equator stub and a CSV fallback (PR-FBX-44). This ADR registers the port under the Specification's name.

## Decision

| §01.4.4.0 item         | ODR                                                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Interface              | `OdrPort` (`disclosure`, `modes`, `refer`, `status`, `withdraw`, `outcome`) in `packages/contracts/src/ports/odr.ts` |
| Contract suite         | `odrContractCases` in `packages/testing/src/ports/odr.ts`                                                            |
| Catalogue row          | `ODR`, tier 2, `int.odr.`, owner ADR-0010 (Finbyx PR-FBX-44; Ecosystem Spec 8.9)                                     |
| Reference adapter      | Equator Resolution's API (a group company; no external account): waits for Equator's API to be published             |
| Alternatives           | Another institution's file or portal-manual adapter; `FakeOdr` and `equatorOdrStub()` meanwhile                      |
| Config keys            | none yet: `int.odr.*` keys come with the first adapter                                                               |
| Residency / data class | `IN`, CONFIDENTIAL (parties, the claim, the case file)                                                               |

The rules every adapter keeps: provider-neutral (Spec 6.9, 8.1): the request says who chose the provider (`party` or `parties_under_clause`), never a default; a referral carries its basis (the agreement's clause naming the institution, or written post-dispute consent, by reference) and at least a claimant and a respondent; a provider with a disclosure refuses a referral that does not acknowledge that disclosure's version as shown (`IPB-PORT-003`), and Equator's is "Equator Resolution is an Infrabyx group company"; a referral is made by a person or the product's service, never an agent, idempotent on its key; each adapter declares the mode of each capability (API, WEBHOOK, FILE, PORTAL_MANUAL); a settlement or award is stored in the tenant's STORAGE under the referral's output prefix with its SHA-256, and asked for before there is one is `IPB-PORT-003`.
The referral gates of Spec 8.2 (arbitrability, IBC moratorium, consumer complaints, s.12A mediation, service evidence) are the product's and run before `refer`; the port does not re-decide them. The Specification's events (`ADRReferralCreated`, `ADRCaseStatusChanged`, `ADROutcomeRecorded`) are emitted by the product from the port's results.

## Verification

`contracts` unit tests: the catalogue lists `ODR` under `R1_PORTS` with its interface defined. `testing`: the contract suite runs green against the fake. No connector folder exists, so the port has no `port-contract` leg; one is added with the first adapter.

## Consequences

- Finbyx replaces its product-local `OdrProvider` and Equator stub with this interface, `FakeOdr` and `equatorOdrStub()`, and keeps its CSV fallback as a FILE-mode adapter of its own until one lands here.
- LawDocs' provider-neutral `ODR` port (Spec 6.9) is this one.
- The first adapter brings its keys, a `PORT_EXIT` entry, a `port-contract` leg and the webhook verifier for status events.
