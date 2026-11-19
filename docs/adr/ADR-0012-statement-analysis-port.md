# ADR-0012 — Register the STATEMENT_ANALYSIS port

- **Status:** Accepted — Udofin PR-UDF-048, accepted by the owner on 19 Nov 2026 (after PR-UDF-047); planned in R1-D-201, built in R1-D-202; no vendor chosen (owner question #152)
- **Date:** 2026-11-19
- **Deciders:** owner (`@infrabyx/platform-owners`)
- **IPB sections:** IPB-01 §01.4.4.0 (port registration), §01.4.4.1 (common conventions), §01.4.4.3 (AA_FIU), §01.4.13 (exit), IPB-01-15, IPB-01-16, IPB-01-27, IPB-02-19 (data classes), IPB-02-43 (egress), IPB-10-07 (idempotency window); ADR-0003 and ADR-0010 for the pattern

## Context

Udofin's Phase 6 step 6.6 analyses a borrower's bank statements before a regulated entity's credit decision. The statements arrive as FI data under an Account Aggregator consent (AA_FIU, ADR-0003) or as a statement the borrower uploads, and are already in the tenant's STORAGE. IPB-01 has no port for the analysis, so the product would call an analyser directly. The repository names no statement-analysis vendor, and the owner has said no new recurring vendor now (answer #102).

## Decision

| §01.4.4.0 item         | STATEMENT_ANALYSIS                                                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interface              | `StatementAnalysisPort` (`analyse`, `status`, `handleWebhook`) in `packages/contracts/src/ports/statement-analysis.ts`                                      |
| Contract suite         | `statementAnalysisContractCases` in `packages/testing/src/ports/statement-analysis.ts`                                                                      |
| Catalogue row          | `STATEMENT_ANALYSIS`, tier 2, `int.statement_analysis.`, owner ADR-0012 (Udofin PR-UDF-048); a request to add it to IPB-01 §01.4.4.3 goes to the spec owner |
| Reference adapter      | `platform-statement`: in-platform, no vendor or egress, a checksum-summary report (not a credit analysis) until the owner chooses an analyser               |
| Alternatives           | `http-statement`, a vendor-neutral HTTP client against a stub (`[VERIFY]` every shape); `FakeStatementAnalysis`                                             |
| Config keys            | `int.statement_analysis.platform.enabled`, `int.statement_analysis.http.enabled` (both false), `int.statement_analysis.http.host` (empty)                   |
| Residency / data class | `IN`, REGULATED (the port default, the router's method table and each adapter's own check)                                                                  |

The rules every adapter keeps: inputs and the report are STORAGE references with their SHA-256, never content; an input must be in the REGULATED bucket class and match its SHA-256 before any analyser call; a call class other than REGULATED is refused `IPB-PORT-003`; `analyse` is idempotent on `call.idempotencyKey` (one analyser call per key; the key with another request is `IPB-PORT-004`); the report is written to the REGULATED class under the request's prefix; a notification is verified before it is read, and only the analysis read back with `status` is trusted. No new cryptography: no approved webhook scheme fits an unnamed vendor (C-13 names its vendors; Standard Webhooks waits for #150), so the real adapters refuse `handleWebhook` `unsupported` and the fake uses the approved C-22 profile.

## Verification

`contracts` unit tests (schema, classes, catalogue); the contract suite on the fake (`testing`) and on both adapters in the `port-contract` leg (`pnpm --filter @infrabyx/connectors test:contract -- --port STATEMENT_ANALYSIS`); the PostgreSQL integration test of `connectors/0014`; `PORT_EXIT` and the exit runbook (`platform-statement` → `http-statement`).

## Consequences

- Udofin replaces its product-local analysis call with this port; its analyses stay references in its own records (the platform keeps a record 24 hours).
- When the owner chooses an analyser (#152), its adapter (or the HTTP adapter's confirmed shapes) brings its sandbox leg, its webhook scheme for the crypto registry, its DPA and its India processing statement; the in-platform reference may then become the alternative.
