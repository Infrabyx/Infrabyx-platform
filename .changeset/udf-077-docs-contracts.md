---
"@infrabyx/contracts": minor
---

Shared `DocumentShared` type codes and the executed-file link (Udofin PR-UDF-077, R1-D-259): `EXECUTED_DOCUMENT_TYPE`, `EXECUTION_EVIDENCE_SUMMARY_TYPE` and `PRIVACY_POLICY_LSP_TYPE`, with `SHARED_DOCUMENT_TYPES` (those three and `EXECUTION_PACK_MANIFEST_TYPE`); `type` stays an open code. `DocumentSharedData` takes an optional `source_document { document_id, version }`: the lender's document an executed file executes or an evidence summary covers. The binding of record stays the signed `ESignCompleted`, whose `signed_sha256` is the executed file's `sha256`; `executedDocumentMismatches(shared, esign)` returns the fixed labels (`EXECUTED_DOCUMENT_MISMATCHES`: `type`, `sha256`, `source_document`, `application_id`) where the two disagree, `[]` when they agree. Additive; no change to existing fields.
