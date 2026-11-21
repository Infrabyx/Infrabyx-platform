# @infrabyx/fakes

## 1.10.0

### Minor Changes

- 86f3d6e: `FakeFileTransfer` (`fake-file-transfer`), the in-memory FILE_TRANSFER server and the CI-green alternative to the `sftp` adapter (Udofin PR-UDF-071; R1-D-254, ADR-0014), with `FakeFileTransferOptions`, `FileTransferFixtures` and `fileTransferFakeFixtures`. It keeps the port's rules: the path rule, the class (REGULATED at least, never SECRET), the `get` cap, no overwrite (`exists`), `not_found` (a put into a missing directory included), `not_a_file`, the list cap, an `enabled` switch and the abort signal; `seed`, `mkdir`, `freshDir` and `stored` for tests. Nothing existing changes.
- c4e2d65: `FakeEsign` `downloadSigned(id, { keyRef })` and `downloadSignedDocuments(id, { keyRef })` write the signed PDF and the chains under the named STORAGE key (Udofin PR-UDF-074; R1-D-260); `signedObjects()` entries carry `keyRef`. A reference the STORAGE fake does not know fails the download with its refusal and writes nothing; a malformed one is refused `IPB-PORT-003` `key_ref_invalid`. The files are written once: a later download naming another reference (or none, after one) is refused `IPB-PORT-003` `key_ref_changed`. Without `storage` the reference is only checked for format.
- af54ffe: `MemoryStorage.keyRefStatuses` and the `keyStateError(tenantId, keyRef)` option (Udofin PR-UDF-076; R1-D-261): `"unavailable"` makes the key-state read (`describeKey`) of that reference throw `IPB-PORT-002`, from `keyRefStatus` and `keyRefStatuses`; `"not_described"` answers `storage_key_not_described` from `keyRefStatuses` and `storage_key_unavailable` from `keyRefStatus`, as the `s3` adapter does. Without the option nothing changes.
- b909f64: `FakeDocgen` can write real files to STORAGE (Udofin PR-UDF-077, R1-D-259): `new FakeDocgen(templates, { storage, renderers: { pdf: toPdf, docx: toDocx }, bucketClass? })`. Each `render` and `renderHtml` then lays out a document (the template and version as title and level-1 heading, one paragraph per data field in key order; for HTML, its title and block text, never its head, scripts or styles; text outside printable ASCII and the rupee sign shown as `?`), renders it and writes the bytes under the request's prefix as `tenant/<tenant>/<module>/<ULID-shaped id>.<ext>` with the bytes' SHA-256 (`CONFIDENTIAL` by default). `pdf` is plain PDF, `pdfa` asks for PDF/A-2b with PDF/UA-1 (`{ pdfa: "2b", pdfua: true, lang: "en" }`), `docx` needs a `docx` renderer (`IPB-PORT-001` otherwise), `html` writes the escaped page. The id comes from the bytes' hash, so a deterministic renderer gives the same key and bytes for the same request; a prefix that is not `tenant/<tenant>/<module>` is refused before anything is written. The renderers are passed in because `@infrabyx/fakes` cannot depend on `@infrabyx/export` (a cycle through `@infrabyx/testing`). New types `FakeDocgenFiles`, `FakeDocgenRenderers`, `FakeDocgenDocument`, `FakeDocgenPdfOptions`. Without the second argument nothing changes.

### Patch Changes

- Updated dependencies [2769b78]
- Updated dependencies [5aba118]
- Updated dependencies [2a0ea72]
- Updated dependencies [21a2bc4]
- Updated dependencies [ef3adc2]
- Updated dependencies [01f9313]
- Updated dependencies [200a8a4]
  - @infrabyx/config@1.24.0
  - @infrabyx/contracts@1.46.0
  - @infrabyx/crypto@1.14.0

## 1.9.0

### Minor Changes

- aa0e0e8: `FakeLender`'s `LoanDisbursed` carries `lsp_application_ref` (the LSP's reference from `ApplicationSubmitted`) alongside `application_id` (Udofin PR-UDF-061 finding (i); R1-D-256). The subject and `seq` are unchanged.
- 2a00cc7: `FakeEsign` as an ESP with certificates, STORAGE and multi-document envelopes (Udofin PR-UDF-070; R1-D-251). Every signature record carries `signerCertificate` from a throwaway test CA (made on first use; the common name is the signer's name). `new FakeEsign({ storage, now? })` reads each document from STORAGE (refusing `hash_mismatch` or a non-PDF), signs it as a real PAdES incremental update per signer, and on the first download writes the signed PDF and each signer's PEM chain to STORAGE (REGULATED, IPB-01-27 keys under the document's tenant, SHA-256 of the bytes; `certChainRef` is the chain's key). `createMultiDocumentEnvelope`, `downloadSignedDocuments`, `signDocument` and the envelope's `documents` status: it completes only when every document is signed by every signer. Test hooks: `signedObjects()`, `failNextDownload(error?)`, `setSignerCertificate(ref, testSignerOrDerOrPem)`, `decline(id, ref)`, `trustStore()`. `new FakeEsign()` and `new FakeEsign(() => date)` keep the earlier download reference; signing again for a signer who already signed is now a no-op, and the not-completed refusal carries `meta.reason: "not_completed"`.
- 0598167: `FakeLender`'s execution pack uses the PR-UDF-075 additions (R1-D-258) in both carriers: the agreement's e-stamp evidence names `estamp_system: "SHCIL"`, each not-stampable entry `reason_code: "NOT_AN_INSTRUMENT"` (`not_stampable_reason_code` in the manifest) and the disbursement clause `clause_ref: "4.2"` beside `page_or_clause_ref: "cl.4.2"`.

### Patch Changes

- Updated dependencies [75cbd9a]
- Updated dependencies [beca045]
- Updated dependencies [5b1257d]
- Updated dependencies [199c930]
- Updated dependencies [27057c2]
- Updated dependencies [a702fdc]
- Updated dependencies [f3293a2]
  - @infrabyx/contracts@1.45.0
  - @infrabyx/crypto@1.13.0
  - @infrabyx/config@1.23.1

## 1.8.0

### Minor Changes

- 674b8db: `FakeAccountAggregator` writes each FI payload to STORAGE on `fetch` (Udofin PR-UDF-065; R1-D-243), as the `setu-aa` adapter does: the bytes of a synthetic ReBIT-shaped JSON payload (new export `fakeFiPayload`) in the `REGULATED` class, under an IPB-01-27 key `<dataPrefix><ULID>.json`, and the result's `sha256` is the lower-case hex SHA-256 of exactly the stored bytes, so a STATEMENT_ANALYSIS adapter can analyse the payloads by reference. New constructor option `storage` (a `StoragePort`) and property `storage`; without it the fake keeps its own `MemoryStorage`, so `new FakeAccountAggregator()` works as before. Changed: a payload's `storageKey` was `<dataPrefix><sessionId>-<fiType>.json`, which was not an IPB-01-27 key and named nothing in STORAGE, and its `sha256` hashed no stored bytes; a test that matched the old key shape or the old digest must read the payload from `storage` instead. `AccountAggregatorFixtures` gains optional `storageOf`, set in `ACCOUNT_AGGREGATOR_FAKE_FIXTURES`.
- 373c28c: PR-UDF-054 (E8; R1-D-245): `FakeEstamp.recordCertificate` records a stamp bought outside the platform, with the shared `assertStampRecord` check, once per idempotency key and a certificate number once per State and channel (`IPB-PORT-004`, `certificate_reused`); `verify` and `attach` work on recorded certificates as on bought ones. Additive; `purchase` and DDE are unchanged.

### Patch Changes

- Updated dependencies [d4636a3]
- Updated dependencies [ae319d5]
- Updated dependencies [2d543fe]
- Updated dependencies [98a1d62]
- Updated dependencies [461fe2c]
  - @infrabyx/contracts@1.44.0
  - @infrabyx/config@1.23.0
  - @infrabyx/crypto@1.12.0

## 1.7.0

### Minor Changes

- f0edee3: Named tenant key status (Udofin PR-UDF-068; R1-D-239). `contracts`: optional `StoragePort.keyRefStatus(tenantId, keyRef, { bucketClass, compartment?, describeKey? })` answering `{ status: "resolves", keyState? }` or `{ status: "refused", reason, keyState? }` with a write's refusal label or `storage_key_unavailable`, never a key id; `STORAGE_KEY_STATES`, `STORAGE_KEY_UNAVAILABLE`, `isValidStorageTenantId` and `storageKeyRefStatusRefusal`. `connectors`: `S3Storage.keyRefStatus` runs the write's own checks and, with `describeKey`, one read-only KMS `DescribeKey` (a key that is not `Enabled`, or that the role may not describe, answers `storage_key_unavailable`); `MinioStorage` declares it `unsupported`. `fakes`: `MemoryStorage.keyRefStatus` and a `keyStates` option. `testing`: a STORAGE built-in contract case. Read-only, not ledgered; no setting, no migration.

### Patch Changes

- Updated dependencies [648c511]
- Updated dependencies [9be2fc7]
- Updated dependencies [f0edee3]
- Updated dependencies [2d2729b]
  - @infrabyx/crypto@1.11.0
  - @infrabyx/contracts@1.43.0
  - @infrabyx/config@1.22.3

## 1.6.0

### Minor Changes

- fe2bcf7: `FakeLender` (PR-UDF-061 items 13 to 17; R1-D-236):

  - **Envelope subject and seq (§3.2):** `subject` is the aggregate id (`originationSubject`: the application id for the origination events, so one application's status changes, decision, KFS, sanction letter and pack are one stream; the loan id for `LoanDisbursed` and `CoolingOffExitAnswered`; the document id for `DocumentShared`) and `seq` counts per subject from 1. Tests that read the subject as the idempotency key, or `seq` as one counter across the lender, change.
  - **Real synthetic PDFs:** every document is a small valid PDF (`pdfFixture`), and `KFSIssued.document_sha256`, `SanctionLetterIssued.document_sha256` and each `DocumentShared.sha256` are over those bytes; the KFS and the sanction letter carry `document_version: 1`.
  - **v2 document JWS:** each `DocumentShared` is signed with `signDocumentJwsV2` (type, media type, size and application bound) and carries `language: "en"`; `getDocument` answers `media_type`, `size_bytes`, `type` and `application_id`.
  - **The execution pack follows the acceptance:** the KFS and the sanction letter are shared after the sanction; after `BorrowerAccepted` the lender shares the loan agreement, terms and conditions, product summary, privacy policy and the agreement's e-stamp certificate, emits the signed `ExecutionPackIssued` (the CF para 9(3) set, the accepted KFS, enclosures, stamp evidence, not-stampable list, the covenant declared for a request purpose starting `BUSINESS`) and then shares the interim `EXECUTION_PACK_MANIFEST` document. `executionPack()` is refused `pack_unknown` before the acceptance.
  - `CoolingOffExitAnswered` is signed.

### Patch Changes

- Updated dependencies [2cb5b3f]
- Updated dependencies [a38f921]
- Updated dependencies [f62dcaa]
- Updated dependencies [dbb08e6]
  - @infrabyx/contracts@1.42.0
  - @infrabyx/crypto@1.10.0
  - @infrabyx/config@1.22.2

## 1.5.0

### Minor Changes

- 98c9416: Udofin's `udf_ext` v1 list (PR-UDF-061; R1-D-232), all optional and additive. Products can drop each extension field as they adopt this release (guide §7dn).

  `contracts/events`:

  - **Offers:** `monthly_instalment_paise` (agrees with a `MONTHLY` `monthly_instalment`), `penal_charges_text` and `kfs_url` (`https`).
  - **Product codes:** `PRODUCT_CODE_PATTERN` (`^[A-Z][A-Z0-9_]{1,15}$`, two characters allowed) on `EligibilityCheckRequest` and `ApplicationSubmitted`, beside every code taken before.
  - **`ApplicationSubmitted`:** `offer_ref`, `product_code`, `request`, `economic_profile`, `household.monthly_household_income_paise` and `is_microfinance`, `kyc`, `credit_data_modes` and `consent_purposes` (each naming one of `consents`).
  - **`BorrowerAccepted`:** `lsp_application_ref`, `kfs_version`, `kfs_sha256`, `acknowledged_at` and `device_ref`.
  - **`CoolingOffExitRequested`:** `lsp_application_ref`.
  - **New event `CoolingOffExitAnswered`** (`in.infrabyx.servicing.CoolingOffExitAnswered.v1`, FX → UD, key `(loan_id, exit_ref)`): the exit amount, a payment instruction in words with no link, the lender's reference and the time. It is not signed until the Specification lists it; signing is proposed in PR-047 §5.
  - **`ApplicationStatusChanged`:** `status_text`.
  - **`DecisionMade`:** `reason_texts`.
  - **`KFSIssued`:** `issued_at`, `language`, `document_ref`, `tenor_days`, `cash_flows` (`KfsInstalment`), `charges` (`KfsCharge`, `KFS_CHARGE_PAYEES`, `KFS_CHARGE_RECURRENCES`), `cooling_off_days`, `exit_terms`, `nodal_gro`, `co_lending` and `lsp_recovery_agent` (`KFS_AGENT_ROLES`); the Annex shapes are [VERIFY] against the RBI KFS format.
  - **`SanctionLetterIssued`:** `document_ref`.
  - **`LoanDisbursed`:** `application_id` and `disbursed_at`.

  `fakes`: `FakeLender` sends every field. It refuses an `offer_ref` it never made (`offer_unknown`) and an acceptance of another KFS version, hash or application (`kfs_mismatch`, `application_mismatch`), and answers the first exit request once with `CoolingOffExitAnswered`.

  `testing`: seven lender contract cases.

  No setting, no migration.

### Patch Changes

- Updated dependencies [98c9416]
  - @infrabyx/contracts@1.41.0
  - @infrabyx/config@1.22.1
  - @infrabyx/crypto@1.9.2

## 1.4.0

### Minor Changes

- ce8ca22: Owner answers of 20 Nov 10:50 (R1-D-229), all optional and additive. `contracts/events`: `KfsIssuedData.loan_amount_paise` (the KFS "Loan amount", integer paise, distinct from the net disbursed amount; PR-UDF-051); `ExecutionPackManifest.disbursement_clause { document_id, page_or_clause_ref, amount_stated_paise }`, whose document must be in the pack (PR-UDF-053); `SecurityIncidentNotifiedData.cert_in_category` (`CERT_IN_INCIDENT_CATEGORIES`, CERT-In Directions Annexure I) and `cert_in_report_by` (at most `detected_at` + 6 h), with `certInReportBy(noticedAt)` and `CERT_IN_REPORT_WINDOW_MS`, carried by `securityIncidentClockCopy` (PR-FBX-51, #159 (a)). `connectors`: a `tenantNamedKmsKeyIds` value may be `{ keyId, bucketKey?: boolean }` (`NamedKmsKey`); `bucketKey: false` writes and presigned uploads under that reference with S3 Bucket Keys off (a KMS request per object operation); the string form is unchanged, Bucket Keys on (PR-UDF-058, #165 (3)). `fakes`: `FakeLender` sends the KFS loan amount and the manifest's disbursement clause. `testing`: two lender contract cases for them; the GRC incident case sends the CERT-In fields.
- b135555: No-cache presigned downloads (Udofin PR-UDF-060; R1-D-230). `connectors`: a presigned `get` of a `REGULATED` or `CONFIDENTIAL` object (compartments included), on `s3` and `minio`, signs the response overrides `response-cache-control=no-store, private` and `response-expires=Thu, 01 Jan 1970 00:00:00 GMT`, so the store answers with `Cache-Control: no-store, private` and a past `Expires` and devices and webviews keep no copy; the overrides follow the bucket the URL reads from and cannot be dropped by a caller. Other classes and upload URLs are unchanged. S3 has no `Pragma` override: `Cache-Control: no-store` supersedes it for HTTP/1.1 clients. `contracts`: `NO_CACHE_PRESIGN_CLASSES`, `PRESIGN_NO_CACHE` and `presignNoCache`. `fakes`: `MemoryStorage` adds the same parameters to its download URLs. `testing`: a STORAGE contract case checks the URL and, on HTTP stores, the headers returned. No setting, no migration.
- 1ffb012: Owner's addendum of 20 Nov 13:10 (R1-D-231), all optional and additive. `contracts/events`: the shared offer schema is exported as `OriginationOffer` and takes `monthly_instalment { amount_paise, frequency }` (`INSTALMENT_FREQUENCIES`), `penal_charges` (`PenalCharge`, at most 20: a basis code, exactly one of `rate_bp` or `amount_paise`, a description; `PENAL_CHARGE_BASES`, [VERIFY] against RBI's Penal Charges directions) and `kfs_link { document_id, version? }` (a document reference, never a URL) (PR-UDF-051); each `ExecutionPackManifest.documents[]` item takes `stamp_evidence` (`StampEvidence`: `STAMP_EVIDENCE_MODES` `ESTAMP`, `PAPER`, `FRANKING`, State, certificate number, duty in paise, stamped document SHA-256, optional vendor reference; `STAMP_EVIDENCE_MODE_OF` maps the pack-level `STAMP_MODES`) and `not_stampable` with `not_stampable_reason`, refused with stamp evidence or `stamp_required: true` (PR-UDF-053). `fakes`: `FakeLender`'s offers carry an EMI and a penal charge, its sanctioned offer a KFS link, its loan agreement stamp evidence and its KFS `not_stampable`. `testing`: two lender contract cases for them.

### Patch Changes

- Updated dependencies [053e16a]
- Updated dependencies [ce8ca22]
- Updated dependencies [b135555]
- Updated dependencies [48810fd]
- Updated dependencies [1ffb012]
  - @infrabyx/contracts@1.40.0
  - @infrabyx/config@1.22.0
  - @infrabyx/crypto@1.9.1

## 1.3.0

### Minor Changes

- 5fd012a: Documents by reference, the eSign and eStamp evidence and the lender execution-pack manifest (Udofin PR-UDF-053; R1-D-219). `contracts/events`: `DocumentSharedData` and `DOCUMENT_EVENTS` (Ecosystem Specification §6.13), `DocumentRetrieval` for `GET /v1/documents/{id}` (an India-hosted `https` URL valid at most 15 minutes, `DOCUMENT_URL_MAX_TTL_SECONDS`), `ESignCompletedData` and `EStampCompletedData` (§6.2, signed; added to `ORIGINATION_EVENTS`, so `ORIGINATION_REGULATED` now lists six), and `ExecutionPackManifest` (documents and kinds, execution mode, stamp details, summary-box page, covenant declaration, countersignature rule), shared as a document of type `EXECUTION_PACK_MANIFEST` until the Specification names a carrier (platform request PR-047). `crypto`: `signDocumentJws` and `verifyDocumentJws`, the C-22 detached JWS (`typ: ipb-document+jws`) over `{ document_id, version, sha256 }`. `fakes`: `FakeLender` shares the KFS, sanction letter, loan agreement and manifest after a sanction (`sharedDocuments()`, `getDocument`, `fetchDocument`, `executionPack`) and takes the LSP's signed `ESignCompleted` and `EStampCompleted` (`eSignCompleted`, `eStampCompleted`), verified against the new `lspKeys` option; `outbox()` is unchanged. `testing`: `lspSigner()` and four more `lenderContractCases({ lsp })`. Nothing existing changes meaning.
- 3b57c29: The GRC port and the §6.15 GRC events (Finbyx PR-FBX-51; R1-D-220; ADR-0013). `contracts/events` adds the v1 data schemas `ControlTestResultPublishedData`, `ComplianceIssueRaisedData`, `ReturnStatusUpdatedData`, `PolicyAttestedData` and `SecurityIncidentNotifiedData` with their type constants (`in.infrabyx.grc.<Event>.v1`) and enums, `GRC_EVENTS` (type, schema, idempotency fields, direction, regulated; with `EvidenceSubmitted` and `ObligationPublished`), `grcIdempotencyKey`, `grcPersonalDataProblems` (every schema refuses an Aadhaar-like number or a PAN anywhere in the data), `GRC_MASKED_ID`, `RETURN_PERIOD` and `securityIncidentClockCopy` (the OH13 copy). `contracts/ports` adds `GrcPort` on the Ecosystem Spec §9.2 generic connector contract: `listObligations({ updatedSince?, cursor?, limit? }, call?)` → `{ items: GrcObligation[], nextCursor? }` and `publishControlTestResult`, `submitEvidence`, `raiseIssue`, `notifyIncident`, `updateReturnStatus`, `recordPolicyAttestation` (the event data, `call?`) → `GrcReceipt`, with `GRC_POST_METHODS`, `GRC_REFUSALS`, `grcRefusal`, `assertGrcClass`, `prepareGrcPost`, `prepareGrcObligationQuery` and the catalogue entry (tier 2, `int.grc.`, in `R1_PORTS`). Every POST is keyed (the caller's key, else the event's own); the same key and body answer the same receipt, another body is `IPB-PORT-004`; incident updates are taken in `update_seq` order (`out_of_order`); a call above CONFIDENTIAL and any personal data are `IPB-PORT-003`. `config` registers `int.grc.generic.enabled` (false) and `int.grc.generic.host` (empty). `connectors` adds `@infrabyx/connectors/grc`: `GenericGrc` (`generic-grc`), the §9.2 REST contract to one configured host with a bearer token from SECRETS, stub-shaped where §9.2 is silent, off and unproven; its router method table and exit entry. `fakes` adds `FakeGrc`, `GrcFixtures` and `grcFakeFixtures`; `testing` adds `grcContractCases`, `grcSamples`, `grcObligations` and `startGrcStub`. No migration; nothing existing changes.
- 4d509e6: STORAGE puts under a named tenant key (Udofin PR-UDF-058; R1-D-227), so a vault keeps each lender's files under that lender's own KMS key. `contracts/ports`: optional `ObjectMeta.keyRef` and `PresignOptions.keyRef` (a reference such as `lender:<id>`, never a key id), `isValidStorageKeyRef`, `NAMED_KEY_CLASSES` (`CONFIDENTIAL`, `REGULATED`), `STORAGE_KEY_REF_META`, `STORAGE_KEY_REF_REFUSALS` and `resolveStorageKeyRef`. `connectors`: `S3StorageOptions.tenantNamedKmsKeyIds` and `tenantKeyRefPrefixes`; a named write is encrypted under the resolved key, records the reference (`get` returns `meta.keyRef`), and is refused (never sent under the class key) for an unknown, malformed, misplaced, shared or changed reference or for a tenant with its own CMK; a disabled or revoked named key reads as `IPB-KMS-001` `storage_key_unavailable` (failures of objects under platform keys are unchanged); `minio` refuses a reference as `unsupported`. `fakes`: `MemoryStorage(now, { keyRefs, keyRefPrefixes })` records the reference (none known by default). `testing`: a built-in STORAGE contract case for named keys; a STORAGE adapter outside the platform either configures `lender:contract` and `lender:contract-b` for tenant `tnt_contract` in `REGULATED` in its contract leg or declares `put.keyRef` unsupported. Writes without a reference are unchanged.

### Patch Changes

- Updated dependencies [5fd012a]
- Updated dependencies [3b57c29]
- Updated dependencies [4d509e6]
  - @infrabyx/contracts@1.39.0
  - @infrabyx/crypto@1.9.0
  - @infrabyx/config@1.21.0

## 1.2.0

### Minor Changes

- 3c4b588: The origination contract of Ecosystem Specification §6.2 and §6.3 and a mock lender (Udofin PR-UDF-051; R1-D-217). `contracts/events`: `EligibilityCheckRequest` and `EligibilityCheckAnswer` for the synchronous `POST /v1/eligibility-checks` (3 s budget, `lender_unavailable` past it), the v1 data schemas of `ApplicationSubmitted`, `ApplicationStatusChanged`, `AdditionalInfoRequested`, `DecisionMade`, `KFSIssued`, `SanctionLetterIssued`, `BorrowerAccepted`, `CoolingOffExitRequested` and `LoanDisbursed`, `ORIGINATION_EVENTS` (type, schema, idempotency fields, direction, regulated), `ORIGINATION_REGULATED` and `originationIdempotencyKey`. `crypto`: `localRegulatedSigner(kid)`, an ES256 signer on an in-memory key for tests and fakes only. `fakes`: `FakeLender`, which answers the calls, emits the journey's envelopes and signs the regulated ones (`keys` to verify), with `script` and `outbox` hooks. `testing`: `lenderContractCases()` and `lspEvent()`. Nothing existing changes.

### Patch Changes

- Updated dependencies [3c4b588]
  - @infrabyx/contracts@1.38.0
  - @infrabyx/crypto@1.8.0
  - @infrabyx/config@1.20.1

## 1.1.0

### Minor Changes

- 82dc7ef: The AA consent's FIU check, approval link and product reference (Udofin PR-UDF-050; R1-D-204). `contracts`: `AaConsentRequest.fiuId?` (the FIU the consent is for, `AA_FIU_ID_REGEX`) and `AaConsentRequest.consentArtefact?` (the product's own `{ kind, id }`, R1-D-203; `consentRef` is unchanged, the required `cpr_` string); `AaConsent.fiuId?` (the FIU the AA reports) and `AaConsent.approvalUrl?` (the AA's customer approval page, only while PENDING); `aaFiuMismatch`, `AA_FIU_MISMATCH` (`fiu_mismatch`), `aaApprovalUrlAllowed` (`https:`, no user information, an exact listed host, and no 12-digit run or Aadhaar-like number once every RFC 9562 UUID is set aside, so an id whose last group is all digits is accepted; owner answer #154), `RFC9562_UUID`, `isRfc9562Uuid` and `AA_APPROVAL_URL_REFUSED` (`approval_url_not_allowed`). When a request names a FIU, a consent the AA reports for another FIU, or for none, is refused `IPB-PORT-001` `fiu_mismatch` (definite) before anything is kept or returned, and so is every later read-back (`consentStatus`, `revoke`, `fetch`, `handleWebhook`); a request without `fiuId` is compared with nothing, as before. `connectors` (`SetuAccountAggregator`): reads the FIU from the consent read-back's `detail.FIU.id`, keeps the asked FIU in `SetuConsentRecord.fiuId`, answers Setu's link as `approvalUrl` while PENDING only after `aaApprovalUrlAllowed` against the new `approvalHosts` option (default Setu's two hosts), reads the consent back before keeping its record so a refused one leaves none, and deprecates `approvalUrl(consentId)`. `fakes` (`FakeAccountAggregator({ fiuId?, approvalHost? })`) reports its own FIU (`fake-fiu`) and a letters-only link while PENDING, with `reportFiu` and `consentsKept` test hooks; `AccountAggregatorFixtures` gains optional `fiuId` and `reportFiu`. `testing` adds the AA contract cases (calls with and without a consent artefact, the FIU refusals, the link only while PENDING, an Aadhaar-like sweep) and the Setu stub's `fiuId`, `reportFiu`, `linkBase` and `nextConsentId` hooks (its ids are any random UUID, an all-digit last group included).
- 1cdbf0f: Aadhaar offline verification names its form (Udofin PR-UDF-039; R1-D-190). `AadhaarOfflineCheck.kind` (`AADHAAR_OFFLINE_KINDS`: `xml_zip`, the default, or `secure_qr`): the ZIP needs its share code, a Secure QR is refused with one; `AadhaarOfflineResult.kind` echoes it. The contract states the stored-object SHA-256 check before any parse or vendor call (`hash_mismatch`) and that no field carries more than the last four digits. Digio refuses `secure_qr` as `unsupported` until its path is checked against UIDAI's Secure QR specification; the fake verifies both forms. `kycContractCases` gains the case.
- 2f9d3f8: Aadhaar OTP e-KYC for a notified reporting entity (Udofin PR-UDF-041; R1-D-194). `KycPort.aadhaarOtpRequest({ uid, uidKind, consent }, call)` returns `{ txn, expiresAt }` with the evidence and `aadhaarOtpVerify({ txn, otp }, call)` returns `{ ekyc, signatureValid, uidLast4 }` with the evidence; both optional on the interface, provided by `FakeKyc`, `DigioKyc`, `IdfyKyc` and `kycMethodRouter` (the new `aadhaar_otp` method). Every call is refused `not_configured` before any vendor call unless the adapter is built with `notifiedEntity: true`. `contracts` adds `AadhaarOtpRequest`, `AadhaarOtpVerify`, `AADHAAR_UID_KINDS`, `AADHAAR_OTP_REFUSALS` (`uid_invalid`, `mobile_not_linked`, `otp_invalid`, `otp_expired`, `not_configured`) and `aadhaarUidValid` (12-digit Aadhaar number with first digit 2 to 9, or 16-digit VID, each with the Verhoeff check; grouped forms refused). The e-KYC response is written to the adapter's STORAGE; one that carries a full number is refused `ekyc_holds_number`. `aadhaarOtpVerify` is idempotent on `call.idempotencyKey` for 24 hours: a retry gets the first answer, the same key with another code or transaction is `IPB-PORT-004`. `connectors` adds `AadhaarOtpVerifyStore`, `PgAadhaarOtpVerifyStore`, `MemoryAadhaarOtpVerifyStore` and the migration `0011_kyc_aadhaar_otp_verify.sql` (`connectors.kyc_aadhaar_otp_verify`, forced RLS); `IdfyKyc` gains `currentTenant`. `fakes` adds `FAKE_AADHAAR_OTP`, `syntheticUid`, `AadhaarOtpFixtures` and `KycFixtures.aadhaarOtp`; `testing` adds five contract cases and the Digio and IDfy stubs' Aadhaar OTP.
- 9e626ef: Bank account checks by mode, keyed retries and the penny-drop funding statement (Udofin PR-UDF-043; R1-D-196). `BankAccountCheck` gains an optional `mode` (`"pennyless"` or `"penny_drop"`, `BANK_ACCOUNT_MODES`) and `BankAccountResult` an optional `mode` (the mode used; always set by the platform's adapters and the fake). An adapter that cannot honour the mode asked refuses `IPB-PORT-002` with `meta.reason: "mode_unsupported"` (`BANK_ACCOUNT_MODE_UNSUPPORTED`) before any vendor call, never falling back to another mode; omitted, the adapter's configured mode is used and reported. `bankAccountVerify` is idempotent on `call.idempotencyKey` for 24 hours: a retry gets the first answer with no vendor call, and the same key with another account, IFSC, name or mode is `IPB-PORT-004`; a keyed penny drop whose first call did not finish is never sent again (`pending_unresolved`). The status set is unchanged (`BANK_ACCOUNT_STATUSES`). `contracts` adds `KYC_ADAPTER_FUNDING` and `kycAdapterFunding(adapter)`: per adapter, who funds a penny drop (`provider`, `tenant` or `unknown`) and the source, a statement only; Digio and IDfy are `unknown` until verified. `DigioKyc` and `IdfyKyc` now provide pennyless bank account checks (stub-shaped, adapters off) and refuse a penny drop `mode_unsupported`; `connectors` adds `BankAccountVerifyStore`, `PgBankAccountVerifyStore`, `MemoryBankAccountVerifyStore`, `keyedBankAccountVerify` and the migration `0012_kyc_bank_account_verify.sql` (`connectors.kyc_bank_account_verify`, forced RLS); `kycMethodRouter` moves a check past an adapter that refuses `mode_unsupported`, but not a keyed check or a penny drop past an unavailable one; the router's breaker no longer counts `mode_unsupported`. `FakeKyc` honours both modes (options `bankAccountModes`, `bankAccountMode`) and counts `bankAccountVendorCalls`; `fakes` adds `KycFixtures.bankAccount` (`BankAccountFixtures`); `testing` adds four contract cases and the Digio and IDfy stubs' bank accounts.
- aac1c2c: A product's own consent artefact beside the bureau consent receipt (Udofin PR-UDF-049; R1-D-203, owner answer #153). `BureauPullRequest.consentRef` is unchanged (the required `cpr_<ULID>` string), so no caller or adapter outside the platform needs a change. New optional `BureauPullRequest.consentArtefact: { kind, id }`, the product's own purpose-consent artefact for the same pull, and `BureauReport.consentArtefact?`, echoed only when the request carried one (an answer to a pull without it is exactly as before). `contracts` adds `ports/consent-ref`: `ConsentReceiptRef` (the `cpr_` string), `ConsentArtefact` (strict `{ kind, id }`: `kind` one to four dot-separated `[a-z][a-z0-9_]*` segments, 3 to 64 characters, `cpr` and `cns` reserved; `id` 3 to 128 characters of `[A-Za-z0-9._-]`, not a platform `cpr_`/`cns_` id; neither may hold a standalone run of 10 or more digits, an Aadhaar-like number (`findAadhaarLike`) or a standalone PAN-shaped run; each refusal a fixed label from `CONSENT_ARTEFACT_REFUSALS`), `consentArtefactProblem`, `consentInForce` (the artefact as `<kind>:<id>` when present, else `consentRef`) and `consentEcho`. The platform checks an artefact's shape only; the product asserts the consent behind it. Neither is sent to the CIC. `fakes` (`FakeCreditBureau`) and `connectors` (`CibilBureau`, whose pull record keeps `consentArtefact?` beside `consentRef`) accept and echo both; `testing` adds contract cases for calls with and without an artefact and the refusals, `contractConsentArtefact` and `malformedConsentArtefacts`.
- d58d5f0: DigiLocker start, document evidence and idempotent pulls (Udofin PR-UDF-040; R1-D-193). `KycPort.startDigilocker({ docTypes, returnUrl }, call)` returns `{ consentSession, signInUrl, expiresAt }` with the evidence; optional on the interface, provided by `FakeKyc`, `DigioKyc` and `kycMethodRouter`, refused `unsupported` by `IdfyKyc`. The return address must pass `digilockerReturnUrlAllowed` (`https:`, no user information, no 12-digit run, a host on the adapter's `digilockerReturnHosts`), else `return_url_not_allowed`. `DigilockerDocument` gains `evidence` and `signatureValid` (`null` when the vendor does not report it). `digilockerPull` is idempotent on `call.idempotencyKey` for 24 hours: a retry returns the stored documents instead of `consent_used`, the same key with another session or other types is `IPB-PORT-004`. `connectors` adds `DigilockerPullStore`, `PgDigilockerPullStore` and `MemoryDigilockerPullStore` and the migration `0010_kyc_digilocker_pull.sql` (`connectors.kyc_digilocker_pull`, forced RLS); the Digio stub gains the start and `completeDigilocker`; `kycContractCases` gains three cases and `KycFixtures.digilockerReturnUrl`.
- dbaecff: V-CIP webhooks verified without a vendor call (Udofin PR-UDF-046; R1-D-199). `KycPort.verifyWebhook(rawBody, headers, meta?) → { eventId, vcipId, receivedAt }` (`KycWebhookReceipt`), optional on the interface, checks a webhook's size, signature, window and replay only, with no vendor call and no read-back, so a product answers 401 to an unverified event, records `eventId` in its module inbox, acknowledges within 2 s and reads the session back with `vcipStatus` from its queue (IPB-10-27). `handleWebhook` keeps its signature and, where `verifyWebhook` exists, is `verifyWebhook` and then `vcipStatus`. `contracts` adds `verifyKycWebhookWith` (the order: the body's size, at most `KYC_WEBHOOK_MAX_BODY_BYTES` (64 KiB) before anything is read; the Standard Webhooks headers; the signature and `KYC_WEBHOOK_TOLERANCE_SECONDS` (300) window; the replay claim on the delivery's id and timestamp; then the session id), `KYC_WEBHOOK_REFUSALS` (`body_too_large`, `signature_invalid`, `timestamp_stale`, `event_replayed`; `IPB-API-018`, definite), `kycWebhookRefused`, `KYC_WEBHOOK_MALFORMED` (`IPB-PORT-001` for a verified event naming no session) and `KycWebhookReplayStore`. `crypto` adds `verifyStandardWebhook` (C-13: HMAC-SHA-256 over `<id>.<timestamp>.<body>` as IPB-10-21 defines it, constant time, ±5 minutes, `whsec_` secrets, rotation, `v1` only) and `signStandardWebhookForTest`; no new algorithm. `FakeKyc` verifies Standard Webhooks (`FAKE_KYC_WEBHOOK`, `signFakeKycWebhook`, option `webhook: { secrets, replay }`, `vcipStatusVendorCalls`), and its `handleWebhook` now refuses an unsigned event. `KycFixtures.webhook` (optional) drives two new contract cases. `connectors` adds `standardWebhookKycVerifier` for an adapter whose provider signs with Standard Webhooks; `DigioKyc` and `IdfyKyc` refuse `verifyWebhook` `unsupported`; `kycMethodRouter` routes it under `vcip`. **Products: `FakeKyc.handleWebhook` and `verifyWebhook` now refuse an unsigned delivery, so a test that posts an event to the fake must sign it with `signFakeKycWebhook(body)` (from `@infrabyx/fakes` or `@infrabyx/testing`) and pass the headers it returns.** C-13 covers Standard Webhooks v1 by the owner's approval (R1-D-210); RFC 9421 is not approved.
- 80a843a: Liveness by mode, applied thresholds, keyed retries and the template retention statement (Udofin PR-UDF-044; R1-D-197). `LivenessCheck` gains an optional `mode` (`"passive"`, `"active_gesture"` or `"active_voice"`, `LIVENESS_MODES`) and `ScoreResult` an optional `threshold` (the threshold the adapter applied, for liveness and face match) and `mode` (the liveness mode used); the platform's adapters and the fake always set them. An adapter that cannot honour the mode refuses `IPB-PORT-002` with `meta.reason: "mode_unsupported"` (`KYC_MODE_UNSUPPORTED`, which `BANK_ACCOUNT_MODE_UNSUPPORTED` now equals) before any vendor call, never falling back; omitted, the configured mode is used and reported. `livenessCheck` and `faceMatch` are idempotent on `call.idempotencyKey` for 24 hours, a key scoped to its method: a retry gets the first answer with no vendor call, and the same key with other frames, another mode or other images is `IPB-PORT-004`. `score` is a finite number from 0 to 1 (`kycScoreValid`): an adapter normalises a vendor score on its known scale and refuses any other `IPB-PORT-003` with `meta.reason: "score_out_of_range"` (`KYC_SCORE_OUT_OF_RANGE`), never clamping. `contracts` adds `KYC_ADAPTER_RETENTION` and `kycAdapterRetention(adapter)`: per adapter, whether the vendor keeps a face template or embedding beyond the call (`none`, `kept` or `unknown`) and the source, a statement only; Digio and IDfy are `unknown` until a written vendor statement. `IdfyKyc` honours `passive` liveness only (its photo liveness), reports its thresholds (now checked to be from 0 to 1), reads scores on the scale `IDFY_SCORE_SCALE` (1, or the option `scoreScale: 100`) and refuses one off it instead of guessing the scale and clamping; `DigioKyc` has no liveness or face-match path and still refuses both `unsupported`. `connectors` adds `KycScoreCheckStore`, `PgKycScoreCheckStore`, `MemoryKycScoreCheckStore`, `keyedScoreCheck`, `livenessMode`, `scoreOnScale` and the migration `0013_kyc_score_check.sql` (`connectors.kyc_score_check`, forced RLS; no image, template, embedding or storage reference in clear); `kycMethodRouter` moves any call past `mode_unsupported` and keeps a keyed liveness check or face match with an unavailable adapter. `FakeKyc` honours every liveness mode (options `livenessModes`, `livenessMode`, `livenessThreshold`, `faceMatchThreshold`), counts `livenessVendorCalls` and `faceMatchVendorCalls`, and `offScaleNext()` makes its next score off the scale; `fakes` adds `KycFixtures.scores` (`ScoreFixtures`); `testing` adds seven contract cases and the IDfy stub's `livenessChecks`, `faceMatches` and `scoreOnce`.
- ff2a74b: The STATEMENT_ANALYSIS port, its adapters and its fake (Udofin PR-UDF-048; R1-D-202; ADR-0012). `contracts` adds `StatementAnalysisPort`: `analyse({ subjectRef, inputs: [{ fiType, storageKey, sha256 }], reportPrefix }, call?) → StatementAnalysis` (`analysisId` `sta_<ULID>`, `state` `COMPLETED`, `PENDING` or `FAILED`, `report?: { storageKey, sha256 }`, `failureReason?`, `adapter`, `method`, `vendorRef`, `checkedAt`), `status(analysisId, call?)` and `handleWebhook(rawBody, headers, meta?)`, with `StatementAnalysisRequest` (strict; STORAGE references and SHA-256s only, up to 24 inputs in the report prefix's tenant, no Aadhaar-like subject reference; every field REGULATED), `StatementAnalysisResult`, `statementAnalysisResultOnly`, `STATEMENT_ANALYSIS_FAILURES`, `STATEMENT_ANALYSIS_REFUSALS`, `assertStatementAnalysisClass`, `statementInputFormat`, the catalogue entry (tier 2, `int.statement_analysis.`, in `R1_PORTS`), the `sta` id prefix and `PORT_DEFAULT_DATA_CLASS.STATEMENT_ANALYSIS = "REGULATED"`. `config` registers `int.statement_analysis.platform.enabled`, `int.statement_analysis.http.enabled` (both false) and `int.statement_analysis.http.host` (empty). `connectors` adds `@infrabyx/connectors/statement-analysis`: `PlatformStatementAnalyser` (`platform-statement`, the reference: in-platform, no vendor or egress, a checksum-summary report and nothing from a statement's content) and `HttpStatementAnalyser` (`http-statement`, a vendor-neutral HTTP alternative, every vendor shape stub-shaped), both off and refusing `handleWebhook` `unsupported`; `StatementAnalysisStore`, `PgStatementAnalysisStore`, `MemoryStatementAnalysisStore` and the migration `0014_statement_analysis.sql` (`connectors.statement_analysis`, forced RLS, hashes and references only, 24 hours); keyed retries answer the same analysis with one analyser call and the key with another request is `IPB-PORT-004`; an input outside the REGULATED class, or a call class other than REGULATED, is `IPB-PORT-003` before any analyser call, and the router's method table refuses an instance that cannot carry REGULATED. `fakes` adds `FakeStatementAnalysis` (its webhook signed with the approved C-22 profile under a development key), `signFakeStatementAnalysisNotification`, `fakeStatementAnalysisWebhookKeys` and `StatementAnalysisFixtures`; `testing` adds `statementAnalysisContractCases`, `statementAnalysisFakeFixtures`, `contractStatement`, `startStatementAnalysisStub` and the ESLint plugin's port default. Run `infrabyx-migrate` for `connectors/0014` if you wire the adapters' PostgreSQL store.
- d35f7e9: The RE-hosted V-CIP launcher and its signed hand-off (Udofin PR-UDF-045; R1-D-198). `KycPort.launchVcip({ context, jws }, call) → { vcipId, launchUrl, expiresAt }` (`VcipLaunch`, with the evidence), optional on the interface, lets an LSP hand a customer to an RE's V-CIP without hosting any V-CIP component. `contracts` adds `VcipHandoffContext` (tenant, RE, LSP, customer reference, journey id, issued-at, expires-at, nonce: ids and times only, strict, at most `VCIP_HANDOFF_MAX_LIFETIME_SECONDS` (900) from issue to expiry, no field with a 12-digit run or an Aadhaar-like number), `LaunchVcip`, `VCIP_HANDOFF_REFUSALS` (`handoff_invalid`, `handoff_replayed`, `handoff_expired`), `vcipHandoffFailure`, `vcipHandoffTimeRefusal`, `vcipLaunchUrlAllowed` (`https:`, the adapter's exact hosts, no user information, no number) and `VCIP_LAUNCH_URL_REFUSED`. The LSP signs the context with the existing `signRegulatedMessage`; the adapter verifies it with `verifyRegulatedMessage` and its replay store before any vendor call (nothing new in cryptography), and refuses `IPB-PORT-001` with a fixed label, definite. `vcipStatus(vcipId, call?)` takes an optional `PortCall` and reads under its tenant. `VcipManifest` gains `reasonCode` (`VCIP_REASON_CODES`) and `liveness.mode` (`LIVENESS_MODES`); the free-text `reason` stays, deprecated, never to be shown. `VcipSession` gains an optional `vcipId` to start a launched session. `FakeKyc` implements the launcher (`FAKE_VCIP_HANDOFF`, `signFakeVcipHandoff`, `fakeVcipHandoffKeys`, `fakeVcipHandoffContext`, `vcipLaunchVendorCalls`); `KycFixtures.vcipLaunch` (optional) drives three new contract cases. `VcipConductor` takes hand-offs (`handoff: { reId, issuers, replay, launchBaseUrl, launchHosts? }`), schedules the session the RE's official starts with `startVcip({ …, vcipId })`, expires it with its hand-off (`launch_expired`), takes a `reasonCode` on `complete` and `drop`, a liveness `mode` on `assess`, and a `PortCall` or tenant on `vcipStatus`. `DigioKyc` and `IdfyKyc` refuse `launchVcip` `unsupported`; `kycMethodRouter` routes it under `vcip` and never moves a launch past an unavailable adapter.

### Patch Changes

- Updated dependencies [82dc7ef]
- Updated dependencies [1cdbf0f]
- Updated dependencies [2f9d3f8]
- Updated dependencies [b0e0b72]
- Updated dependencies [9e626ef]
- Updated dependencies [aac1c2c]
- Updated dependencies [d58d5f0]
- Updated dependencies [dbaecff]
- Updated dependencies [80a843a]
- Updated dependencies [1cdbf0f]
- Updated dependencies [ff2a74b]
- Updated dependencies [d35f7e9]
  - @infrabyx/contracts@1.37.0
  - @infrabyx/crypto@1.7.0
  - @infrabyx/config@1.20.0

## 1.0.2

### Patch Changes

- Updated dependencies [4af2688]
- Updated dependencies [955cc67]
  - @infrabyx/contracts@1.36.0
  - @infrabyx/config@1.19.0
  - @infrabyx/crypto@1.6.2

## 1.0.1

### Patch Changes

- Updated dependencies [a6929eb]
  - @infrabyx/contracts@1.35.0
  - @infrabyx/config@1.18.1
  - @infrabyx/crypto@1.6.1

## 1.0.0

- First release (PR-FBX-48, R1-D-181, ADR-0011): the port fakes and fixtures moved out of `@infrabyx/testing`, which re-exports them unchanged. Runtime dependencies: `@infrabyx/contracts`, `@infrabyx/crypto`, `@infrabyx/config`.
