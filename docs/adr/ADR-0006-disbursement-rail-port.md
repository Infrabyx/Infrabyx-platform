# ADR-0006 — Register the DISBURSEMENT_RAIL product port (collection half)

- **Status:** Accepted — Finbyx PR-FBX-34 (1) and (2), accepted as R1-plan M51 (R1-D-74); interfaces and fakes only
- **Date:** 2026-11-04
- **Deciders:** owner (`@infrabyx/platform-owners`)
- **IPB sections:** IPB-01 §01.4.4.0 (port registration), §01.4.4.3 (product-specific port `DISBURSEMENT_RAIL`), §01.4.4.2 (PAYMENTS `reconcile`), IPB-01-14, IPB-01-15, IPB-02-10; R1-D-52, R1-D-66, R1-D-80

## Context

Finbyx Phase 10 (collections) needs to present debits against registered NACH and UPI AutoPay mandates through the regulated entity's sponsor bank, read the bank's response file with NPCI return codes, and reconcile three ways (bank statement lines, gateway or NPCI settlement lines, and its own ledger) within 24 hours of the file. `@infrabyx/contracts` 1.17.0 has no port for presentation or statement lines, so Finbyx keeps product-local ports of the same shape, fakes only, and refuses them above staging (PR-FBX-34). IPB-01 §01.4.4.3 already names `DISBURSEMENT_RAIL` as an FBX-owned product port: disbursement and collection rails (FBX, and UDF through the RE's accounts); reference a bank API (IMPS, NEFT, UPI) through the RE's sponsor bank; alternatives the PAYOUTS adapters and a NACH or e-mandate processor; `IN`. The mandate lifecycle stays on PAYMENTS (`MandateLifecycle`, R1-D-52; owner answer #100: no separate mandate port). §01.4.4.0 asks every new port for an interface, a contract suite, a reference adapter and two alternatives (one may be an in-memory fake with the same guarantees), a catalogue row, config keys and an ADR. This is that ADR.

## Decision

Register `DISBURSEMENT_RAIL` in the platform with its collection half now; the disbursement half (PAYOUTS-shaped) is added later as optional methods, so this is not breaking then:

| §01.4.4.0 item         | DISBURSEMENT_RAIL                                                                                                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interface              | `DisbursementRailPort` (`CollectionRail`: `presentDebitBatch`, `readPresentationResponse`, `statementLines`; with `lookup`) in `packages/contracts/src/ports/disbursement-rail.ts` |
| Contract suite         | `disbursementRailContractCases` in `packages/testing/src/ports/collections.ts`                                                                                                     |
| Catalogue row          | `DISBURSEMENT_RAIL`, tier 1 (money, as PAYMENTS and PAYOUTS), `int.disbursement_rail.`, owner FBX v1.6                                                                             |
| Reference adapter      | The sponsor bank's file or API interface: waits until a tenant names its sponsor bank and the owner gives the word (locked list: money movement)                                   |
| Alternatives           | A NACH or e-mandate processor (same wait); `FakeDisbursementRail` as the in-memory alternative meanwhile                                                                           |
| Config keys            | none yet: `int.disbursement_rail.*` keys (off by default) are registered with the first adapter                                                                                    |
| Residency / data class | `IN`, REGULATED                                                                                                                                                                    |

The rules every adapter must keep are in the interface and proven by the contract cases. Each debit item is a money call: `assertDebitBatch` runs `assertMoneyCall` on every item (an approved maker-checker reference, a user or service initiator, never an agent, an idempotency key), checks integer paise and refuses a key or item reference repeated in the batch; any failure refuses the whole batch and nothing is presented. A key is presented at most once: the same item again is a replay of its first presentation; another item under the key is `IPB-PORT-004`. "submitted" is never final; only the response file makes an item paid or returned. Return codes are classed through one table, `NPCI_RETURN_CODES` (`re_presentable` or `final`; a code not in the table is `final` with `codeKnown: false`), kept small and marked `[VERIFY]` against the sponsor bank's file specification. A response file naming an item that was not presented, with another amount, or contradicting a result already read is refused. Statement lines are the collection account's lines within an inclusive date range, in integer paise, with a direction.

On PAYMENTS, `ReconcileReport` gains optional `settlementLines` (`SettlementLine`: settlement id, source gateway or NPCI, UTR, gross, fees, tax, optional signed adjustments and net, all integer paise, with net balancing exactly, and the settlement date). It is optional, so the existing adapters stay valid; `settlementLineContractCases` and `FakeSettlements` prove the shape.

The port's name in code is `DISBURSEMENT_RAIL` in `descriptor.port`. Debit approvals are checked by the product's maker-checker before the call, as for every money-moving port call; an approvals-engine consumption of each debit approval (as R1-D-66 does for mandates) is not built and would be an owner decision.

## Verification

`contracts` and `testing` unit tests: the catalogue lists `DISBURSEMENT_RAIL` under `R1_PORTS` with its interface defined; the contract suite runs green against the fake for NACH and for UPI AutoPay (replay, duplicate and reused keys, a missing approval, an agent, non-integer paise, response mapping, statement ranges); the settlement-line cases run green against `FakeSettlements`; `ipb-check`. No connector folder exists, so the port has no `port-contract` leg; one is added with the first adapter.

## Consequences

- Finbyx replaces its product-local collection ports with these interfaces and the fakes below staging, and keeps refusing above staging (`IPB-PORT-001`) until an adapter lands.
- IPB-01-15 (a reference and two alternatives, one kept green in CI) is met only once the sponsor-bank adapter exists. Building it needs a sponsor bank, its file specification and live credentials, which are the owner's (CLAUDE.md stop list).
- The first adapter brings its `int.disbursement_rail.*` keys, a `PORT_EXIT` entry (lock-in residue: mandates are registered through one sponsor bank), a `port-contract` leg, the bank's own return codes in its mapping, and the `[VERIFY]` check of the shared table.
