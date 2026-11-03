# ADR-0003 — Register the BUREAU and AA_FIU product ports

- **Status:** Accepted — owner's order of 2 Nov 2026 (Finbyx PR-FBX-28); confirmation requested as OWNER-QUESTIONS #97
- **Date:** 2026-11-02
- **Deciders:** owner (`@infrabyx/platform-owners`)
- **IPB sections:** IPB-01 §01.4.4.0 (port registration), §01.4.4.3 (product-specific ports `BUREAU`, `AA_FIU`), IPB-01-14, IPB-01-15, IPB-01-19; R1-D-43

## Context

Finbyx Phase 7 (loan origination) needs credit-bureau pulls and Account Aggregator data. `@infrabyx/contracts` 1.12.0 has no port for either, so Finbyx keeps shim ports in `los/ports.ts` and refuses them above staging (PR-FBX-28). IPB-01 §01.4.4.3 already names both as FBX-owned product ports: `BUREAU` (credit-bureau pulls and submissions, only by the regulated entity under CICRA; reference CIBIL, alternatives Experian, Equifax and CRIF High Mark; `IN`) and `AA_FIU` (Account Aggregator FIU consent and data fetch; reference a Sahamati-certified AA client through a technology service provider, alternatives a second TSP or a direct AA API; `IN`). §01.4.4.0 asks every new port for an interface in `packages/contracts/ports`, a contract suite in `packages/testing/ports`, a reference adapter and two alternatives (one may be an in-memory or self-hosted fake with the same guarantees), a catalogue row, config keys registered in `packages/config`, and an ADR. This is that ADR.

## Decision

Register `BUREAU` and `AA_FIU` in the platform, so every product that is a regulated entity uses one shape:

| §01.4.4.0 item         | BUREAU                                                                                                                       | AA_FIU                                                                                                      |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Interface              | `CreditBureauPort` in `packages/contracts/src/ports/credit-bureau.ts`                                                        | `AccountAggregatorPort` in `packages/contracts/src/ports/account-aggregator.ts`                             |
| Contract suite         | `creditBureauContractCases` in `packages/testing/src/ports/bureau-aa.ts`                                                     | `accountAggregatorContractCases` in the same file                                                           |
| Catalogue row          | `BUREAU`, tier 2, `int.bureau.`, owner FBX v1.6                                                                              | `AA_FIU`, tier 2, `int.aa_fiu.`, owner FBX v1.6                                                             |
| Reference adapter      | CIBIL (TransUnion): waits for the owner's sandbox documents and account                                                      | A Sahamati-certified AA client through a TSP: waits for the owner's sandbox documents and account           |
| Alternatives           | Experian, Equifax, CRIF High Mark (same wait); `FakeCreditBureau` as the in-memory alternative meanwhile                     | A second TSP or a direct AA API (same wait); `FakeAccountAggregator` as the in-memory alternative meanwhile |
| Config keys            | none yet: as for KYC, `int.bureau.*` keys (`int.bureau.<cic>.enabled`, off by default) are registered with the first adapter | none yet: `int.aa_fiu.*` keys are registered with the first adapter                                         |
| Residency / data class | `IN`, REGULATED                                                                                                              | `IN`, REGULATED                                                                                             |

The rules every adapter must keep are in the interfaces and proven by the contract cases: a pull or a consent request needs the product's consent receipt (`PurposeConsents`, PR-FBX-26); the subject is named by the product's reference and identifiers travel in a REGULATED schema; reports and FI payloads go to the tenant's STORAGE by reference with their SHA-256, with the CIC's format version or the ReBIT schema version; an AA fetch runs only under an ACTIVE, unexpired consent within its data range and FI types; webhooks are read back from the vendor and never trusted as sent. The ports' names in code are `BUREAU` and `AA_FIU` in `descriptor.port`; the TypeScript types keep descriptive names.

## Verification

`contracts` and `testing` unit tests (the catalogue lists both under `R1_PORTS` with interfaces defined; both contract suites run green against the fakes, including an expired consent and an async report); `ipb-check`. No connector folder exists yet, so neither port has a `port-contract` leg; one is added with the first adapter.

## Consequences

- Finbyx replaces its shim ports with these interfaces and the fakes below staging, and keeps refusing above staging (`IPB-PORT-001`) until an adapter lands.
- IPB-01-15 (a reference and two alternatives, one kept green in CI) is met only once the vendor adapters exist; until then the fakes are the only implementation. Building them needs live credentials, which are the owner's (CLAUDE.md stop list).
- The first adapter brings its `int.bureau.*` or `int.aa_fiu.*` keys, a `PORT_EXIT` entry, a `port-contract` leg and its webhook signature rules (the AA's detached JWS, each CIC's transport).
