# R1 plan: Udofin Phase 8, documents, eSign and eStamp evidence and the execution pack (PR-UDF-053)

Owner's order, 20 Nov 2026 (item E3, after the release of E2). Decision R1-D-219. Builds on E2 (`contracts/events/origination.ts`, `fakes` `FakeLender`; R1-D-217). Spec of record: Ecosystem Specification §6.2 (`ESignCompleted`, `EStampCompleted`), §6.13 (`DocumentShared`, `GET /v1/documents/{id}`), §3.6 (documents by reference with a detached JWS; regulated messages), §3.2 (envelope), §6.32 (the LawDocs hand-off, not used here). Nothing under `docs/ecosystem/` is edited; the execution-pack manifest, which the Specification does not name, goes to the owner as a versioned change proposal (PR-047).

## A. What Udofin asked for

1. `DocumentShared`, `ESignCompleted`, `EStampCompleted` and `GET /v1/documents/{id}` (a signed India-hosted URL, the sha256 and the JWS).
2. A lender execution-pack manifest schema: document ids and kinds, execution mode, stamp details, the summary-box page, the covenant declaration and the countersignature rule.
3. Contract cases and fakes; a versioned Ecosystem Specification change proposal to the owner.

## B. Contracts (`@infrabyx/contracts/events`, new file `documents.ts`; `origination.ts` extended; minor)

Conventions as E2: ids `[A-Za-z0-9_.:-]{3,128}`, codes `[A-Z][A-Z0-9_]{1,63}`, lower-case SHA-256 hex, money in integer paise, RFC 3339 times with offset, people by reference only.

| Item                                    | Type / path                                                    | Schema                                                                                                                                                                                                                                                                                                                                                                                                       | Idempotency key                   | Regulated |
| --------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- | --------- |
| `DocumentShared` (§6.13)                | `in.infrabyx.documents.DocumentShared.v1`                      | `document_id`, `version`, `type` (code), `sha256`, `jws` (the document JWS, §D), `retention_class` (code), `legal_hold` (boolean), `media_type?`, `size_bytes?`, `application_id?`                                                                                                                                                                                                                           | (`document_id`, `version`)        | no        |
| `GET /v1/documents/{id}` answer (§6.13) | `DOCUMENT_GET_PATH`                                            | `DocumentRetrieval`: `document_id`, `version`, `sha256`, `jws`, `url` (https), `issued_at`, `url_expires_at` (at most 15 min after `issued_at`, `DOCUMENT_URL_MAX_TTL_SECONDS = 900`), `data_residency: "IN"`; budget p95 800 ms (`DOCUMENT_GET_P95_MS`)                                                                                                                                                     | n/a                               | no        |
| `ESignCompleted` (§6.2)                 | `in.infrabyx.origination.ESignCompleted.v1` (UD → FX)          | `document_id`, `esp_txn_id`, `esp` (code), `signer_ref`, `signing_method` (`AADHAAR_OTP`, `AADHAAR_BIOMETRIC`, `DSC`), `signed_at`, `signed_sha256`, `certificate` (`serial_no`, `issuer`, `not_before`, `not_after`, `sha256` of the DER) — "never a bare flag": all required                                                                                                                               | (`document_id`, `esp_txn_id`)     | **yes**   |
| `EStampCompleted` (§6.2)                | `in.infrabyx.origination.EStampCompleted.v1` (UD → FX)         | `document_id`, `certificate_no`, `state` (ISO 3166-2:IN subdivision, `IN-MH`), `duty_paise` (≥ 0), `article?`, `issued_at`, `stamp_mode` (`E_STAMP`, `FRANKING`, `PHYSICAL_PAPER`), `stamp_verification_method?`                                                                                                                                                                                             | (`document_id`, `certificate_no`) | **yes**   |
| Execution-pack manifest (proposal)      | `ExecutionPackManifest`, `EXECUTION_PACK_MANIFEST_TYPE` (code) | `pack_id`, `version`, `application_id`, `kfs_id`, `sanction_id?`, `documents[]` (`document_id`, `version`, `kind`, `sha256`, `execution_mode`, `stamp_required`, `signers[]` by role), `stamp?` (`state`, `article`, `duty_paise`, `mode`, `payer`), `summary_box` (`document_id`, `page`), `covenant_declaration` (`document_id`, `sha256`), `countersignature` (`required`, `by`, `order`, `within_days?`) | (`pack_id`, `version`)            | n/a       |

Manifest rules checked by the schema: document ids unique; `summary_box.document_id` and `covenant_declaration.document_id` name documents in the pack; a document with `stamp_required` needs `stamp` and an execution mode other than `NONE`; `execution_mode` is one of `ESIGN_AADHAAR`, `ESIGN_DSC`, `WET_INK`, `NONE`; a countersignature `required: true` names `by` (`LENDER`) and `order` (`AFTER_BORROWER`, `BEFORE_BORROWER`).

**Delivery of the manifest until the Specification names it:** as a document, `DocumentShared` with `type: "EXECUTION_PACK_MANIFEST"`, `media_type: "application/json"`, whose bytes (fetched through `GET /v1/documents/{id}`) are the JCS form of the manifest. No new event type is emitted before the owner adopts one (PR-047 proposes `ExecutionPackIssued`, signed, FX → UD).

`ORIGINATION_EVENTS` gains `ESignCompleted` and `EStampCompleted` (direction `LSP_TO_LENDER`, regulated from `REGULATED_MESSAGE_EVENTS`), so `ORIGINATION_REGULATED` becomes six. `DOCUMENT_EVENTS` holds `DocumentShared`. Additive: no existing schema or field changes.

## C. The document JWS (`@infrabyx/crypto`; minor)

§3.6: documents travel by reference with a detached JWS for transfer integrity. Built on the approved C-22 profile (`signDetachedJws`, RFC 7515 Appendix F, ES256, base64url payload; RFC 7797 `b64: false` is not used, R1-D-94): `signDocumentJws({ descriptor, kid, sign })` and `verifyDocumentJws(jws, descriptor, keys)`, where the payload is the JCS form of `{ document_id, version, sha256 }` and `typ` is `ipb-document+jws`. Signing the descriptor (which binds the bytes through `sha256`) rather than the bytes keeps the JWS small and checkable before download; the consumer checks the downloaded bytes against `sha256`. No new primitive, key type or algorithm. `[ASSUMED – owner review]`, owner question #158 (the descriptor and the `typ`).

## D. The mock lender (`@infrabyx/fakes` `FakeLender`; minor)

- After a sanction it shares the KFS, the sanction letter, the loan agreement and the execution-pack manifest: one `DocumentShared` each, with the document JWS made by its own key (`keys` verifies both kinds).
- `getDocument(id)` answers `DocumentRetrieval` with an `https://` URL valid 15 minutes; `fetchDocument(url)` returns the bytes and refuses an expired or tampered URL (`url_expired`, `url_invalid`). `executionPack(applicationId)` returns the manifest.
- `eSignCompleted(event, jws)` and `eStampCompleted(event, jws)` take the regulated messages: refused `signature-invalid` without a JWS, with a wrong one, or when no `lspKeys` are configured; the document must be one the lender shared (`document_unknown`); the same idempotency key is taken once. The LSP's keys come in through the new option `lspKeys` (a `RegulatedKeyRing`).

## E. Tests (by IPB ID)

- `contracts` `documents.test.ts`: each schema accepts the Specification's fields and refuses wrong types, a bare `ESignCompleted` flag without certificate or signed hash, a URL that lives over 15 minutes or is not `https`, a non-hex hash, a state outside `IN-`, the manifest rules of §B; `ORIGINATION_REGULATED` equals its intersection with `REGULATED_MESSAGE_EVENTS` (six) (`@IPB-10-AT-…` envelope rules, as E2).
- `crypto` `document-jws.test.ts`: round trip; another descriptor, version or hash, or another key fails; the header holds only `alg`, `kid`, `typ`.
- `testing` `lenderContractCases()` extended: documents shared after sanction verify and match their bytes; the URL expires within 15 minutes and is refused after; the manifest is valid and names the shared documents; `ESignCompleted` and `EStampCompleted` refused unsigned or wrongly signed, taken once when signed. `testing` gains `lspSigner()` (a local ES256 signer and its key ring for the LSP side) so a product test signs its own regulated messages.

## F. Stubs and exit checklist

No vendor, no network, no migration, no setting. Exit: full local check green; the new cases pass; changesets for `contracts`, `crypto`, `fakes`, `testing` (minors); guide §7df; threat model §3.150; platform request PR-047 with the change proposal `docs/phases/PR-047-ecosystem-v1.6-draft.md`; STATUS; DECISIONS R1-D-219; owner question #158.

## G. Owner decisions needed

#158 (the document JWS descriptor) with its default; PR-047 (the Specification change proposal: adopt `ExecutionPackIssued` and the manifest, and pin the document JWS profile in §3.6). Nothing blocks.
