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

## 6. Addendum, 20 Nov 2026, for Udofin PR-UDF-061 items (12) to (17) (R1-D-236): a proposal for the owner

The owner approved §1 to §5 as drafted on 20 Nov 2026 (18:50 IST). Building PR-UDF-061's items (12) to (17) on top of that approval changes some of the approved text. **These changes are proposals, not yet approved**; the platform ships them additively from the next contracts minor (owner question #168) and the owner decides whether the Specification takes them.

**6.1 §1 (`ExecutionPackIssued`), proposed changes to the approved row:**

- Trigger: "The borrower accepts the KFS within its validity" (was "The lender fixes how a sanctioned loan is to be executed"): the pack lists the CF para 9(3) documents, which go to the borrower on execution, so it follows `BorrowerAccepted`.
- Key payload fields, added: kfs_version and kfs_sha256 (the accepted KFS); per document an instrument code (an IT Act First Schedule instrument is never executed by eSign or DSC) and an enclosure code; signers by role as an enum (`BORROWER`, `CO_APPLICANT`, `GUARANTOR`, `LENDER`); per document stamp evidence (channel, certificate no, State, duty and stated duty in paise, stamped document hash, issued at, vendor certificate id, certificate document id); not-stampable documents (document_id, reason); an enclosure list (code, clause ref; RBC para 14); a covenant (business purpose, declared; WD para 7(4)).
- Key payload fields, changed: the covenant declaration (document_id, sha256) becomes **conditional**: present exactly when the covenant is declared, and required for a business-purpose loan (was always present).

**6.2 §3 (what the document JWS signs), proposed addition after the approved text:**

"A producer may sign a **v2 descriptor** instead: the same profile and key, `typ` `ipb-document-v2+jws`, over the JCS form of `{ "application_id" (when the document belongs to an application), "document_id", "media_type", "sha256", "size_bytes", "type", "version" }`. A consumer verifies a v1 or v2 JWS by its `typ`, checks the downloaded bytes' length against `size_bytes` as well as their hash against `sha256`, and may refuse v1 once its producer signs v2."

**6.3 §6.13, proposed additions:** `DocumentShared` key payload fields add language (BCP 47), media type, size and application_id, with "application_id is present on every document of a loan application"; the `GET /v1/documents/{id}` answer adds media type, size, type and application_id, "signed with the descriptor (v2)".

**6.4 §3.2 (`subject` and `seq`), proposed clarification:** "For the Part 6.2 and 6.3 events the subject is the id of the entity the event is about: `lsp_application_ref` (`ApplicationSubmitted`), `application_id` (`ApplicationStatusChanged`, `AdditionalInfoRequested`, `DecisionMade`), `kfs_id` (`KFSIssued`, `BorrowerAccepted`), `sanction_id`, `pack_id`, `document_id` (`ESignCompleted`, `EStampCompleted`, `DocumentShared`) and `loan_id` (`LoanDisbursed`, the cooling-off events); `seq` counts per subject from 1."

**6.5 §6.2, additive optional fields (as §5):** `KFSIssued` and `SanctionLetterIssued` add the document's version beside its reference.
