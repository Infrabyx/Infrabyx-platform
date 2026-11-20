---
"@infrabyx/fakes": minor
---

`FakeLender` (PR-UDF-061 items 13 to 17; R1-D-236):

- **Envelope subject and seq (§3.2):** `subject` is the aggregate id its event names (`originationSubject`: the application, KFS, sanction letter, pack, document or loan id; for `DocumentShared` the document id) and `seq` counts per subject from 1. Tests that read the subject as the idempotency key, or `seq` as one counter across the lender, change.
- **Real synthetic PDFs:** every document is a small valid PDF (`pdfFixture`), and `KFSIssued.document_sha256`, `SanctionLetterIssued.document_sha256` and each `DocumentShared.sha256` are over those bytes; the KFS and the sanction letter carry `document_version: 1`.
- **v2 document JWS:** each `DocumentShared` is signed with `signDocumentJwsV2` (type, media type, size and application bound) and carries `language: "en"`; `getDocument` answers `media_type`, `size_bytes`, `type` and `application_id`.
- **The execution pack follows the acceptance:** the KFS and the sanction letter are shared after the sanction; after `BorrowerAccepted` the lender shares the loan agreement, terms and conditions, product summary, privacy policy and the agreement's e-stamp certificate, emits the signed `ExecutionPackIssued` (the CF para 9(3) set, the accepted KFS, enclosures, stamp evidence, not-stampable list, the covenant declared for a request purpose starting `BUSINESS`) and then shares the interim `EXECUTION_PACK_MANIFEST` document. `executionPack()` is refused `pack_unknown` before the acceptance.
- `CoolingOffExitAnswered` is signed.
