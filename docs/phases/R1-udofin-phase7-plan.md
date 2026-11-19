# R1 plan: Udofin Phase 7, the origination contract and a mock lender (PR-UDF-051)

Owner's order, 19 Nov 2026 night (item E2, after the release of #300 to #312). Decision R1-D-217. Spec of record: Ecosystem Specification §6.2 (origination), §6.3 (servicing: `LoanDisbursed`, `CoolingOffExitRequested`), §3.2 (envelope), §3.6 (regulated messages), Part 10.3 (the 3 s budget). Nothing under `docs/ecosystem/` is edited.

## A. What Udofin asked for

1. The origination schemas of §6.2, with versions: `EligibilityCheck` and its answer, `ApplicationSubmitted`, `ApplicationStatusChanged`, `AdditionalInfoRequested`, `DecisionMade`, `KFSIssued`, `SanctionLetterIssued`, `BorrowerAccepted`, `CoolingOffExitRequested`, `LoanDisbursed`; the regulated-message types among them listed.
2. A contract-faithful mock lender in `@infrabyx/fakes` that answers the calls and signs its events.
3. A decision: is `EligibilityCheck` a synchronous call (Udofin assumes 3 s) or an event pair?

## B. Decision on `EligibilityCheck`: a synchronous call

The Specification itself defines it as an API, `POST /v1/eligibility-checks` (UD → FX), with an `Idempotency-Key`, a budget of at most 3 s and "timeout = lender unavailable" (§6.2; Part 10.3 "`EligibilityCheck` ≤ 3 s"). It is not an event pair. The platform therefore publishes a request schema and an answer schema, with the timeout as a typed outcome (`lender_unavailable`), and no event types for it. Udofin's 3 s assumption matches the Specification. `[ASSUMED – owner review]` (owner question #157), because the Specification marks the row "(E)" (an Ecosystem item) as well as "API".

## C. Contracts (`@infrabyx/contracts/events`, new file `origination.ts`; minor)

Types follow §3.2: `in.infrabyx.origination.<Event>.v1` for the §6.2 events, `in.infrabyx.servicing.<Event>.v1` for `LoanDisbursed` and `CoolingOffExitRequested` (§6.3). Every schema is v1 (`ORIGINATION_SCHEMA_VERSION = "1.0.0"`, the envelope's `schemaver`). The field names are the Specification's "key payload fields" in snake case. Unknown fields pass through, as for the other Ecosystem schemas, and are checked against the registry when it publishes them `[VERIFY]`.

Conventions: money in integer paise (`*_paise`); rates in integer basis points (`apr_bp`, as `gst_rate_bp`); document hashes as lower-case SHA-256 hex; ids `[A-Za-z0-9_.:-]{3,128}`; times RFC 3339 with offset. People travel by reference only (`applicant_ref`, never a name, PAN or Aadhaar number); every payload is swept by `findAadhaarLike` in the contract cases.

| Item                       | Schema                                                                                                                                                                                                                                                                       | Idempotency key (§6.2)                 | Regulated |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | --------- |
| `EligibilityCheck` request | `EligibilityCheckRequest`: `lsp_ref`, `product_code`, `product_version?`, `amount_paise`, `tenor_months`, `consentref`, `fields` (the minimum consented fields, a bounded map)                                                                                               | `Idempotency-Key` header               | no        |
| `EligibilityCheck` answer  | `EligibilityCheckAnswer`: `check_id`, `outcome` (`ELIGIBLE`, `NOT_ELIGIBLE`, `REFER`), `offers[]` (`offer_id`, `amount_paise`, `tenor_months`, `apr_bp`), `reason_codes[]`, `rule_version`, `valid_until`; or `EligibilityCheckUnavailable` (`lender_unavailable` after 3 s) | —                                      | no        |
| `ApplicationSubmitted`     | `lsp_application_ref`, `applicants[]` (`applicant_ref`, `role`), `kyc_evidence_refs[]`, `otp_ekyc_declaration?`, `bureau_refs[]`, `aa_refs[]`, `documents[]` (`document_id`, `kind`, `sha256`), `consents[]`, `household?`                                                   | `lsp_application_ref`                  | no        |
| `ApplicationStatusChanged` | `application_id`, `seq`, `from`, `to`, `reason_code?`                                                                                                                                                                                                                        | (`application_id`, `seq`)              | no        |
| `AdditionalInfoRequested`  | `request_id`, `application_id`, `items[]` (`item_code`, `note?`), `due_date`                                                                                                                                                                                                 | `request_id`                           | no        |
| `DecisionMade`             | `application_id`, `decision_version`, `decision` (`SANCTIONED`, `REJECTED`), `reason_codes[]`, `rule_version`, `offers[]`                                                                                                                                                    | (`application_id`, `decision_version`) | **yes**   |
| `KFSIssued`                | `kfs_id`, `version`, `application_id`, `proposal_no`, `validity_expiry`, `apr_bp`, `document_sha256`                                                                                                                                                                         | (`kfs_id`, `version`)                  | **yes**   |
| `SanctionLetterIssued`     | `sanction_id`, `version`, `application_id`, `terms` (`amount_paise`, `tenor_months`, `apr_bp`), `document_sha256`                                                                                                                                                            | (`sanction_id`, `version`)             | **yes**   |
| `BorrowerAccepted`         | `kfs_id`, `accepted_at`, `explanation_acknowledged` (true)                                                                                                                                                                                                                   | `kfs_id`                               | no        |
| `CoolingOffExitRequested`  | `loan_id`, `requested_at`, `evidence` (`sha256`, `uri`)                                                                                                                                                                                                                      | `loan_id`                              | no        |
| `LoanDisbursed`            | `loan_id`, `utr`, `amount_paise`, `value_date`, `beneficiary_type`, `kind` (`INITIAL`, `TRANCHE`, `DRAWDOWN`), `cooling_off_end`                                                                                                                                             | (`loan_id`, `utr`)                     | **yes**   |

`ORIGINATION_EVENTS` lists each type with its schema, idempotency fields and `regulated` flag; `ORIGINATION_REGULATED` is checked in a test to equal the intersection with `REGULATED_MESSAGE_EVENTS` (the four above). Signatures: the detached JWS over the CloudEvent (`signRegulatedMessage`, approved under G5); RFC 9421 in transit is not built (not approved, owner answer #150).

## D. The mock lender (`@infrabyx/fakes`, `FakeLender`; minor)

Contract-faithful: it plays Finbyx's side of §6.2 and §6.3 and validates every message it takes or gives against §C.

- `eligibilityCheck(req, { idempotencyKey })`: answers within the budget; the same key and body answer the same result, another body under the same key is refused; a configured latency over 3 s answers `lender_unavailable` (the caller's timeout, as the Specification says).
- `submitApplication(event)`: takes `ApplicationSubmitted`, keyed by `lsp_application_ref`; emits `ApplicationStatusChanged` (`SUBMITTED` → `UNDER_REVIEW`), optionally `AdditionalInfoRequested`, then `DecisionMade`, `KFSIssued` and `SanctionLetterIssued`.
- `accept(event)`: takes `BorrowerAccepted`; refused after the KFS's `validity_expiry` ("Rejected after validity").
- `disburse(loanId)`: emits `LoanDisbursed` with `cooling_off_end`; `coolingOffExit(event)` is taken only before that time.
- Every outgoing event is an Ecosystem envelope (`EcosystemEnvelope`), and every regulated one carries its detached JWS, signed with the fake's own ES256 key; `keys` is a `RegulatedKeyRing` holding its public key, so a test verifies with `verifyRegulatedMessage` exactly as against the real lender. Test hooks: `outbox()`, `script({ decision, infoRequest, latencyMs })`, `clock`.
- Key: `@infrabyx/crypto` gains `localRegulatedSigner()` (ES256 on a key generated in memory, for tests and fakes only; no new algorithm, the G5 one).

## E. Tests (by IPB ID)

- `contracts` `origination.test.ts`: each schema accepts the Specification's fields and refuses the wrong types, unknown enum values, negative or fractional paise, a non-hex hash, an Aadhaar-like or PAN-shaped value in an id; the regulated set equals the four; the type names match `ECOSYSTEM_TYPE_REGEX` (`@IPB-10-AT-…` envelope rules).
- `testing` `lenderContractCases` (new, the shape a real Finbyx adapter must keep): eligibility within budget and idempotent; the journey's events in order with their idempotency keys; each regulated event verifies with the lender's key ring and fails with another key; acceptance after validity refused; cooling-off exit after its end refused; no Aadhaar-like number in any message.
- `fakes`: the cases run against `FakeLender`.

## F. Stubs and exit checklist

No vendor, no network, no migration, no setting. Exit: `pnpm check:full` green; the new cases pass; changesets for `contracts`, `crypto`, `fakes`, `testing` (minors); guide §7de; threat model §3.149 (a mock signing key: tests only, never in production configuration); STATUS; DECISIONS R1-D-217; owner question #157.

## G. Owner decisions needed

#157 only (the synchronous-call reading), with the default taken. Nothing blocks.
