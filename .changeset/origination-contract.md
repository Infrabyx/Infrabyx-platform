---
"@infrabyx/contracts": minor
"@infrabyx/crypto": minor
"@infrabyx/fakes": minor
"@infrabyx/testing": minor
---

The origination contract of Ecosystem Specification §6.2 and §6.3 and a mock lender (Udofin PR-UDF-051; R1-D-217). `contracts/events`: `EligibilityCheckRequest` and `EligibilityCheckAnswer` for the synchronous `POST /v1/eligibility-checks` (3 s budget, `lender_unavailable` past it), the v1 data schemas of `ApplicationSubmitted`, `ApplicationStatusChanged`, `AdditionalInfoRequested`, `DecisionMade`, `KFSIssued`, `SanctionLetterIssued`, `BorrowerAccepted`, `CoolingOffExitRequested` and `LoanDisbursed`, `ORIGINATION_EVENTS` (type, schema, idempotency fields, direction, regulated), `ORIGINATION_REGULATED` and `originationIdempotencyKey`. `crypto`: `localRegulatedSigner(kid)`, an ES256 signer on an in-memory key for tests and fakes only. `fakes`: `FakeLender`, which answers the calls, emits the journey's envelopes and signs the regulated ones (`keys` to verify), with `script` and `outbox` hooks. `testing`: `lenderContractCases()` and `lspEvent()`. Nothing existing changes.
