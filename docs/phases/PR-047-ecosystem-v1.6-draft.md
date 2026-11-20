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
