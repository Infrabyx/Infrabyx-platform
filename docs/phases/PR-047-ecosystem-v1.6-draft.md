# PR-047: Ecosystem Specification v1.6 change proposal — the execution pack and the document JWS

Raised 20 Nov 2026 by the platform repository for Udofin PR-UDF-053 (R1-D-219), for the owner's decision. Proposed amendment text only: nothing under `docs/ecosystem/` is edited here. If the owner approves, the owner applies it to the Specification (as for v1.3 to v1.5) and the platform moves the manifest from its interim carrier to the new event in a minor.

**Version:** v1.6 (proposed), additive. A v1.5 consumer that does not subscribe to the new type is unaffected; no existing event, field or code changes meaning.

## 1. §6.2 Origination: one new row (after `SanctionLetterIssued`)

| Event or API                       | Producer → consumer(s) | Trigger                                                  | Key payload fields                                                                                                                                                                                                                                                                                                                                                                                                                                    | Owner | Idempotency key    | SLA                          |
| ---------------------------------- | ---------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------------ | ---------------------------- |
| `ExecutionPackIssued` (N16) signed | FX → UD                | The lender fixes how a sanctioned loan is to be executed | pack_id, version, application_id, kfs_id, sanction_id; documents (document_id, version, kind, sha256, execution mode `ESIGN_AADHAAR`/`ESIGN_DSC`/`WET_INK`/`NONE`, stamp required, signers by role); stamp (State as ISO 3166-2:IN, article, duty in paise, mode `E_STAMP`/`FRANKING`/`PHYSICAL_PAPER`, payer); summary-box page (document_id, page); covenant declaration (document_id, sha256); countersignature (required, by, order, within days) | FX    | (pack_id, version) | Before the borrower executes |

Each listed document is also shared by `DocumentShared` (§6.13) and fetched by `GET /v1/documents/{id}`. A new version supersedes the earlier one; UD executes only the latest version and only within the KFS validity.

## 2. §3.6: add `ExecutionPackIssued` to the regulated messages

"**Regulated messages added in v1.6:** `ExecutionPackIssued` (6.2). As for the others: RFC 9421 in transit and a detached JWS over the CloudEvent in `X-Infrabyx-JWS`, stored with it."

## 3. §3.6: what the document JWS signs

Replace "Documents travel by reference (`document_id`, `sha256`) with a detached JWS (RFC 7515, 7797) for transfer integrity" with:

"Documents travel by reference (`document_id`, `version`, `sha256`) with a **detached document JWS** for transfer integrity: a compact detached JWS (RFC 7515 Appendix F; the payload base64url-encoded in the signing input, no `b64: false`) whose payload is the JCS form (RFC 8785) of `{ "document_id", "version", "sha256" }` and whose protected header holds `alg` (`ES256`), `kid` and `typ` (`ipb-document+jws`) only, made with the producer's ecosystem signing key. The consumer verifies it against the key set it pins for the producer before fetching the bytes, and the bytes against `sha256` after. Legal effect rests on the document's own eSign, DSC or PAdES signature and e-stamp."

## 4. Interim (until approved)

The platform ships `ExecutionPackManifest` in `@infrabyx/contracts/events` and the mock lender shares it as a `DocumentShared` of type `EXECUTION_PACK_MANIFEST` (`application/json`, the JCS form of the manifest, covered by the document JWS). No `ExecutionPackIssued` is emitted before the owner approves this proposal.

## 5. Added 20 Nov 2026 for Udofin PR-UDF-061 (R1-D-232): the answer to a cooling-off exit, and optional fields

**§6.3: one new row, after `CoolingOffExitRequested`:**

| Event or API                        | Producer → consumer(s) | Trigger                                         | Key payload fields                                                                                                        | Owner | Idempotency key     | Latency |
| ----------------------------------- | ---------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----- | ------------------- | ------- |
| `CoolingOffExitAnswered` (E) signed | FX → UD                | The lender answers an exit request (CF para 11) | loan_id, exit_ref, exit amount (paise: principal and proportionate APR), payment instruction (text, no link), answered_at | FX    | (loan_id, exit_ref) | std     |

**§3.6:** add `CoolingOffExitAnswered` to the regulated messages added in v1.6, because it states an amount owed and how to pay it.

**§6.2 and §6.3 key payload fields (additive, optional):**

- Offers: monthly instalment, the penal-charges text, a KFS URL.
- `ApplicationSubmitted`: the chosen offer and product code, the request (amount, tenor in days, purpose), the economic profile (CF para 8), the household figures, the KYC level and state, the credit-data modes, and consent purposes.
- `BorrowerAccepted`: the KFS version and hash, the acknowledgement time, a device reference.
- `ApplicationStatusChanged`: the lender's status text.
- `DecisionMade`: the reason texts.
- `KFSIssued`: the issue time, language, document reference, tenor in days, cash flows, charges, cooling-off days, exit terms, and the Annex items (nodal grievance officer, co-lending, LSPs and recovery agents).
- `SanctionLetterIssued`: the document reference.
- `LoanDisbursed`: the lender's application id and the time of disbursal.

**Interim (until approved):** the platform ships `CoolingOffExitAnswered` unsigned in `@infrabyx/contracts/events`, and the mock lender emits it. Once v1.6 lists it, signing it is a minor: the event joins `REGULATED_MESSAGE_EVENTS` and a consumer verifies its JWS like the other regulated messages.
