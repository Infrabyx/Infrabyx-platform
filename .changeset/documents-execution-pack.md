---
"@infrabyx/contracts": minor
"@infrabyx/crypto": minor
"@infrabyx/fakes": minor
"@infrabyx/testing": minor
---

Documents by reference, the eSign and eStamp evidence and the lender execution-pack manifest (Udofin PR-UDF-053; R1-D-219). `contracts/events`: `DocumentSharedData` and `DOCUMENT_EVENTS` (Ecosystem Specification §6.13), `DocumentRetrieval` for `GET /v1/documents/{id}` (an India-hosted `https` URL valid at most 15 minutes, `DOCUMENT_URL_MAX_TTL_SECONDS`), `ESignCompletedData` and `EStampCompletedData` (§6.2, signed; added to `ORIGINATION_EVENTS`, so `ORIGINATION_REGULATED` now lists six), and `ExecutionPackManifest` (documents and kinds, execution mode, stamp details, summary-box page, covenant declaration, countersignature rule), shared as a document of type `EXECUTION_PACK_MANIFEST` until the Specification names a carrier (platform request PR-047). `crypto`: `signDocumentJws` and `verifyDocumentJws`, the C-22 detached JWS (`typ: ipb-document+jws`) over `{ document_id, version, sha256 }`. `fakes`: `FakeLender` shares the KFS, sanction letter, loan agreement and manifest after a sanction (`sharedDocuments()`, `getDocument`, `fetchDocument`, `executionPack`) and takes the LSP's signed `ESignCompleted` and `EStampCompleted` (`eSignCompleted`, `eStampCompleted`), verified against the new `lspKeys` option; `outbox()` is unchanged. `testing`: `lspSigner()` and four more `lenderContractCases({ lsp })`. Nothing existing changes meaning.
