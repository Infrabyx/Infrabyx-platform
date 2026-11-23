# @infrabyx/contracts

## 1.50.0

### Minor Changes

- 9abffba: `connector.retrieval.host_refused`: the detail's `host` now takes three forms, a DNS name (`RETRIEVAL_HOST_PATTERN`, unchanged), an IPv6 literal exactly as the WHATWG URL parser writes it (`isRetrievalHostIpv6Literal`, `RETRIEVAL_HOST_IPV6_PATTERN`; bracketed, compressed, lower case), or a SHA-256 digest (`RETRIEVAL_HOST_DIGEST_PATTERN`, `sha256:` and 64 hex digits) with the new detail field `host_length` (1 to `RETRIEVAL_HOST_LENGTH_MAX`), required with a digest and refused otherwise. `retrievalHostOf` also answers an IPv6 literal. New `RETRIEVAL_URL_MAX_LENGTH` (8192). PR-UDF-082; R1-D-279.

## 1.49.0

### Minor Changes

- 4fbcf73: AV: a new scan error reason `storage_key_unavailable` (the file's named STORAGE key is disabled, deleted or no longer granted, `IPB-KMS-001`), told apart from an outage (`unavailable`); still `ERROR`, so the file stays quarantined. `scanReasonOfReadError(e)` maps a failed STORAGE read to its scan reason (`IPB-STOR-005` → `hash_mismatch`, `IPB-KMS-001` → `storage_key_unavailable`, anything else → `unavailable`). R1-D-276.

## 1.48.0

### Minor Changes

- 5fc6afe: Udofin PR-UDF-079 (R1-D-270): the no-Aadhaar rule's wider names and labelled values, additive in `@infrabyx/contracts/aadhaar` (and the root). `isAadhaarCarrierName(name)` is `isAadhaarFieldName` (unchanged) plus a carrier name inside a longer name: an `aadhaar` or `aadhar` segment anywhere (`borrower_aadhaar_ref`, `masked_aadhaar_no`), or a name ending with the segments of `uid`, `uid_no`, `uid_num`, `uid_number`, `uid_token` or `uidai_token` (`user_uid`, `kyc_uid_token`; not `uid_kind`, `uuid`, `guid`, `fluid`, `uidx`); segments split at separators, case changes and letter-digit boundaries (`AADHAAR_CARRIER_NAME_ENDINGS`). `isAadhaarLastFourName` (`aadhaar_last_digits`, `aadhaarLast4`, `aadhaar_last_4`) and `holdsAadhaarCarrierValue(name, value)`: a last-four name holds a reportable value only past four digits. `findAadhaarCarrierFields(json)` is `findAadhaarNamedFields` with the wider names. `findAadhaarLabelledValues(text)` finds a carrier name followed by a value in free text (`aadhaar: <digits>`, `Aadhaar No. XXXX XXXX dddd`, `uid=<8 or more>`), masked or not, Verhoeff-valid or not, in linear time, returning offsets only (`AadhaarLabelledFind`, `AADHAAR_LABELLED_VALUE_MAX`). `findAadhaarLike`, `isAadhaarFieldName` and `findAadhaarNamedFields` are unchanged, so the AI scrubber and the e-KYC check read as before.
- daa13b9: Udofin PR-UDF-080 (R1-D-269): a STORAGE integrity mismatch has its own error code. New catalogue entry `IPB-STOR-005` "Stored object failed its integrity check; read refused" (500, help key `hlp.int.storage_integrity`; registration in IPB-01 §01.6.3 asked in PR-050), with `STORAGE_INTEGRITY_ERROR`, `STORAGE_HASH_MISMATCH` (`"hash_mismatch"`, its `meta.reason`) and `isStorageIntegrityError(e)` in `@infrabyx/contracts/ports`. `StoragePort.get` now documents both failures: bytes that do not match the SHA-256 recorded at write, or a checksum the store returns that disagrees with them, are `IPB-STOR-005`; an outage is `IPB-PORT-002`; neither returns bytes. The PDF port's note says `extractText` passes the integrity failure on as `IPB-STOR-005`. `toProblem` carries the code and the `hash_mismatch` label unchanged, with no `retry_after_seconds`.

## 1.47.0

### Minor Changes

- 5ee71f6: Finbyx PR-FBX-53 (R1-D-266): one mapping from a CloudEvents event type to a queue job name, and one queue name rule. `contracts/events` adds `eventJobName(type)` (`in.fbx.cms.ContentPublished.v1` → `in.fbx.cms.content-published.v1`: only the PascalCase event segment changes, every capital becoming `-` and its lower-case letter, so `KFSIssued` → `k-f-s-issued`) and its exact inverse `eventTypeOfJobName(name)`, with `isEventJobName`; both refuse `IPB-PORT-003` with a fixed `meta.reason` (`not_event_type`, `job_name_too_long` past 100 characters, `not_event_job_name`; `EVENT_JOB_NAME_REFUSALS`). `contracts/ports` adds the platform's queue name rule, the one the QUEUE adapters already applied: `QUEUE_NAME_REGEX`, `QUEUE_JOB_NAME_REGEX`, `QUEUE_NAME_MAX` (63), `QUEUE_JOB_NAME_MAX` (100), `isQueueName`, `isQueueJobName`, and `assertQueueName` / `assertQueueJob`, which refuse `IPB-PORT-003` (`meta.reason` `queue_name`, `job_name` or `job_data`) before any I/O; call them in an in-memory QUEUE fixture. Nothing existing changes.

## 1.46.0

### Minor Changes

- 5aba118: The FILE_TRANSFER port (Udofin PR-UDF-071, Finbyx's BureauSubmitter its second user; R1-D-254, ADR-0014). `contracts/ports` adds `FileTransferPort`: `list(dir, { maxEntries })` → `{ dir, entries: [{ name, type, size, modifiedAt }], truncated, skipped }`, `get(path, { maxBytes })` → `{ path, bytes, size, sha256 }` (refused `too_large` past the cap, default 32 MiB, at most 256 MiB) and `put(path, bytes, { ifAbsent: true })` → `{ path, size, sha256 }` (no overwrite: refused `exists` when the path exists); every call takes the `PortCall` fields and an `AbortSignal`. Shared checks `fileTransferPath`, `assertFileTransferPath`, `isFileTransferName`, `assertFileTransferClass` (at least the new port default `REGULATED`, never `SECRET`), `preparePut`, `fileTransferGetLimit`, `fileTransferListLimit`, `assertNotAborted`, and the fixed refusal labels `FILE_TRANSFER_REFUSALS` with `fileTransferRefusal`. Catalogue entry `FILE_TRANSFER` (tier 2, `int.file_transfer.`, in `R1_PORTS`) and `PORT_DEFAULT_DATA_CLASS.FILE_TRANSFER = "REGULATED"`. The Ecosystem Spec §3.11 helpers: `fileExchangeName`, `parseFileExchangeName`, `FileExchangeManifest`, `fileExchangeManifest` and `checkFileExchangeManifest` (fixed mismatch labels). Nothing existing changes.
- 21a2bc4: Udofin PR-UDF-072 (R1-D-262): the security event kind `connector.retrieval.host_refused` (`RETRIEVAL_HOST_REFUSED_EVENT`) with its strict detail `RetrievalHostRefusedDetail` `{ partner_tenant_id, document_id, version, host }`, where `host` is a bare lower-case DNS name (`RETRIEVAL_HOST_PATTERN`; no scheme, credentials, port, path or query, at most 128 characters). `SECURITY_EVENT_SHAPES` and `securityEventShapeProblem` check a kind's typed detail and resource; `retrievalHostRefusedEvent(detail)` builds the checked event and `retrievalHostOf(url)` takes the host from a refused URL. Additive: `rules.reveal.refused` is unchanged.
- ef3adc2: `EsignPort.downloadSigned(envelopeId, opts?)` and `downloadSignedDocuments?(envelopeId, opts?)` take `EsignDownloadOptions` (`{ keyRef? }`): the ESP's signed file is written to REGULATED under that named tenant STORAGE key (PR-UDF-058), failing closed: a reference STORAGE refuses, or a key that cannot be used (`IPB-KMS-001` `storage_key_unavailable`), fails the download and nothing is written under the class key instead (Udofin PR-UDF-074; R1-D-260). Additive: the option is optional, and an adapter that ignores the second argument still type-checks; such an adapter would write under the class key, so a product that names a key should use a platform adapter at this version or later.
- 01f9313: `StoragePort.keyRefStatuses?(tenantId, keyRef, { bucketClasses, compartment?, describeKey? })`: `keyRefStatus` for one to six classes in one call, answered per class (`StorageKeyRefStatuses`), with one `DescribeKey` per distinct key; `STORAGE_KEY_NOT_DESCRIBED` (`storage_key_not_described`) for a key the role may not describe; `StorageKeyRefStatusesReason`, `StorageKeyRefClassStatus`, `StorageKeyRefStatusesOptions`, `keyRefStatusClasses()` and `MAX_KEY_REF_STATUS_CLASSES` (Udofin PR-UDF-076; R1-D-261).

  **Not breaking.** The new label is only in the new method's answer type: `StorageKeyRefStatus` and `StorageKeyRefStatusReason` are unchanged, and `keyRefStatus` still answers `storage_key_unavailable` for a key it may not describe (R1-D-239, #171 (1)). Adding the member to the existing union would have been type-compatible for most code but would break an exhaustive `switch` on `reason` and change what a consumer that tests for `storage_key_unavailable` sees, so that change is left for a major. A consumer of `keyRefStatuses` that branches on `reason` must handle `storage_key_not_described` (status `refused`, as before).

- 200a8a4: Shared `DocumentShared` type codes and the executed-file link (Udofin PR-UDF-077, R1-D-259): `EXECUTED_DOCUMENT_TYPE`, `EXECUTION_EVIDENCE_SUMMARY_TYPE` and `PRIVACY_POLICY_LSP_TYPE`, with `SHARED_DOCUMENT_TYPES` (those three and `EXECUTION_PACK_MANIFEST_TYPE`); `type` stays an open code. `DocumentSharedData` takes an optional `source_document { document_id, version }`: the lender's document an executed file executes or an evidence summary covers. The binding of record stays the signed `ESignCompleted`, whose `signed_sha256` is the executed file's `sha256`; `executedDocumentMismatches(shared, esign)` returns the fixed labels (`EXECUTED_DOCUMENT_MISMATCHES`: `type`, `sha256`, `source_document`, `application_id`) where the two disagree, `[]` when they agree. Additive; no change to existing fields.

## 1.45.0

### Minor Changes

- 75cbd9a: Optional `lsp_application_ref` on `LoanDisbursedData` (Udofin PR-UDF-061 finding (i); R1-D-256), the LSP's own application reference with the shape it has on `CoolingOffExitAnswered`, so an LSP can tell which application was disbursed. `application_id` stays optional: making it required, or adding a rule that one of the two is present, would refuse a payload valid before, so the schema documents that a lender sends one or both and the lender contract cases require it. The envelope subject is unchanged (`loan_id`, R1-D-236).
- beca045: Optional per-document `physical_reason` and `re_instructions` on the execution pack (Udofin PR-UDF-061 item 18; R1-D-252), on both `ExecutionPackManifest.documents[]` and `ExecutionPackIssuedData.documents[]` (`PackDocument`). New `PACK_PHYSICAL_REASONS` (`REGISTRATION_REQUIRED`, `NOTARISATION_REQUIRED`) and `PACK_RE_INSTRUCTIONS_MAX` (1000). `re_instructions` is the lender's plain text, 1 to 1,000 characters, with no control character and no link (the rule of `CoolingOffExitAnswered.payment_instruction`, R1-D-232, now shared). A document with a `physical_reason` must be `execution_mode: WET_INK`. Both fields are optional, so every pack valid before still parses.
- 199c930: ESIGN signer certificates and multi-document envelopes (Udofin PR-UDF-070; R1-D-251). `SignatureRecord` gains an optional `signerCertificate` (`SignerCertificateSummary`: `serialNumber`, `issuer`, `notBefore`, `notAfter`, `sha256` of the DER, `subjectCommonName`), filled by adapters from the ESP's own certificate. `EsignPort` gains two optional methods, `createMultiDocumentEnvelope(documents, signers, order, call?)` (`EnvelopeDocuments`: 1 to `MAX_ENVELOPE_DOCUMENTS` = 10 documents, each an `EnvelopeDocument` with its own `DocumentRef` and signature fields, unique ids and storage keys) and `downloadSignedDocuments(envelopeId)` (`SignedEnvelopeDocument[]`), and `EnvelopeStatus` an optional `documents` (`EnvelopeDocumentStatus`). A multi-document envelope completes only when every document is signed by every signer (all or nothing); `downloadSigned` on an envelope of several documents is refused `multi_document`. Existing adapters and callers are unaffected.
- a702fdc: Execution-pack evidence additions (Udofin PR-UDF-075; R1-D-258), all optional, so every pack valid before still parses. (1) `estamp_system` (`ESTAMP_SYSTEMS`: `SHCIL`, `STATE_PORTAL`, `NESL_DDE`, `GRAS`) on `PackStampEvidence` (only with `channel: E_STAMP`) and on the manifest's `StampEvidence` (only with `mode: ESTAMP`). (2) `reason_code` (`NOT_STAMPABLE_REASON_CODES`: `NOT_AN_INSTRUMENT`, `ACKNOWLEDGEMENT`, `OTHER`) on `ExecutionPackIssuedData.not_stampable[]`, and `not_stampable_reason_code` on a manifest item (only with `not_stampable: true`); the free-text reason stays required for every code. (3) `disbursement_clause.page` (1 to 2000) and `clause_ref` (`4.2`, `4.2(a)`) in both carriers, beside the still-required `page_or_clause_ref`, whose read forms (`p.3`, `cl.4.2`, `p.3 cl.4.2`, …) are stated and parsed by the new `parsePageOrClauseRef`; a `page` or `clause_ref` that names another page or clause than a readable `page_or_clause_ref` is refused. (4) The rule for `PackStampEvidence.certificate_document_id` is stated: a document the lender shared for the same application, not necessarily listed in the pack; the schema still refuses only the stamped document naming itself.

## 1.44.0

### Minor Changes

- d4636a3: `@infrabyx/contracts/aadhaar` (Udofin PR-UDF-063, R1-D-242), additive; the default reading is unchanged and stays strict.

  - `findAadhaarLike(text, { allow })` and `holdsAadhaarLike`: an opt-in list of look-alikes to let through, `AADHAAR_LOOK_ALIKES` = `e164_in` (`+91` and ten digits, ungrouped, the `+` starting a token; `91dddddddddd` without the `+` is still a find) and `decimal` (an ungrouped run with a `.` right before or after it and a digit beyond the `.`). Default none: every look-alike is still a find. An unknown name throws `TypeError`. Letting one through is the product's choice and its risk: an Aadhaar number written that way is then missed.
  - `AADHAAR_FIELD_NAMES`, `isAadhaarFieldName(name)` (any case and separators: `aadhaar_number`, `aadhaarNumber`, `uid_token`, `uid`, ...; not `aadhaar_last_digits` or `uid_kind`), `holdsAadhaarFieldValue(value)` and `findAadhaarNamedFields(json)`: fields named like an Aadhaar carrier that hold a value, by key path, never the value. Also on the package root.

- ae319d5: A customer step-up for sensitive borrower actions (Udofin PR-UDF-056; R1-D-244). New `CUSTOMER_ACR_VALUES` (`otp`), `CustomerAcr`, `CustomerStepUpPolicy` (`acr`, `maxAgeSeconds` 60 to 3600, default 300), `CUSTOMER_STEP_UP_DEFAULT`, `CUSTOMER_STEP_UP_MAX_AGE`, `CustomerStepUpAction`, `customerStepUpPolicies(table)` (validates and freezes a product's table at boot) and `CustomerStepUp`. `CustomerIdentityPort` gains optional `startStepUp` and `confirmStepUp`, and `verifyRequest` an optional `fresh` flag; `VerifiedCustomerClaims` gains an optional `auth_time`, and its `acr` is now the platform's customer level. An adapter without the new methods refuses with IPB-PORT-001 `unsupported`; nothing existing changes for implementers.
- 98a1d62: PR-UDF-054 (E8; R1-D-245): recording a stamp the regulated entity already paid for. Additive: no existing field, type or export changes shape, and existing ESTAMP adapters and fakes compile unchanged.

  - **`EstampPort.recordCertificate?(req, idempotencyKey, call?)`** (optional; `capabilities.recordCertificate`): records an e-stamp certificate, a franking impression or physical stamp paper bought through the RE's own channel. Not a money call: nothing is bought, and an adapter that offers it refuses `purchase` with the fixed label `STAMP_PURCHASE_NOT_PERMITTED` (`purchase_not_permitted`).
  - **`StampCertificateRecord`** (strict, REGULATED): `channel` (`STAMP_RECORD_CHANNELS`: `E_STAMP`, `FRANKING`, `PHYSICAL_PAPER`, the evidence's names), `state`, `instrument` (the Stamp Act article), `certificateNumber` (`StampCertificateNumber`, the evidence's rule), `dutyMinor`, `statedDutyMinor?` (the duty paid is never less), `issuedAt`, `purchaser`, `stampedDocument`, `certificateDocumentId?`, `vendorLicence?`, `vendorCertificateId?` and `recordedBy` (`StampRecorder`: a user or a service, never an agent). Paper and franking require the licence and the scanned certificate. `StampRecordKey` is the idempotency-key rule, and `assertStampRecord(port, raw, key, adapter?)` the first check of every adapter and fake: an agent recorder `IPB-SEC-004`, deficient stamping `IPB-PORT-001` `deficient_stamping`, anything else malformed `IPB-PORT-001` `invalid_request`.
  - **`EstampCertificate`** gains optional `channel`, `statedDutyMinor`, `stampedDocumentSha256`, `certificateDocumentId`, `vendorLicence`, `vendorCertificateId` and `verification` (`STAMP_VERIFICATIONS`: `ISSUER_READBACK`, `MANUAL_RECORD`, usable as `EStampCompleted.stamp_verification_method`).
  - **`stampEvidenceOf(cert)`** (`@infrabyx/contracts/events`): a recorded certificate as the pack's `PackStampEvidence` (State `MH` becomes `IN-MH`), parsed, so incomplete or deficient evidence throws.

## 1.43.0

### Minor Changes

- f0edee3: Named tenant key status (Udofin PR-UDF-068; R1-D-239). `contracts`: optional `StoragePort.keyRefStatus(tenantId, keyRef, { bucketClass, compartment?, describeKey? })` answering `{ status: "resolves", keyState? }` or `{ status: "refused", reason, keyState? }` with a write's refusal label or `storage_key_unavailable`, never a key id; `STORAGE_KEY_STATES`, `STORAGE_KEY_UNAVAILABLE`, `isValidStorageTenantId` and `storageKeyRefStatusRefusal`. `connectors`: `S3Storage.keyRefStatus` runs the write's own checks and, with `describeKey`, one read-only KMS `DescribeKey` (a key that is not `Enabled`, or that the role may not describe, answers `storage_key_unavailable`); `MinioStorage` declares it `unsupported`. `fakes`: `MemoryStorage.keyRefStatus` and a `keyStates` option. `testing`: a STORAGE built-in contract case. Read-only, not ledgered; no setting, no migration.
- 2d2729b: Named tenant keys in QUARANTINE (Udofin PR-UDF-066; R1-D-240). `contracts`: `NAMED_KEY_CLASSES` now includes `QUARANTINE`, so a lender's upload can be written under the lender's key (by `keyRef` or a prefix map) before its scan; `AUDIT`, `GENERAL` and `PUBLIC_ASSETS` still refuse a reference. New `promotedObjectMeta(from, to)` carries the reference into the clean write after the scan, so the copy is under that reference's key at the clean location or refused, never under the clean class's key. `connectors`: the `s3` adapter applies the same separation rules in `QUARANTINE`; the AV adapter's workload needs `kms:Decrypt` on each such key, and a read it may not decrypt keeps the file quarantined (`ERROR`). `testing`: a STORAGE built-in contract case for the upload and its promotion. No setting, no migration, no IAM change.

### Patch Changes

- 9be2fc7: `ports/pdf-text`: the refusal list names `IPB-KMS-001` `storage_key_unavailable` for a STORAGE read refused because the file's named tenant key is disabled or no longer granted, and `IPB-PORT-002` `unavailable` for any other read failure (Udofin PR-UDF-067; R1-D-241). Documentation only; no type or schema changes.

## 1.42.0

### Minor Changes

- a38f921: PR-UDF-061 items 12 to 17 and the owner's approval of PR-047 (Ecosystem Spec v1.6 proposal), 20 Nov 2026 18:50 IST (R1-D-236). Additive: no existing field, type or export changes shape.

  - **Regulated from v1.6:** `ExecutionPackIssued` and `CoolingOffExitAnswered` join `REGULATED_MESSAGE_EVENTS` (59 names). A consumer of either now verifies its detached JWS (`X-Infrabyx-JWS`) and refuses it unsigned with `signature-invalid`, as for the other regulated messages; a lender signs both from this minor.
  - **New §6.2 event `ExecutionPackIssued`** (`in.infrabyx.origination.ExecutionPackIssued.v1`, FX → UD, key `(pack_id, version)`, signed): `ExecutionPackIssuedData` with the accepted KFS (`kfs_version`, `kfs_sha256`, which a `KFS` document in the pack must match), `documents[].instrument_code` (required on an executed document; an IT Act First Schedule instrument, `IT_ACT_FIRST_SCHEDULE_INSTRUMENTS`, is never executed by eSign or DSC) and `enclosure_code`, `covenant { business_purpose, declared }` with `covenant_declaration` present exactly when declared and required for a business purpose, `enclosure_list [{ code, clause_ref }]` (each furnished by exactly one pack document), per-document `stamp_evidence` (`PackStampEvidence`: channel, certificate number, State, duty, stated duty, stamped-document hash, issue time, vendor certificate id, certificate document), the pack-level `not_stampable [{ document_id, reason }]`, and `signers` as the `PACK_SIGNER_ROLES` enum. `CF_PARA_9_3_DOCUMENT_KINDS` names the CF para 9(3) set. `ExecutionPackManifest` is unchanged and now documented as the deprecated interim carrier.
  - **Subjects (§3.2):** each `ORIGINATION_EVENTS` entry names its `subject` field (the aggregate: `application_id` for the origination events that carry it, `lsp_application_ref` for `ApplicationSubmitted` and `BorrowerAccepted`, `loan_id` for the loan events) and, where that field is optional, a `subjectFallback`; `originationSubject(name, data)` answers it; `DOCUMENT_EVENTS.DocumentShared.subject` is `document_id`. `seq` counts per subject.
  - **Documents:** `DocumentSharedData.language` (optional, BCP 47); `DocumentRetrieval` takes optional `media_type`, `size_bytes`, `type` and `application_id` (the fields a v2 document JWS binds); the doc comment states when `application_id` may be omitted.
  - **`KFSIssued` and `SanctionLetterIssued`:** optional `document_version` beside `document_ref`.

  No setting, no migration.

- dbb08e6: Deleting the verified email (owner answer #161 (3); R1-D-235): new optional `CustomerIdentityPort.eraseVerifiedEmail({ tenantId, userId, requestRef })`, returning `{ erased }`, for the borrower's erasure request; `retireLogin` now documents that it deletes the verified email at account closure. An adapter without the method refuses with IPB-PORT-001 `unsupported`; nothing existing changes for implementers.

### Patch Changes

- 2cb5b3f: `notifyStaff` (and `enqueueStaff`) answer `recipients` sorted by principal id on the first call and on every replay of the same idempotency key, and `deliveryReceipt` lists its recipients in the same order (R1-D-234). Before, a replay returned the recipients in delivery-id order, and ULIDs made in the same millisecond are not ordered, so a replay could list the same people in a different order. Who is notified, and how many times, is unchanged.

## 1.41.0

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

## 1.40.0

### Minor Changes

- 053e16a: Borrower email with byte-identical attachments and a delivery receipt, and the verified email (Udofin PR-UDF-055; R1-D-224). `contracts`: `NotificationRequest.attachments` (`NotificationAttachment`: STORAGE key, SHA-256, file name, PDF, PNG or JPEG; at most 10), `DeliveryRecord.vendorRef` and `DeliveryRecord.attachments` (the receipt), `EmailMessage.files` (`EmailAttachment`: verified bytes, sent unchanged, only to an adapter with `attachments: "native"`), `EMAIL_ATTACHMENT_LIMITS`, `EMAIL_ATTACHMENT_MEDIA_TYPES`, `emailAttachmentTypeOf`, `attachmentExtensionFits`; optional `CustomerIdentityPort.startEmailVerification`, `confirmEmailVerification` and `verifiedEmail` (`VerifiedCustomerEmail`). `config`: the settings `ntf.email.attachments.enabled` (tenant), `ntf.email.attachments.confidential` and `int.identity.customer.email_capture.enabled` (platform), all off. `notify`: attachments read from STORAGE at send and checked (class, type, SHA-256, 10 MiB) before the adapter; the receipt in `deliveryStatus`; migration `0008_email_attachments` (two nullable columns; expand-only). `connectors`: `ses` and `brevo` take `files` and check each SHA-256 again; the verified-email capture in the customer IDENTITY adapters (`emailCapture` option, `readCustomerEmailCapture`, `CustomerAuthStore.saveVerifiedEmail` and `verifiedEmail`, optional); migration `0015_customer_verified_email` (expand-only). `testing`: the SES and Brevo stubs record each attachment's SHA-256. Everything is off by default; nothing existing changes. Apply `notify/0008` and `connectors/0015` before turning either feature on.
- ce8ca22: Owner answers of 20 Nov 10:50 (R1-D-229), all optional and additive. `contracts/events`: `KfsIssuedData.loan_amount_paise` (the KFS "Loan amount", integer paise, distinct from the net disbursed amount; PR-UDF-051); `ExecutionPackManifest.disbursement_clause { document_id, page_or_clause_ref, amount_stated_paise }`, whose document must be in the pack (PR-UDF-053); `SecurityIncidentNotifiedData.cert_in_category` (`CERT_IN_INCIDENT_CATEGORIES`, CERT-In Directions Annexure I) and `cert_in_report_by` (at most `detected_at` + 6 h), with `certInReportBy(noticedAt)` and `CERT_IN_REPORT_WINDOW_MS`, carried by `securityIncidentClockCopy` (PR-FBX-51, #159 (a)). `connectors`: a `tenantNamedKmsKeyIds` value may be `{ keyId, bucketKey?: boolean }` (`NamedKmsKey`); `bucketKey: false` writes and presigned uploads under that reference with S3 Bucket Keys off (a KMS request per object operation); the string form is unchanged, Bucket Keys on (PR-UDF-058, #165 (3)). `fakes`: `FakeLender` sends the KFS loan amount and the manifest's disbursement clause. `testing`: two lender contract cases for them; the GRC incident case sends the CERT-In fields.
- b135555: No-cache presigned downloads (Udofin PR-UDF-060; R1-D-230). `connectors`: a presigned `get` of a `REGULATED` or `CONFIDENTIAL` object (compartments included), on `s3` and `minio`, signs the response overrides `response-cache-control=no-store, private` and `response-expires=Thu, 01 Jan 1970 00:00:00 GMT`, so the store answers with `Cache-Control: no-store, private` and a past `Expires` and devices and webviews keep no copy; the overrides follow the bucket the URL reads from and cannot be dropped by a caller. Other classes and upload URLs are unchanged. S3 has no `Pragma` override: `Cache-Control: no-store` supersedes it for HTTP/1.1 clients. `contracts`: `NO_CACHE_PRESIGN_CLASSES`, `PRESIGN_NO_CACHE` and `presignNoCache`. `fakes`: `MemoryStorage` adds the same parameters to its download URLs. `testing`: a STORAGE contract case checks the URL and, on HTTP stores, the headers returned. No setting, no migration.
- 48810fd: Staff and RE-administrator notifications by role (Udofin PR-UDF-052; R1-D-222). `contracts`: a staff class (`NotificationClass.audience: "staff"`, `subject_variables`; in-app and email only, declared variables, never marketing; `STAFF_CHANNELS`), `StaffRole`, `StaffNotificationRequest`, `StaffSendResult`, `DeliveryReceipt`, the optional `NotifyPort.notifyStaff` and `deliveryReceipt`, and the error `IPB-NTF-007`. `notify`: `notifyStaff` and `enqueueStaff` find the active holders of the roles (or of an `FN:` function) in the context's tenant at send time and send a staff class whose variables carry no personal data and whose subject carries only references; nobody holding the roles is a recorded `no_recipients` outcome; `deliveryReceipt` gives each recipient's delivery states; `lintEmailTemplate` takes `subjectVariables` (`lintOptionsFor`), and `lintStaffTitles` checks staff titles at start. `send` and `enqueue` refuse a staff class; nothing existing changes otherwise. No migration, no setting.
- 1ffb012: Owner's addendum of 20 Nov 13:10 (R1-D-231), all optional and additive. `contracts/events`: the shared offer schema is exported as `OriginationOffer` and takes `monthly_instalment { amount_paise, frequency }` (`INSTALMENT_FREQUENCIES`), `penal_charges` (`PenalCharge`, at most 20: a basis code, exactly one of `rate_bp` or `amount_paise`, a description; `PENAL_CHARGE_BASES`, [VERIFY] against RBI's Penal Charges directions) and `kfs_link { document_id, version? }` (a document reference, never a URL) (PR-UDF-051); each `ExecutionPackManifest.documents[]` item takes `stamp_evidence` (`StampEvidence`: `STAMP_EVIDENCE_MODES` `ESTAMP`, `PAPER`, `FRANKING`, State, certificate number, duty in paise, stamped document SHA-256, optional vendor reference; `STAMP_EVIDENCE_MODE_OF` maps the pack-level `STAMP_MODES`) and `not_stampable` with `not_stampable_reason`, refused with stamp evidence or `stamp_required: true` (PR-UDF-053). `fakes`: `FakeLender`'s offers carry an EMI and a penal charge, its sanctioned offer a KFS link, its loan agreement stamp evidence and its KFS `not_stampable`. `testing`: two lender contract cases for them.

## 1.39.0

### Minor Changes

- 5fd012a: Documents by reference, the eSign and eStamp evidence and the lender execution-pack manifest (Udofin PR-UDF-053; R1-D-219). `contracts/events`: `DocumentSharedData` and `DOCUMENT_EVENTS` (Ecosystem Specification §6.13), `DocumentRetrieval` for `GET /v1/documents/{id}` (an India-hosted `https` URL valid at most 15 minutes, `DOCUMENT_URL_MAX_TTL_SECONDS`), `ESignCompletedData` and `EStampCompletedData` (§6.2, signed; added to `ORIGINATION_EVENTS`, so `ORIGINATION_REGULATED` now lists six), and `ExecutionPackManifest` (documents and kinds, execution mode, stamp details, summary-box page, covenant declaration, countersignature rule), shared as a document of type `EXECUTION_PACK_MANIFEST` until the Specification names a carrier (platform request PR-047). `crypto`: `signDocumentJws` and `verifyDocumentJws`, the C-22 detached JWS (`typ: ipb-document+jws`) over `{ document_id, version, sha256 }`. `fakes`: `FakeLender` shares the KFS, sanction letter, loan agreement and manifest after a sanction (`sharedDocuments()`, `getDocument`, `fetchDocument`, `executionPack`) and takes the LSP's signed `ESignCompleted` and `EStampCompleted` (`eSignCompleted`, `eStampCompleted`), verified against the new `lspKeys` option; `outbox()` is unchanged. `testing`: `lspSigner()` and four more `lenderContractCases({ lsp })`. Nothing existing changes meaning.
- 3b57c29: The GRC port and the §6.15 GRC events (Finbyx PR-FBX-51; R1-D-220; ADR-0013). `contracts/events` adds the v1 data schemas `ControlTestResultPublishedData`, `ComplianceIssueRaisedData`, `ReturnStatusUpdatedData`, `PolicyAttestedData` and `SecurityIncidentNotifiedData` with their type constants (`in.infrabyx.grc.<Event>.v1`) and enums, `GRC_EVENTS` (type, schema, idempotency fields, direction, regulated; with `EvidenceSubmitted` and `ObligationPublished`), `grcIdempotencyKey`, `grcPersonalDataProblems` (every schema refuses an Aadhaar-like number or a PAN anywhere in the data), `GRC_MASKED_ID`, `RETURN_PERIOD` and `securityIncidentClockCopy` (the OH13 copy). `contracts/ports` adds `GrcPort` on the Ecosystem Spec §9.2 generic connector contract: `listObligations({ updatedSince?, cursor?, limit? }, call?)` → `{ items: GrcObligation[], nextCursor? }` and `publishControlTestResult`, `submitEvidence`, `raiseIssue`, `notifyIncident`, `updateReturnStatus`, `recordPolicyAttestation` (the event data, `call?`) → `GrcReceipt`, with `GRC_POST_METHODS`, `GRC_REFUSALS`, `grcRefusal`, `assertGrcClass`, `prepareGrcPost`, `prepareGrcObligationQuery` and the catalogue entry (tier 2, `int.grc.`, in `R1_PORTS`). Every POST is keyed (the caller's key, else the event's own); the same key and body answer the same receipt, another body is `IPB-PORT-004`; incident updates are taken in `update_seq` order (`out_of_order`); a call above CONFIDENTIAL and any personal data are `IPB-PORT-003`. `config` registers `int.grc.generic.enabled` (false) and `int.grc.generic.host` (empty). `connectors` adds `@infrabyx/connectors/grc`: `GenericGrc` (`generic-grc`), the §9.2 REST contract to one configured host with a bearer token from SECRETS, stub-shaped where §9.2 is silent, off and unproven; its router method table and exit entry. `fakes` adds `FakeGrc`, `GrcFixtures` and `grcFakeFixtures`; `testing` adds `grcContractCases`, `grcSamples`, `grcObligations` and `startGrcStub`. No migration; nothing existing changes.
- 4d509e6: STORAGE puts under a named tenant key (Udofin PR-UDF-058; R1-D-227), so a vault keeps each lender's files under that lender's own KMS key. `contracts/ports`: optional `ObjectMeta.keyRef` and `PresignOptions.keyRef` (a reference such as `lender:<id>`, never a key id), `isValidStorageKeyRef`, `NAMED_KEY_CLASSES` (`CONFIDENTIAL`, `REGULATED`), `STORAGE_KEY_REF_META`, `STORAGE_KEY_REF_REFUSALS` and `resolveStorageKeyRef`. `connectors`: `S3StorageOptions.tenantNamedKmsKeyIds` and `tenantKeyRefPrefixes`; a named write is encrypted under the resolved key, records the reference (`get` returns `meta.keyRef`), and is refused (never sent under the class key) for an unknown, malformed, misplaced, shared or changed reference or for a tenant with its own CMK; a disabled or revoked named key reads as `IPB-KMS-001` `storage_key_unavailable` (failures of objects under platform keys are unchanged); `minio` refuses a reference as `unsupported`. `fakes`: `MemoryStorage(now, { keyRefs, keyRefPrefixes })` records the reference (none known by default). `testing`: a built-in STORAGE contract case for named keys; a STORAGE adapter outside the platform either configures `lender:contract` and `lender:contract-b` for tenant `tnt_contract` in `REGULATED` in its contract leg or declares `put.keyRef` unsupported. Writes without a reference are unchanged.

## 1.38.0

### Minor Changes

- 3c4b588: The origination contract of Ecosystem Specification §6.2 and §6.3 and a mock lender (Udofin PR-UDF-051; R1-D-217). `contracts/events`: `EligibilityCheckRequest` and `EligibilityCheckAnswer` for the synchronous `POST /v1/eligibility-checks` (3 s budget, `lender_unavailable` past it), the v1 data schemas of `ApplicationSubmitted`, `ApplicationStatusChanged`, `AdditionalInfoRequested`, `DecisionMade`, `KFSIssued`, `SanctionLetterIssued`, `BorrowerAccepted`, `CoolingOffExitRequested` and `LoanDisbursed`, `ORIGINATION_EVENTS` (type, schema, idempotency fields, direction, regulated), `ORIGINATION_REGULATED` and `originationIdempotencyKey`. `crypto`: `localRegulatedSigner(kid)`, an ES256 signer on an in-memory key for tests and fakes only. `fakes`: `FakeLender`, which answers the calls, emits the journey's envelopes and signs the regulated ones (`keys` to verify), with `script` and `outbox` hooks. `testing`: `lenderContractCases()` and `lspEvent()`. Nothing existing changes.

## 1.37.0

### Minor Changes

- 82dc7ef: The AA consent's FIU check, approval link and product reference (Udofin PR-UDF-050; R1-D-204). `contracts`: `AaConsentRequest.fiuId?` (the FIU the consent is for, `AA_FIU_ID_REGEX`) and `AaConsentRequest.consentArtefact?` (the product's own `{ kind, id }`, R1-D-203; `consentRef` is unchanged, the required `cpr_` string); `AaConsent.fiuId?` (the FIU the AA reports) and `AaConsent.approvalUrl?` (the AA's customer approval page, only while PENDING); `aaFiuMismatch`, `AA_FIU_MISMATCH` (`fiu_mismatch`), `aaApprovalUrlAllowed` (`https:`, no user information, an exact listed host, and no 12-digit run or Aadhaar-like number once every RFC 9562 UUID is set aside, so an id whose last group is all digits is accepted; owner answer #154), `RFC9562_UUID`, `isRfc9562Uuid` and `AA_APPROVAL_URL_REFUSED` (`approval_url_not_allowed`). When a request names a FIU, a consent the AA reports for another FIU, or for none, is refused `IPB-PORT-001` `fiu_mismatch` (definite) before anything is kept or returned, and so is every later read-back (`consentStatus`, `revoke`, `fetch`, `handleWebhook`); a request without `fiuId` is compared with nothing, as before. `connectors` (`SetuAccountAggregator`): reads the FIU from the consent read-back's `detail.FIU.id`, keeps the asked FIU in `SetuConsentRecord.fiuId`, answers Setu's link as `approvalUrl` while PENDING only after `aaApprovalUrlAllowed` against the new `approvalHosts` option (default Setu's two hosts), reads the consent back before keeping its record so a refused one leaves none, and deprecates `approvalUrl(consentId)`. `fakes` (`FakeAccountAggregator({ fiuId?, approvalHost? })`) reports its own FIU (`fake-fiu`) and a letters-only link while PENDING, with `reportFiu` and `consentsKept` test hooks; `AccountAggregatorFixtures` gains optional `fiuId` and `reportFiu`. `testing` adds the AA contract cases (calls with and without a consent artefact, the FIU refusals, the link only while PENDING, an Aadhaar-like sweep) and the Setu stub's `fiuId`, `reportFiu`, `linkBase` and `nextConsentId` hooks (its ids are any random UUID, an all-digit last group included).
- 1cdbf0f: Aadhaar offline verification names its form (Udofin PR-UDF-039; R1-D-190). `AadhaarOfflineCheck.kind` (`AADHAAR_OFFLINE_KINDS`: `xml_zip`, the default, or `secure_qr`): the ZIP needs its share code, a Secure QR is refused with one; `AadhaarOfflineResult.kind` echoes it. The contract states the stored-object SHA-256 check before any parse or vendor call (`hash_mismatch`) and that no field carries more than the last four digits. Digio refuses `secure_qr` as `unsupported` until its path is checked against UIDAI's Secure QR specification; the fake verifies both forms. `kycContractCases` gains the case.
- 2f9d3f8: Aadhaar OTP e-KYC for a notified reporting entity (Udofin PR-UDF-041; R1-D-194). `KycPort.aadhaarOtpRequest({ uid, uidKind, consent }, call)` returns `{ txn, expiresAt }` with the evidence and `aadhaarOtpVerify({ txn, otp }, call)` returns `{ ekyc, signatureValid, uidLast4 }` with the evidence; both optional on the interface, provided by `FakeKyc`, `DigioKyc`, `IdfyKyc` and `kycMethodRouter` (the new `aadhaar_otp` method). Every call is refused `not_configured` before any vendor call unless the adapter is built with `notifiedEntity: true`. `contracts` adds `AadhaarOtpRequest`, `AadhaarOtpVerify`, `AADHAAR_UID_KINDS`, `AADHAAR_OTP_REFUSALS` (`uid_invalid`, `mobile_not_linked`, `otp_invalid`, `otp_expired`, `not_configured`) and `aadhaarUidValid` (12-digit Aadhaar number with first digit 2 to 9, or 16-digit VID, each with the Verhoeff check; grouped forms refused). The e-KYC response is written to the adapter's STORAGE; one that carries a full number is refused `ekyc_holds_number`. `aadhaarOtpVerify` is idempotent on `call.idempotencyKey` for 24 hours: a retry gets the first answer, the same key with another code or transaction is `IPB-PORT-004`. `connectors` adds `AadhaarOtpVerifyStore`, `PgAadhaarOtpVerifyStore`, `MemoryAadhaarOtpVerifyStore` and the migration `0011_kyc_aadhaar_otp_verify.sql` (`connectors.kyc_aadhaar_otp_verify`, forced RLS); `IdfyKyc` gains `currentTenant`. `fakes` adds `FAKE_AADHAAR_OTP`, `syntheticUid`, `AadhaarOtpFixtures` and `KycFixtures.aadhaarOtp`; `testing` adds five contract cases and the Digio and IDfy stubs' Aadhaar OTP.
- b0e0b72: One no-Aadhaar rule, its scanner and a test-database sweep (Udofin PR-UDF-042; R1-D-195). `contracts` adds the subpath `@infrabyx/contracts/aadhaar`: `findAadhaarLike(text, { letters? })` returns `{ kind: "AADHAAR" | "VID", start, end, masked }` for each 12-digit Aadhaar number (first digit 2 to 9, Verhoeff) and 16-digit VID (Verhoeff), plain or grouped in fours, bounded by a non-digit (a letter or `+` is a boundary; `letters: "join"` makes a letter part of the run), masked to the last four digits; also `holdsAadhaarLike` and `AADHAAR_LIKE_KINDS`. `verhoeffValid` moves there and is re-exported unchanged from the root and `./search-refusal`. `testing` adds `startPostgres({ beforeDrop(admin) })` (run by `end()` before the drop; a throwing hook still drops the database, then `end()` rejects with its error), the `infrabyx-aadhaar-scan` bin (exit 1 on a find, 0 on none, 2 on a usage error; masked output only), and `scanTextForAadhaar`, `scanPathsForAadhaar` and `scanDatabaseForAadhaar` (also as `@infrabyx/testing/aadhaar-scan`). `ai`'s scrubber uses the shared rule for its AADHAAR detector: a 16-digit VID is now tokenised as `AADHAAR`, and twelve digits right after a `+` are no longer missed; `verhoeffValid` keeps its behaviour. `connectors`' e-KYC check (`holdsAadhaarNumber`) uses the shared rule with `letters: "join"` and now also refuses a grouped number.
- 9e626ef: Bank account checks by mode, keyed retries and the penny-drop funding statement (Udofin PR-UDF-043; R1-D-196). `BankAccountCheck` gains an optional `mode` (`"pennyless"` or `"penny_drop"`, `BANK_ACCOUNT_MODES`) and `BankAccountResult` an optional `mode` (the mode used; always set by the platform's adapters and the fake). An adapter that cannot honour the mode asked refuses `IPB-PORT-002` with `meta.reason: "mode_unsupported"` (`BANK_ACCOUNT_MODE_UNSUPPORTED`) before any vendor call, never falling back to another mode; omitted, the adapter's configured mode is used and reported. `bankAccountVerify` is idempotent on `call.idempotencyKey` for 24 hours: a retry gets the first answer with no vendor call, and the same key with another account, IFSC, name or mode is `IPB-PORT-004`; a keyed penny drop whose first call did not finish is never sent again (`pending_unresolved`). The status set is unchanged (`BANK_ACCOUNT_STATUSES`). `contracts` adds `KYC_ADAPTER_FUNDING` and `kycAdapterFunding(adapter)`: per adapter, who funds a penny drop (`provider`, `tenant` or `unknown`) and the source, a statement only; Digio and IDfy are `unknown` until verified. `DigioKyc` and `IdfyKyc` now provide pennyless bank account checks (stub-shaped, adapters off) and refuse a penny drop `mode_unsupported`; `connectors` adds `BankAccountVerifyStore`, `PgBankAccountVerifyStore`, `MemoryBankAccountVerifyStore`, `keyedBankAccountVerify` and the migration `0012_kyc_bank_account_verify.sql` (`connectors.kyc_bank_account_verify`, forced RLS); `kycMethodRouter` moves a check past an adapter that refuses `mode_unsupported`, but not a keyed check or a penny drop past an unavailable one; the router's breaker no longer counts `mode_unsupported`. `FakeKyc` honours both modes (options `bankAccountModes`, `bankAccountMode`) and counts `bankAccountVendorCalls`; `fakes` adds `KycFixtures.bankAccount` (`BankAccountFixtures`); `testing` adds four contract cases and the Digio and IDfy stubs' bank accounts.
- aac1c2c: A product's own consent artefact beside the bureau consent receipt (Udofin PR-UDF-049; R1-D-203, owner answer #153). `BureauPullRequest.consentRef` is unchanged (the required `cpr_<ULID>` string), so no caller or adapter outside the platform needs a change. New optional `BureauPullRequest.consentArtefact: { kind, id }`, the product's own purpose-consent artefact for the same pull, and `BureauReport.consentArtefact?`, echoed only when the request carried one (an answer to a pull without it is exactly as before). `contracts` adds `ports/consent-ref`: `ConsentReceiptRef` (the `cpr_` string), `ConsentArtefact` (strict `{ kind, id }`: `kind` one to four dot-separated `[a-z][a-z0-9_]*` segments, 3 to 64 characters, `cpr` and `cns` reserved; `id` 3 to 128 characters of `[A-Za-z0-9._-]`, not a platform `cpr_`/`cns_` id; neither may hold a standalone run of 10 or more digits, an Aadhaar-like number (`findAadhaarLike`) or a standalone PAN-shaped run; each refusal a fixed label from `CONSENT_ARTEFACT_REFUSALS`), `consentArtefactProblem`, `consentInForce` (the artefact as `<kind>:<id>` when present, else `consentRef`) and `consentEcho`. The platform checks an artefact's shape only; the product asserts the consent behind it. Neither is sent to the CIC. `fakes` (`FakeCreditBureau`) and `connectors` (`CibilBureau`, whose pull record keeps `consentArtefact?` beside `consentRef`) accept and echo both; `testing` adds contract cases for calls with and without an artefact and the refusals, `contractConsentArtefact` and `malformedConsentArtefacts`.
- d58d5f0: DigiLocker start, document evidence and idempotent pulls (Udofin PR-UDF-040; R1-D-193). `KycPort.startDigilocker({ docTypes, returnUrl }, call)` returns `{ consentSession, signInUrl, expiresAt }` with the evidence; optional on the interface, provided by `FakeKyc`, `DigioKyc` and `kycMethodRouter`, refused `unsupported` by `IdfyKyc`. The return address must pass `digilockerReturnUrlAllowed` (`https:`, no user information, no 12-digit run, a host on the adapter's `digilockerReturnHosts`), else `return_url_not_allowed`. `DigilockerDocument` gains `evidence` and `signatureValid` (`null` when the vendor does not report it). `digilockerPull` is idempotent on `call.idempotencyKey` for 24 hours: a retry returns the stored documents instead of `consent_used`, the same key with another session or other types is `IPB-PORT-004`. `connectors` adds `DigilockerPullStore`, `PgDigilockerPullStore` and `MemoryDigilockerPullStore` and the migration `0010_kyc_digilocker_pull.sql` (`connectors.kyc_digilocker_pull`, forced RLS); the Digio stub gains the start and `completeDigilocker`; `kycContractCases` gains three cases and `KycFixtures.digilockerReturnUrl`.
- dbaecff: V-CIP webhooks verified without a vendor call (Udofin PR-UDF-046; R1-D-199). `KycPort.verifyWebhook(rawBody, headers, meta?) → { eventId, vcipId, receivedAt }` (`KycWebhookReceipt`), optional on the interface, checks a webhook's size, signature, window and replay only, with no vendor call and no read-back, so a product answers 401 to an unverified event, records `eventId` in its module inbox, acknowledges within 2 s and reads the session back with `vcipStatus` from its queue (IPB-10-27). `handleWebhook` keeps its signature and, where `verifyWebhook` exists, is `verifyWebhook` and then `vcipStatus`. `contracts` adds `verifyKycWebhookWith` (the order: the body's size, at most `KYC_WEBHOOK_MAX_BODY_BYTES` (64 KiB) before anything is read; the Standard Webhooks headers; the signature and `KYC_WEBHOOK_TOLERANCE_SECONDS` (300) window; the replay claim on the delivery's id and timestamp; then the session id), `KYC_WEBHOOK_REFUSALS` (`body_too_large`, `signature_invalid`, `timestamp_stale`, `event_replayed`; `IPB-API-018`, definite), `kycWebhookRefused`, `KYC_WEBHOOK_MALFORMED` (`IPB-PORT-001` for a verified event naming no session) and `KycWebhookReplayStore`. `crypto` adds `verifyStandardWebhook` (C-13: HMAC-SHA-256 over `<id>.<timestamp>.<body>` as IPB-10-21 defines it, constant time, ±5 minutes, `whsec_` secrets, rotation, `v1` only) and `signStandardWebhookForTest`; no new algorithm. `FakeKyc` verifies Standard Webhooks (`FAKE_KYC_WEBHOOK`, `signFakeKycWebhook`, option `webhook: { secrets, replay }`, `vcipStatusVendorCalls`), and its `handleWebhook` now refuses an unsigned event. `KycFixtures.webhook` (optional) drives two new contract cases. `connectors` adds `standardWebhookKycVerifier` for an adapter whose provider signs with Standard Webhooks; `DigioKyc` and `IdfyKyc` refuse `verifyWebhook` `unsupported`; `kycMethodRouter` routes it under `vcip`. **Products: `FakeKyc.handleWebhook` and `verifyWebhook` now refuse an unsigned delivery, so a test that posts an event to the fake must sign it with `signFakeKycWebhook(body)` (from `@infrabyx/fakes` or `@infrabyx/testing`) and pass the headers it returns.** C-13 covers Standard Webhooks v1 by the owner's approval (R1-D-210); RFC 9421 is not approved.
- 80a843a: Liveness by mode, applied thresholds, keyed retries and the template retention statement (Udofin PR-UDF-044; R1-D-197). `LivenessCheck` gains an optional `mode` (`"passive"`, `"active_gesture"` or `"active_voice"`, `LIVENESS_MODES`) and `ScoreResult` an optional `threshold` (the threshold the adapter applied, for liveness and face match) and `mode` (the liveness mode used); the platform's adapters and the fake always set them. An adapter that cannot honour the mode refuses `IPB-PORT-002` with `meta.reason: "mode_unsupported"` (`KYC_MODE_UNSUPPORTED`, which `BANK_ACCOUNT_MODE_UNSUPPORTED` now equals) before any vendor call, never falling back; omitted, the configured mode is used and reported. `livenessCheck` and `faceMatch` are idempotent on `call.idempotencyKey` for 24 hours, a key scoped to its method: a retry gets the first answer with no vendor call, and the same key with other frames, another mode or other images is `IPB-PORT-004`. `score` is a finite number from 0 to 1 (`kycScoreValid`): an adapter normalises a vendor score on its known scale and refuses any other `IPB-PORT-003` with `meta.reason: "score_out_of_range"` (`KYC_SCORE_OUT_OF_RANGE`), never clamping. `contracts` adds `KYC_ADAPTER_RETENTION` and `kycAdapterRetention(adapter)`: per adapter, whether the vendor keeps a face template or embedding beyond the call (`none`, `kept` or `unknown`) and the source, a statement only; Digio and IDfy are `unknown` until a written vendor statement. `IdfyKyc` honours `passive` liveness only (its photo liveness), reports its thresholds (now checked to be from 0 to 1), reads scores on the scale `IDFY_SCORE_SCALE` (1, or the option `scoreScale: 100`) and refuses one off it instead of guessing the scale and clamping; `DigioKyc` has no liveness or face-match path and still refuses both `unsupported`. `connectors` adds `KycScoreCheckStore`, `PgKycScoreCheckStore`, `MemoryKycScoreCheckStore`, `keyedScoreCheck`, `livenessMode`, `scoreOnScale` and the migration `0013_kyc_score_check.sql` (`connectors.kyc_score_check`, forced RLS; no image, template, embedding or storage reference in clear); `kycMethodRouter` moves any call past `mode_unsupported` and keeps a keyed liveness check or face match with an unavailable adapter. `FakeKyc` honours every liveness mode (options `livenessModes`, `livenessMode`, `livenessThreshold`, `faceMatchThreshold`), counts `livenessVendorCalls` and `faceMatchVendorCalls`, and `offScaleNext()` makes its next score off the scale; `fakes` adds `KycFixtures.scores` (`ScoreFixtures`); `testing` adds seven contract cases and the IDfy stub's `livenessChecks`, `faceMatches` and `scoreOnce`.
- 1cdbf0f: `toProblem` carries two safe RFC 9457 members (Udofin PR-UDF-038; R1-D-189): `reason`, the error's `meta.reason` when it is a fixed snake-case label, and on a 429 or 503 `retry_after_seconds` from `meta.retryAfterSeconds` (whole seconds, 1 to 86400). `problemHeaders(problem)` returns the matching `Retry-After` header. The rest of `meta` stays inside the platform.
- ff2a74b: The STATEMENT_ANALYSIS port, its adapters and its fake (Udofin PR-UDF-048; R1-D-202; ADR-0012). `contracts` adds `StatementAnalysisPort`: `analyse({ subjectRef, inputs: [{ fiType, storageKey, sha256 }], reportPrefix }, call?) → StatementAnalysis` (`analysisId` `sta_<ULID>`, `state` `COMPLETED`, `PENDING` or `FAILED`, `report?: { storageKey, sha256 }`, `failureReason?`, `adapter`, `method`, `vendorRef`, `checkedAt`), `status(analysisId, call?)` and `handleWebhook(rawBody, headers, meta?)`, with `StatementAnalysisRequest` (strict; STORAGE references and SHA-256s only, up to 24 inputs in the report prefix's tenant, no Aadhaar-like subject reference; every field REGULATED), `StatementAnalysisResult`, `statementAnalysisResultOnly`, `STATEMENT_ANALYSIS_FAILURES`, `STATEMENT_ANALYSIS_REFUSALS`, `assertStatementAnalysisClass`, `statementInputFormat`, the catalogue entry (tier 2, `int.statement_analysis.`, in `R1_PORTS`), the `sta` id prefix and `PORT_DEFAULT_DATA_CLASS.STATEMENT_ANALYSIS = "REGULATED"`. `config` registers `int.statement_analysis.platform.enabled`, `int.statement_analysis.http.enabled` (both false) and `int.statement_analysis.http.host` (empty). `connectors` adds `@infrabyx/connectors/statement-analysis`: `PlatformStatementAnalyser` (`platform-statement`, the reference: in-platform, no vendor or egress, a checksum-summary report and nothing from a statement's content) and `HttpStatementAnalyser` (`http-statement`, a vendor-neutral HTTP alternative, every vendor shape stub-shaped), both off and refusing `handleWebhook` `unsupported`; `StatementAnalysisStore`, `PgStatementAnalysisStore`, `MemoryStatementAnalysisStore` and the migration `0014_statement_analysis.sql` (`connectors.statement_analysis`, forced RLS, hashes and references only, 24 hours); keyed retries answer the same analysis with one analyser call and the key with another request is `IPB-PORT-004`; an input outside the REGULATED class, or a call class other than REGULATED, is `IPB-PORT-003` before any analyser call, and the router's method table refuses an instance that cannot carry REGULATED. `fakes` adds `FakeStatementAnalysis` (its webhook signed with the approved C-22 profile under a development key), `signFakeStatementAnalysisNotification`, `fakeStatementAnalysisWebhookKeys` and `StatementAnalysisFixtures`; `testing` adds `statementAnalysisContractCases`, `statementAnalysisFakeFixtures`, `contractStatement`, `startStatementAnalysisStub` and the ESLint plugin's port default. Run `infrabyx-migrate` for `connectors/0014` if you wire the adapters' PostgreSQL store.
- d35f7e9: The RE-hosted V-CIP launcher and its signed hand-off (Udofin PR-UDF-045; R1-D-198). `KycPort.launchVcip({ context, jws }, call) → { vcipId, launchUrl, expiresAt }` (`VcipLaunch`, with the evidence), optional on the interface, lets an LSP hand a customer to an RE's V-CIP without hosting any V-CIP component. `contracts` adds `VcipHandoffContext` (tenant, RE, LSP, customer reference, journey id, issued-at, expires-at, nonce: ids and times only, strict, at most `VCIP_HANDOFF_MAX_LIFETIME_SECONDS` (900) from issue to expiry, no field with a 12-digit run or an Aadhaar-like number), `LaunchVcip`, `VCIP_HANDOFF_REFUSALS` (`handoff_invalid`, `handoff_replayed`, `handoff_expired`), `vcipHandoffFailure`, `vcipHandoffTimeRefusal`, `vcipLaunchUrlAllowed` (`https:`, the adapter's exact hosts, no user information, no number) and `VCIP_LAUNCH_URL_REFUSED`. The LSP signs the context with the existing `signRegulatedMessage`; the adapter verifies it with `verifyRegulatedMessage` and its replay store before any vendor call (nothing new in cryptography), and refuses `IPB-PORT-001` with a fixed label, definite. `vcipStatus(vcipId, call?)` takes an optional `PortCall` and reads under its tenant. `VcipManifest` gains `reasonCode` (`VCIP_REASON_CODES`) and `liveness.mode` (`LIVENESS_MODES`); the free-text `reason` stays, deprecated, never to be shown. `VcipSession` gains an optional `vcipId` to start a launched session. `FakeKyc` implements the launcher (`FAKE_VCIP_HANDOFF`, `signFakeVcipHandoff`, `fakeVcipHandoffKeys`, `fakeVcipHandoffContext`, `vcipLaunchVendorCalls`); `KycFixtures.vcipLaunch` (optional) drives three new contract cases. `VcipConductor` takes hand-offs (`handoff: { reId, issuers, replay, launchBaseUrl, launchHosts? }`), schedules the session the RE's official starts with `startVcip({ …, vcipId })`, expires it with its hand-off (`launch_expired`), takes a `reasonCode` on `complete` and `drop`, a liveness `mode` on `assess`, and a `PortCall` or tenant on `vcipStatus`. `DigioKyc` and `IdfyKyc` refuse `launchVcip` `unsupported`; `kycMethodRouter` routes it under `vcip` and never moves a launch past an unavailable adapter.

## 1.36.0

### Minor Changes

- 4af2688: Owner answer #132 (4) and (5) (R1-D-187). A reveal names a purpose code (`RevealRequest.purposeCode`; `RevealRule.purposeCodes`, default `REVEAL_PURPOSE_CODES`; refused `purpose_code_invalid`), recorded as the business id `purpose:<code>`. Refused reveals are kept as security audit events in `audit.security_event` (migration `audit/0012`; `PgSecurityEvents`, `SecurityEventSink`), outside the business ledger, never with the value; the threshold-th refusal of one principal within the window raises `RevealRefusalsRepeated` (settings `rules.reveal.refusal_alert_threshold`, `rules.reveal.refusal_alert_window_minutes`). A `revealRule` now requires `securityEvents`, `refusalCounter` and `outbox`. `defineRulesRevealContract` sends a purpose code and checks its refusal.
- 955cc67: TallyPrime agent key notices (owner answer #139 (1); R1-D-186). `TallyAgentService.sendKeyNotices(ctx)` tells the tenant's administrators on day 80 and again on day 85 of an agent's key, once each, through the new platform notification class `accounting.agent_key_expiring` (mandatory, in-app and email); `TallyAgentView.keyNoticeDay`; `TALLY_AGENT_KEY_NOTICE_DAYS` and `TALLY_AGENT_KEY_NOTICE_CLASS`. From day 90 the gateway's 403 says how to re-enrol (`keyExpiredDetail`). Migration `connectors/0009` (expand-only): `tally_agent.key_notice_day`. Help entry `hlp.notify.accounting.agent_key_expiring`.

## 1.35.0

### Minor Changes

- a6929eb: Owner answer #136 (4) (R1-D-184): how a TallyPrime agent keeps its key, and a 90-day key life. `AgentEnrolRequest.keyProtection` (`dpapi` or `file`; omitted by older agents, read as `file`), `TALLY_AGENT_KEY_MAX_DAYS` (90), `TALLY_AGENT_KEY_WARN_DAYS` (80), `TALLY_KEY_PROTECTIONS`; `TallyAgentView` gains `keyProtection`, `keyExpiresAt`, `rotationDue` and `warnings` (`key_unencrypted`, `key_expired`). `connectors`: migration `connectors/0008` (`tally_agent.key_protection`, set once with the key); the enrolment records the protection and, for `file`, a warning in its ledger entry; from day 90 the gateway refuses the agent's requests until it is enrolled again. The agent (1.1.0, built from source) keeps its key under Windows DPAPI for its service account through Windows PowerShell 5.1, with the key on standard input only; the mode-0600 file is the fallback elsewhere. Runbook `docs/runbooks/tally-agent.md`.

## 1.34.0

### Minor Changes

- 3e69471: The TallyPrime agent's wire contract (PR-FBX-46, R1-D-178): the agent API paths and scheme, `accounting.agent.enrol`, `SVC_TALLY_AGENT`, the enrol, job and result schemas, `TALLY_REASON_CODES`, the limits, and the `tga` and `tbr` id prefixes.

## 1.33.0

### Minor Changes

- 34f5e49: Inbound mail replies (PR-LDC-50, R1-D-177): `EmailMessage.replyTo`, `InboundEmail` and the optional `EmailPort.verifyInbound` (capability `inbound: "native"`), `INBOUND_MAIL_LIMITS` and `INBOUND_MAIL_CHARSETS`; `NotificationRequest.reply` (`threadRef`), `InboundReply`, `ReplyAttachment`, `ReceiveRepliesResult` and `INBOUND_DROP_REASONS`; the `NotificationReplyReceived` event (`ntf`) and its data; the `rpl` id prefix; the service reader role `SVC_NOTIFY_REPLY` (`svc_notify_reply`, `notify.reply_token`).

## 1.32.0

### Minor Changes

- 6bb68c1: Web snapshots as evidence (PR-LDC-40, R1-D-176; product guide §7ci). New `WebSnapshotPort` (`archive(ctx, req)`, `get`, `open`, `rescan`), `WebSnapshotRequest`, `WebSnapshot`, `OpenedWebSnapshot`, `WEB_SNAPSHOT_CONTENT_TYPES` (no SVG), `WEB_SNAPSHOT_LIMIT_DEFAULTS` and `_MAXIMA`, `resolveWebSnapshotLimits`, `WEB_SNAPSHOT_MAX_REDIRECTS` and `webSnapshotDownloadHeaders`; the `wsn` id prefix. `EgressPort.fetch` takes the optional `maxRedirects` and `allowHosts` and may answer `finalUrl`, `redirects` and `contentEncoding` (`EgressFetchOptions`, `EgressFetchResult`). Additive.

## 1.31.0

### Minor Changes

- 32097cb: Dated rule parameters (PR-LDC-57, R1-D-175; product guide §7ch). `RuleParameter` is now the union of `SettingRuleParameter` (unchanged: `setting` and `default`) and `ScheduleRuleParameter` (`schedule`, no default), with `isScheduleParameter`. New `ParameterScheduleBody` (`ipb.parameter_schedule.v1`: one `type`, 1 to 500 entries in strictly ascending `effectiveFrom` order, each with `citation: { instrumentRef, section, url? }`, and a `reason` for a correction), `ParameterCitation`, `ParameterScheduleEntry`, `ParameterScheduleSummary`, `ScheduleCitationTrace` and `ParameterBounds`. `Explanation.parameters[i].source` may be `"schedule"`, with `schedule: { key, version, effectiveFrom, citation }`; a decision's `reason` may be `parameter_not_in_force`. Additive: existing bodies parse as before.

## 1.30.0

### Minor Changes

- c79fef5: Types for an entitled reveal of one CONFIDENTIAL input in `explain` (PR-LDC-59, owner answer #130, R1-D-173): `RevealRequest`, the opaque `RevealEntitlement`, `ExplainOptions`, `REVEAL_REFUSALS`, `REVEAL_GRANT_TTL_MS` (60 s) and the purpose bounds (3 to 200 characters). `RulesPort.explain` takes optional `ExplainOptions`, `RulesPort.entitleReveal` is optional, and an explained input may carry `revealed: true`. New error `IPB-RULE-004` (403, reveal refused, `meta.reason` one of `REVEAL_REFUSALS`) and id prefix `rvg` (reveal grant). Additive only.

## 1.29.0

### Minor Changes

- 1089dc7: Two port interfaces: `AccountingSinkPort` on `ACCOUNTING` (PR-FBX-46; `post`, `status`, `replay`, `trialBalance`, `assertBalancedBatch`: balanced integer paise, idempotent on journal id and digest) and `CalendarPort` on `CALENDAR` (PR-LDC-53; PKCE connect, idempotent entries by external id, `calendarPayload` detail levels). Both are catalogued with an interface.
- 1089dc7: `ApprovalRequestInput.levels` (`ApprovalLevelInput`): ordered approval levels on one request (#125, PR-LDC-38).
- 1089dc7: AV port (IPB-01 AV, IPB-02-44; PR-LDC-41): `FileScanPort.scan(ref)` → `CLEAN`, `INFECTED` or `ERROR` with a reason, and `scanDecision`, the fail-closed mapping (only `CLEAN` releases). `AV` is catalogued with an interface. `PortHealth` gains an optional `detail` (snake_case names, scalar values, at most 16) for operational facts such as the AV adapter's signature age.
- 1089dc7: `AuditEntryInput.businessIds`, `BUSINESS_ID_PATTERN` and `MAX_BUSINESS_IDS` (PR-LDC-30).
- 1089dc7: `mfaFloor`, `mfaRequiredBy` and `PLATFORM_MFA_FLOOR` (PR-LDC-55): a tighten-only product MFA floor with SMS-excluded roles. `VerifiedClaims` gains optional `amr` and `acr`.
- 1089dc7: `ObligationPublishedData` and `obligationPublishedProblems` (Ecosystem Spec v1.5 §6.15; PR-LDC-33, owner answer #127): ids and keys only, no other field, `dataclass = INTERNAL`, the obligation as `subject`; `REPEALED` needs `effective_to`.
- 1089dc7: `PdfPort.extractText` (optional; PR-LDC-39): text per page with `needsOcr`, from a file the AV port scanned `CLEAN` (`PdfTextRequest`, `PdfTextResult`), under limits capped by platform maxima (`PDF_TEXT_LIMIT_DEFAULTS`, `PDF_TEXT_LIMIT_MAXIMA`, `resolvePdfTextLimits`). `ScanProof` and `assertScannedClean` for every reader of an untrusted upload.
- 1089dc7: `EvidenceSubmittedData` (§6.15) and `ProviderIncidentData` (§6.16) payload schemas (PR-LDC-45, PR-LDC-51).
- 1089dc7: Storage compartments (PR-LDC-60): `ObjectMeta.compartment` (`BOARD_CONFIDENTIAL`, `SEALED`) within `CONFIDENTIAL` or `REGULATED`. The S3 and MinIO adapters write each compartment to its own bucket under its own SSE-KMS key (platform or tenant CMK) and refuse a missing or shared bucket or key; `int.storage.bucket.{class}.{compartment}`; `MemoryStorage` keeps the compartment.

## 1.28.0

### Minor Changes

- 15be78b: Two port interfaces: `AccountingSinkPort` on `ACCOUNTING` (PR-FBX-46; `post`, `status`, `replay`, `trialBalance`, `assertBalancedBatch`: balanced integer paise, idempotent on journal id and digest) and `CalendarPort` on `CALENDAR` (PR-LDC-53; PKCE connect, idempotent entries by external id, `calendarPayload` detail levels). Both are catalogued with an interface.
- 15be78b: AV port (IPB-01 AV, IPB-02-44; PR-LDC-41): `FileScanPort.scan(ref)` → `CLEAN`, `INFECTED` or `ERROR` with a reason, and `scanDecision`, the fail-closed mapping (only `CLEAN` releases). `AV` is catalogued with an interface. `PortHealth` gains an optional `detail` (snake_case names, scalar values, at most 16) for operational facts such as the AV adapter's signature age.
- 15be78b: `AuditEntryInput.businessIds`, `BUSINESS_ID_PATTERN` and `MAX_BUSINESS_IDS` (PR-LDC-30).

## 1.27.0

### Minor Changes

- 043a348: `ObligationPublishedData` and `obligationPublishedProblems` (Ecosystem Spec v1.5 §6.15; PR-LDC-33, owner answer #127): ids and keys only, no other field, `dataclass = INTERNAL`, the obligation as `subject`; `REPEALED` needs `effective_to`.
- 043a348: `PROVIDER_INCIDENT_SEVERITIES`: the `ProviderIncident` severity scale `SEV1` (most severe) to `SEV4`, accepted by the owner (#131), with each level's meaning.
- 043a348: `EvidenceSubmittedData` (§6.15) and `ProviderIncidentData` (§6.16) payload schemas (PR-LDC-45, PR-LDC-51).

## 1.26.0

### Minor Changes

- 0aa0f1d: Register `rules.outbox` for the outbox relay (`rules/0003`; LawDocsComply PR-LDC-35, R1-D-112), so `RuleSetPublished` is delivered. And a scheduled cut-over (PR-LDC-34, R1-D-113): `publish(ctx, ruleSetId, version, { effectiveFrom })` takes a cut-over instant (now to 366 days ahead) that the R4 request shows; the previous version stays in force until it, `RuleSetPublished.effective_from` carries it, one cut-over may be pending per rule set, and `RuleSetSummary` gains `scheduledVersion` and `scheduledFrom`.

## 1.25.0

### Minor Changes

- 496180e: Wave 11: module lifecycle and tenant entitlements (Finbyx PR-FBX-43; OWNER-QUESTIONS #123; R1-D-107; R1-plan M76).

  - **`tenancy`:** `tenancy/0020` and `TenantEntitlements`. A licence change is a request and an approval by two different people, both ledgered: requested by PLT_SUPER_ADMIN or PLT_FINANCE, approved by a different PLT_SUPER_ADMIN or PLT_SECURITY_OFFICER (never the requester, a tenant user, a support role or an impersonation); R3 outside production, R4 (60-minute delay) in production; applied once. Versions and notices are insert-only and written only on the platform's approved path. The tenant is told of every grant, revocation and lapse (`onNotice`, `forTenant`); a lapsed or revoked licence refuses writes (`assertWritableIn`, `tenancy.entitlement_status(sku)`) and keeps every record readable. `recordLapses` is the daily sweep.
  - **`contracts`:** the platform role `PLT_FINANCE`; `@infrabyx/contracts/module-lifecycle` (the Spec §11.1 lifecycle and edges, `AttachableModule`, `EntitlementChangeInput`, `entitlementStatusOn`, the guard codes); the `ModuleAttached`, `ModuleDetached` and `LegalHoldChanged` schemas (Spec §6.14, §6.16); id prefixes `lic` and `lcn`.

## 1.24.0

### Minor Changes

- e86dedf: Wave 10 (R1-plan M72 to M74).

  - **`audit`: retire an empty capture table (OWNER-QUESTIONS #122, R1-D-102; Finbyx PR-FBX-39).** `audit/0008` adds `audit.retire_capture(regclass)`: for `app_migrate` only, only inside a migration applied by the platform runner, refused unless the registered table has no rows. It writes the retirement into the capture chain (`audit.capture_retirement`, itself captured, action `audit.capture.retire`), keeps every capture row, ends the registration, and lets the drop guard admit the drop of that one table in the same transaction only; the commit fails if the table is not dropped. Every other drop is still refused. Use: `select audit.retire_capture('<schema>.<table>'); drop table <schema>.<table>;` in one migration. Install `audit/0008` as the database owner, as `audit/0003`.
  - **`tenancy`: one tenant-id rule (Finbyx PR-FBX-40, R1-D-103).** `tenancy/0019` refuses a tenant id other than `tnt_` followed by 1 to 60 lower-case letters and digits, or a ULID; it first checks the existing tenants and stops, naming them, if one breaks the rule. The migration runner sets `ipb.migration` to the file it applies, for that file's transaction.
  - **`contracts`:** `TENANT_ID_REGEX`, `TENANT_ID_PATTERN`, `isTenantId`; every id they admit fits every port's storage prefix. Three new ports, interfaces only (R1-D-104): DISPATCH (`DispatchPort`, ADR-0008, Finbyx PR-FBX-41), COURT_DATA (`CourtDataPort`, ADR-0009, PR-FBX-42) and ODR (`OdrPort`, ADR-0010, PR-FBX-44; Ecosystem Spec 8.9), with catalogue rows.
  - **`testing`:** `FakeDispatch`, `FakeCourtData`, `FakeOdr`, `equatorOdrStub()` (with the group-company disclosure) and the three contract suites.
  - **`workflow`:** timer ids follow the tenant-id rule.

## 1.23.0

### Minor Changes

- 67be297: The detached JWS in `X-Infrabyx-JWS` (Ecosystem Spec v1.4 §3.6, PR-043, OWNER-QUESTIONS #116; R1-plan M61). `@infrabyx/contracts/events`: `REGULATED_JWS_HEADER` and `regulatedJwsFromHeaders(headers)` (a Fetch `Headers` or a Node header record): exactly one header, any case, one compact detached JWS of at most 1,024 octets; a missing, repeated, comma-joined, over-long or malformed value is refused with its reason. The Operations Hub provisioning adapter adds `deliveryHeaders(event)` (a fresh JWS per delivery, so a retry has a new `jti`) and `receiveHttp(body, headers)`, which refuses a bad header as `signature-invalid` (`IPB-API-018`) before verifying or storing anything and keeps the header value byte for byte as the proof. `receive(event, jws)` and `signForDelivery` are unchanged. A product that already sends and reads `X-Infrabyx-JWS` removes nothing (minor rather than patch, because two methods are added).
- 67be297: Whose return it is (Finbyx PR-FBX-36; the owner's table, OWNER-QUESTIONS #119; R1-D-97, R1-D-98). `ReturnCodeInfo.attribution` and `PresentationResult.returnAttribution`: `BORROWER` for NACH 04 (balance insufficient), NACH 01 (account closed), NACH 06 (payment stopped by drawer) and UPI Z9 (insufficient funds); `NOT_BORROWER` for NACH 07, 09, every other code and every unknown code (no charge). `bounceChargeable(info)` is true only for `BORROWER`. The table is a platform floor: `classifyReturnCode(channel, code, { borrowerCodes })` takes a tenant's list, which can only shrink the borrower's codes, never widen them. `[VERIFY]` against the sponsor bank's NPCI specification; the testing fake fills the new field.
- 67be297: The TELEPHONY port (Finbyx PR-FBX-38; ADR-0007; R1-D-97): `TelephonyPort` with `clickToCall` (a person or the product's service places it, never an agent; idempotent on its key), `callOutcome`, `storeRecording` (only when the request named a recording disclosure and the adapter reports it was played; stored in the tenant's STORAGE under the request's output prefix with its retention and `deleteAfter`) and `cancel`; catalogue row `TELEPHONY` (tier 2, `int.telephony.`). `@infrabyx/testing` adds `FakeTelephony` and `telephonyContractCases`. No adapter until a provider is chosen.

## 1.22.0

### Minor Changes

- 3c9bb25: The UNIT setting tier (PR-042, IPB-07-38 as amended by the owner; LawDocsComply PR-LDC-17; R1-D-95): `SETTING_TIERS` is now PLATFORM → PLAN → BRAND → TENANT → ENTITY → UNIT → USER, UNIT being an organisation unit, department or function (`displayTier` ORG). `KernelContext.unitIds` (optional) carries the caller's units, outermost first, from the product's own organisation model.

## 1.21.0

### Minor Changes

- 1dda4b2: Tenant notification templates (R1-plan M58; R1-D-90): `NotificationClass.variables` (the variables a tenant email template may use); `ResolvedTemplate` email gains `content?: EmailTemplateContent` (subject, plain text, optional HTML with `{{var}}` placeholders, rendered by NOTIFY); `EmailMessage.content?: EmailContent` (rendered subject without line breaks, plain text and optional HTML, sent in place of the vendor template by an adapter with the `content: "native"` capability).
- 1dda4b2: Sandbox tenants (LawDocsComply PR-LDC-29; R1-plan M60; R1-D-87), failing closed.

  - `contracts`: `KernelContext.sandbox`, set by the kernel only and never trusted from a caller, and
    `isSandboxed(ctx)`, true unless the kernel read the tenant's flag as false; the `sandboxed`
    delivery state.
  - `tenancy`: migration 0018 adds `tenancy.tenant.sandbox` (default false), `tenancy.tenant_sandbox()`
    for the kernel and a trigger that lets only a platform context carrying the action
    `tenancy.tenant.sandbox.set` change it. `PgKernel` reads the flag once per read and mutate
    transaction into `tx.ctx.sandbox`, overwriting whatever the caller passed (absent when there is
    no tenant row). `TenantBootstrap` takes `sandbox`; `TenantSandbox.set` (PLT_SUPER_ADMIN, platform
    context, a reason) changes it, ledgered in the tenant.
  - `notify`: migration 0005 widens the delivery state check. In a sandbox tenant every delivery
    that would leave the platform (email, SMS, WhatsApp, push) is recorded and ledgered as
    `sandboxed` and never handed to an adapter: immediate sends, `dispatchDue`, digests and one-time
    codes alike; in-app messages are still written. A tenant whose flag cannot be read sends nothing.
  - `ai`: in a sandbox tenant the chat and embedding gateways refuse a call whose data class
    (declared, or raised by the scrubber) is above INTERNAL with `IPB-PORT-003`, recorded on the run
    (`sandbox_refused`) and ledgered as the other refusals are; PUBLIC and INTERNAL calls proceed.

  Products: run the migrations (`tenancy` 0018, `notify` 0005). Every tenant that sends notifications
  or calls the AI gateway with data above INTERNAL needs its `tenancy.tenant` row, the platform tenant
  included: without one the kernel cannot read the flag and the ports fail closed.

## 1.20.0

### Minor Changes

- b8c1f2c: RULES (R1-plan M55; R1-D-88): `RuleParameter` and `RuleSetBody.parameters` (tenant parameters bound to a registered setting, with type, bounds or allowed values and a default; `ruleParameterValueError`); `RuleSetRef.asOf` (evaluate the version in force at a past instant); `Decision.parameters` and `asOf`, `Explanation.parameters` and `asOf`; `RuleEngine.compile(body, parameters?)`. `simulate` takes `{ ruleSetId, version }`.

## 1.19.0

### Minor Changes

- c8b8f88: BUREAU: `Tradeline.emiPaise` (the reported instalment in integer paise, `null` when the CIC reports none). ESTAMP DDE: `DdeRecord.signers` (`DdeSignerEvidence`: signer reference, signed at, signing method, ESP transaction id or signer IP, the shape of ESIGN's signer trail) and `DdeRecord.notStampableReason`; `DdeRegistration.notStampable` with the `DDE_NOT_STAMPABLE_REASONS` code table (`NOT_AN_INSTRUMENT`, `ACKNOWLEDGEMENT`, `OTHER` with a note), refused with a certificate or a duty; `certificateId` is now required only on the stamped path (PR-FBX-35; R1-D-84).
- c8b8f88: The DISBURSEMENT_RAIL product port (IPB-01 §01.4.4.3, ADR-0006), collection half: `DisbursementRailPort` with `presentDebitBatch` (NACH and UPI AutoPay debits against registered mandates; each item a money call checked by `assertDebitBatch`: `assertMoneyCall` per item, integer paise, one key per item, the whole batch refused on any failure; a key presented at most once), `readPresentationResponse` (per-item results with NPCI return codes classed by `NPCI_RETURN_CODES` and `classifyReturnCode`: re-presentable or final, unknown codes final) and `statementLines(range)`; catalogued at tier 1 and listed in `R1_PORTS`. PAYMENTS: optional typed `ReconcileReport.settlementLines` (`SettlementLine`: gross, fees, tax, adjustments and net in integer paise, UTR, date), backwards compatible. No adapter (PR-FBX-34 (1), (2); R1-D-80).
- c8b8f88: The COMPANY_DATA port interface (IPB-01 §01.4.4.2): `CompanyDataPort` with `lookupCin`, `lookupLlpin`, `getDirectors` and `getCharges`; company master data, directors (DIN, designation, appointment and cessation dates) and charges (holder, amount in integer paise, open or satisfied, dates), each result labelled with the register date (`asOf`) and `stale`; `CIN`, `LLPIN` and `DIN` patterns and the INTERNAL lookup schemas. COMPANY_DATA is now `interfaceDefined` and listed in `R1_PORTS`. No adapter until the owner chooses a data source (PR-LDC-02, OWNER-QUESTIONS #102; R1-D-79).
- c8b8f88: Identity-provider brokers on the IDENTITY port (optional, `IPB-PORT-001` `unsupported` where absent): `upsertIdentityProvider`, `removeIdentityProvider`, `listIdentityProviders` and `discoverIdentityProvider` (`IdentityBrokerAdmin`). `IdentityProviderSpec` is a strict OIDC or SAML broker for one tenant: `IdpAlias`, display name, discovery or metadata URL, client id and `clientSecretRef` (a `secret://` reference only; a literal secret is refused), scopes, `enabled` and `VerifiedDomain`s; `IdentityProviderInfo` never carries a secret. `emailDomainOf` and `idpUrlAllowed` helpers (PR-LDC-09; R1-D-78).
- c8b8f88: `refreshSession` on the IDENTITY port (optional, `IPB-PORT-001` `unsupported` where absent): the refresh-token grant with rotation, returning `RefreshedTokens` with a new refresh token every time; a spent token presented again revokes its session and raises `IPB-IDN-001` with `meta.reason: "refresh_reused"`, any other refused token `"refresh_invalid"` (`REFRESH_REFUSAL_REASONS`); `IdentitySessionRefresh` names the grant with `verifyToken` for contract cases and fakes (PR-LDC-03; R1-D-77).
- c8b8f88: `PLT_SUPPORT` joins the platform roles (with `SUPPORT_ROLE`; MFA required as for every `PLT_*` role), the id prefixes `sgr` and `srd`, and the internal events `SupportAccessRequested`, `SupportAccessGranted` and `SupportAccessRevoked`, for tenant-consented support access (PR-LDC-08 (a), (b), PR-LDC-20; owner answer #104; R1-D-76).

## 1.18.0

### Minor Changes

- 9c368c7: `PrincipalPurposeConsent` and the optional `ConsentPort.latestByPrincipal(principalRef, call?)`: the latest record per purpose for a principal, in the caller's tenant only (PR-LDC-14; R1-D-72).
- 9c368c7: Ecosystem Spec v1.3 provisioning events (PR-040, owner sign-off #105): `PROVISIONING_REQUESTED_TYPE`, `PROVISIONING_FAILED_TYPE`, `ProvisioningRequestedData`, `ProvisioningFailedData`, the `provisioning_failure_reason` code table with its retryable set and `PROVISIONAL_TENANT_PURGE_DAYS`; both events added to the regulated-message list (R1-D-70).

## 1.17.0

### Minor Changes

- 714ad01: `ResolvedTemplate` and `TemplateResolver`: a tenant's own SMS, WhatsApp or email template, consulted by NOTIFY at delivery (PR-FBX-33, R1-D-69).

## 1.16.0

### Minor Changes

- b3edda2: The one approval action for mandates (owner answer #100's gap; R1-D-66): `MANDATE_APPROVAL_ACTION` (`payments.mandate.change`), `MandateApprovalSubject` (operation, mandate, ceiling in integer paise) and the `MandateApprovalVerifier` port the mandate adapter calls before any vendor call.
- b3edda2: `TenantProvisionedData`, `TENANT_PROVISIONED_TYPE` and `PROVISIONING_PRODUCTS` for the Operations Hub's `TenantProvisioned` (Ecosystem Spec §6.29; PR-LDC-11, R1-D-68).

## 1.15.0

### Minor Changes

- 1b99d7a: The CAPTCHA and DEVICE_ATTESTATION ports (Udofin PR-UDF-029 and PR-UDF-028; ADR-0004; R1-D-50). `contracts`: `CaptchaPort` (`verify` returns a verdict: `invalid`, `expired`, `duplicate`, `action_mismatch`, `hostname_mismatch`) and `DeviceAttestationPort` (Play Integrity, App Attest registration and assertions, bound to a nonce or the DPoP key), both catalogued in `R1_PORTS`. `connectors` (`@infrabyx/connectors/captcha`): `TurnstileCaptcha` (reference) and `HCaptchaCaptcha` (alternative), which send only the token and the secret, and `CaptchaGate`, which asks for a token only while `int.captcha.under_attack` is on and then fails closed with 429 IPB-SEC-019. `config`: `int.captcha.under_attack`, `int.captcha.turnstile.enabled`, `int.captcha.hcaptcha.enabled` (both adapters off by default). `testing`: `FakeCaptcha`, `startCaptchaStub`, `captchaContractCases`, `FakeDeviceAttestation`, `deviceAttestationContractCases`. The device-attestation vendor adapters wait for the owner (OWNER-QUESTIONS #99).
- c83e9e0: Changing and retiring a customer's login (Udofin PR-UDF-034; R1-D-51). `CustomerIdentityPort` gains optional `startLoginChange`, `confirmLoginChange` and `retireLogin`. `KeycloakCustomerIdentity` and `ZitadelCustomerIdentity` implement them: a change needs one code to each login, from the same device key, and keeps the account's id, devices and subject; retiring forgets the devices, disables the account and frees the login for a new account. Zitadel accounts are now found by username, so a changed or recycled login maps to the right account. `CustomerAuthStore.recordAccountEvent` (optional) ledgers both events by the account's hash; `PgCustomerAuthStore` implements it.
- af2ae98: SMS and WhatsApp template values in the template's order (Udofin PR-UDF-025; R1-D-54). The stored variables lost their order in `jsonb`, so a positional DLT template could receive them shuffled. `templates.sms.vars` and `templates.whatsapp.vars` (optional) name the order; a missing named variable fails the delivery instead of sending; without a list, names sort naturally (`v1`, `v2`, … `v10`).
- c4117e4: The `ESTAMP`, `PAYOUTS`, `DOCGEN` and `PDF` port interfaces and the PAYMENTS mandate lifecycle (Finbyx PR-FBX-29; IPB-01; R1-D-52), interfaces, fakes and contract cases only. `EstampPort` (`covers`, `quoteDuty`, `purchase`, `attach`, `verify`, `handleWebhook`) with NeSL Digital Document Execution as optional methods (`ddeRegister`, `ddeStatus`, `ddeDownloadExecuted`); `PayoutsPort` (`createBeneficiary`, `validateAccount` with the holder's name, `payout`, `getStatus` with the UTR and value date, `handleWebhook`, `balance`; "accepted" is never final); `DocgenPort` (`render`, `renderBatch`, `renderHtml` to PDF or PDF/A, `previewHtml`, `listTemplates`, `validateTemplate`) and `PdfPort` (IPB-01's operations over STORAGE references); `MandateLifecycle` (`registerMandate` for eNACH, UPI AutoPay and physical NACH with the UMRN, `mandateStatus`, `cancelMandate`), optional on `PaymentsPort`. Every money-moving call carries an idempotency key, an amount in integer paise and a `MoneyAuthorisation` (an approved request and a user or service initiator); `assertMoneyCall` refuses an agent (`IPB-SEC-004`) and a missing approval or key (`IPB-UX-004`). `SignatureRecord` gains the optional `espTransactionId` and `signerIp`. `@infrabyx/testing`: `FakeEstamp`, `FakePayouts`, `FakeMandates`, `FakeDocgen`, `FakePdf`, `FakeEsign` and their contract cases. No vendor adapter: payout and mandate adapters wait for the owner (money movement).

## 1.14.0

### Minor Changes

- 97e8524: The `BUREAU` and `AA_FIU` product ports of IPB-01 §01.4.4.3 (owned by FBX v1.6), with fakes and contract cases (Finbyx PR-FBX-28; R1-D-43; ADR-0003). `contracts`: `CreditBureauPort` (`pull` with a soft or hard enquiry to CIBIL, Experian, Equifax or CRIF, refused without the product's consent receipt; the raw report by STORAGE reference with its SHA-256, the CIC's format version and a normalised summary in integer paise; `status`; `handleWebhook` reads the pull back) and `AccountAggregatorPort`, the FIU side (`requestConsent` with the ReBIT template, `consentStatus`, `revoke` in full or by FI type, `fetch` only under an ACTIVE consent within its range and FI types, each payload by STORAGE reference with its ReBIT schema version and SHA-256, `handleWebhook`); both catalogued (tier 2, owner FBX v1.6, `int.bureau.`, `int.aa_fiu.`) and in `R1_PORTS`. `testing`: `FakeCreditBureau`, `FakeAccountAggregator`, `creditBureauContractCases` and `accountAggregatorContractCases`. Vendor adapters wait for the owner's sandbox documents and accounts.
- 92706c4: `Tx.unit` (optional on the interface; the platform kernel provides it) and `UnitOutcome` for kernel-owned nested units (Finbyx PR-FBX-30; R1-D-41).
- 4a87754: Per-object retention that is only ever extended (Finbyx PR-FBX-27; IPB-01-29; R1-D-42). `StoragePort.extendRetention(key, retainUntil)` (S3 `PutObjectRetention` in COMPLIANCE mode; an earlier or equal date, or an object without retention, is refused with `IPB-STOR-003`) and `retentionOf(key)`, on the `s3` and `minio` adapters and `MemoryStorage`, with a shared contract case. `assertImmutable` now also checks the stored SHA-256 checksum against the hash recorded at write, from a HEAD with checksum mode, so no decrypt permission is needed. `putWithRetention` stays one single-part write with the lock mode, the date and a SHA-256 checksum.
- d66ffad: Named tenant functions under maker-checker (Finbyx PR-FBX-20; IPB-02-33; R1-D-39). Migration `tenancy/0011` adds `tenancy.function_assignment`. `TenantFunctions` assigns `FN:CRO`, `FN:CCO`, `FN:COMPLIANCE_OFFICER` and a product's own functions through an approved R3 `tenancy.function.assign` request (an ORG_OWNER or ORG_ADMIN asks, a different one approves, never the assignee), revokes at once with a reason, and `withFunctions(ctx)` adds the person's active functions to the session's roles (dropping any a token claimed). `ApprovalsEngine` honours an action's `checkerFunctions` and the tenant's `FN:` entries in `mc.checker_roles.<action>` (tighten-only; `checkerFunctionsFor`), and `ApprovalWorkflow` sends inbox items to the function holders. `contracts`: `FUNCTION_ROLE_REGEX`, `PLATFORM_FUNCTIONS`, `isFunctionRole`, and `FN:` roles in `RoleSchema`. Run `infrabyx-migrate`.

## 1.13.0

### Minor Changes

- cff2a02: `CONSENT_EVENTS.PurposeConsentChanged` and `PurposeConsentChangedData` (receipt id, purpose, granted, notice version; no subject), and the `cpn` and `cpr` id prefixes, for product-purpose consent (Finbyx PR-FBX-26; R1-D-38).

## 1.12.0

### Minor Changes

- 63c5ad2: Search refusals for the application shell (Finbyx PR-FBX-09; R1-D-32). `@infrabyx/contracts/search-refusal` adds `searchRefusal(text)`, which refuses any twelve-digit run and a Verhoeff-valid VID (`aadhaar_pattern`), a Luhn-valid card number (`card_pattern`) and a PAN (`pan_pattern`) with `IPB-UX-003` and the pattern class only (IPB-07-17), plus `verhoeffValid` and `luhnValid`. The id prefix `svw` names saved table views.

## 1.11.0

### Minor Changes

- 2e3a2d3: The platform event `BreakGlassUsed` (module `security`): a break-glass grant was used in this tenant (R1-D-28).
- 3f20011: The `external` principal type and `KernelContext.externalGrantId`, for a named external grantee reading one tenant under one grant (Finbyx PR-FBX-10 item 5; R1-D-29).

## 1.10.0

### Minor Changes

- 138ae44: Error codes IPB-API-010 (Idempotency-Key missing or not UUIDv7) and IPB-API-011 (idempotent request in progress), from IPB-10 §10.6.3 (R1-D-27).

## 1.9.0

### Minor Changes

- 2b307e0: The branch context (Finbyx PR-FBX-10 item 1; R1-D-26): `KernelContext.branchId` (the branch a change is made in), `branchIds` (the branches whose rows the principal may see) and `allBranches`.

## 1.8.0

### Minor Changes

- cd25633: `MutateOptions.reason`: why a mutation is made, recorded by the statutory capture (R1-D-25).

## 1.7.0

### Minor Changes

- f5622c9: `CustomerIdentityPort.forgetDevices(tenantId, userId)`: when the customer closes the account, every device is signed out and deleted at once. `revokeDevice` (unbinding) now deletes the device as well as signing it out (owner answer #86, R1-D-23).

## 1.6.0

### Minor Changes

- ceabe3b: The `KYC` and `VIDEO_MEET` port interfaces (IPB-01; Finbyx platform request PR-FBX-01, R1-D-21): `KycPort` with REGULATED request schemas, STORAGE file references and the V-CIP manifest; `VideoMeetPort` with `RoomPolicy` (participant countries, official networks, recording target, no provider copy above INTERNAL) and recording manifests. Both are `interfaceDefined`; no adapter yet.

## 1.5.0

### Minor Changes

- 849b8f9: Customer sign-in through the IDENTITY port (R1-D-19): `CustomerIdentityPort` (one-time-code challenges, DPoP-bound sessions, refresh, request verification, devices), `CustomerOtpSender`, `customerLogin` and the customer session types. A separate interface: `IdentityPort` is unchanged.

## 1.4.0

### Minor Changes

- 7e38652: `REGULATED_MESSAGE_EVENTS` and `isRegulatedMessage(type)` in `@infrabyx/contracts/events`: the regulated messages of Ecosystem Spec §3.6 (v1.0 to v1.2), which carry a detached JWS (G5).

## 1.3.0

### Minor Changes

- b6058d3: `IPB-API-005` (IPB-10 §10.6.3) in the error catalogue, for an Ecosystem event of the other environment (G2).

## 1.2.0

### Minor Changes

- 75e9ea4: The service reader `SVC_TENANT_SWEEP` (`svc_tenant_sweep`, `tenancy.tenant`) for scheduled per-tenant jobs (PR-UDF-013).

## 1.1.0

### Minor Changes

- 588b509: `SVC_OUTBOX_RELAY` joins `SERVICE_READER_ROLES` (owner answer #74(e), R1-D-01): the outbox relay's service reader, whose tables are the module outboxes registered in the database rather than a static list, and `OUTBOX_DISPATCH_ACTION`, the only kind of write it may make (`<schema>.outbox.dispatch`).

## 1.0.0

### Major Changes

- 9ec9a2c: 1.0.0, the platform baseline release (IPB-14 §14.5 item 1; owner answer #67(4), PL6-D-16). Every `@infrabyx/*` package moves to 1.0.0 together; the public API is unchanged from the 0.x set of the PL6 gate (`docs/phases/PL6-gate.md` §6), so a product upgrades by moving every dependency to 1.0.0 at once. From 1.0.0 on, semantic versioning holds: a breaking change to an export, a migration or a setting is a major release with an ADR (IPB-09-34/35).

## 0.5.0

### Minor Changes

- de53086: Owner answers #34 and #37 (PL4-D-13). **Breaking for manifests:** `SkillTool.locked` is now required, so every tool in a skill manifest declares `locked: true` or `locked: false`; a manifest without it fails validation (`IPB-VID-001` in `SkillRegistry.load`). `false` never unlocks a tool the kernel list matches by name. New service reader role `SVC_AI_INDEX_SWEEP` (`ai.retrieval_index`: id, tenant, state and retirement time) for the retired-version sweep.
- f1a36a1: Owner answer #52 (PL5-D-05): `ContrastGuardFailedData` pairs gain optional `role` (`fill`, `text`, `icon`, `border`, `focus`) and `reason` (`contrast`, `role_not_permitted`).
- 1fecf45: Owner answers #53 and #57 (PL5-D-11): the MEDIA port interface (`MediaPort` with `probe`, `reencode` and `rasteriseSvg`; `MEDIA_FORMATS`, `MEDIA_RENDITION_WIDTHS`, `MEDIA_MAX_INPUT_PIXELS`, `FAVICON_PNG_SIZES`, `renditionWidths`). MEDIA is now a defined port (`PL5_PORTS`). The `SVC_CONSENT_SWEEP` reader may also read `consent.subject_status`.
- b0dc390: PL5 session 4: the `gls_` id prefix (CMS glossary terms) and payload schemas for the `cms` events `RevisionCreated`, `PublishRequested`, `ContentUnpublished`, `ClaimsLintFailed`, `ContentStale` and `RedirectChanged`.
- 686d24b: Service reader role `SVC_CONSENT_SWEEP` (`consent.record`: id, tenant and time) for the consent purge (OWNER-QUESTIONS #48).
- e8e83cb: `ContrastGuardFailedData`, the payload of `in.<product>.brand.ContrastGuardFailed.v1` (IPB-04 §04.6.1): the pack and the failing pairs, each with its scheme, ratio, minimum and suggested colour.
- 275d4ba: Feedback and trust contracts (PL5 session 6):

  - service reader roles `SVC_FEEDBACK_SLA` (`feedback.item`) and `SVC_TRUST_SWEEP` (`trust.acknowledgement`, `trust.request`);
  - id prefixes `fbs_` (feedback status change) and `vads_` (vendor assurance subscription);
  - payload schemas `FeedbackStatusChangedInternalData`, `AccessibilityIssueReportedData`, `AccessibilityIssueSlaBreachedData`, `VendorAssuranceDocumentAcknowledgedData`, `NdaAcceptedData` and `VendorDocumentRequestedData`.

- 934355c: PL5 session 1 (PL5-D-02): the twelve website ports in `ports/web.ts` (CONSENT, CRM, HR, SUPPORT, BACKLOG, TRUST, BILLING catalogue, TAG_MANAGER, ANALYTICS, EGRESS, CLAIMS, LAW_REGISTER) with their payload schemas and the Ecosystem v1.2 code tables they use; the error areas `IPB-CMS`, `IPB-BRD`, `IPB-WEB`, `IPB-FB`, `IPB-POL`, `IPB-A11Y`, `IPB-TRUST` and `IPB-RES`; the content, consent and trust id prefixes; and the PL5 internal event names with payload schemas for the Ecosystem v1.2 events (`BrandPackPublished`, `PolicyEffective`, `MarketingConsentUpdated`, `LeadCaptured`, `FeedbackSubmitted`, `FeedbackStatusChanged`, the vendor-assurance events). The `TAG_MANAGER` port's settings prefix is now `mkt.tag_manager.`.

### Patch Changes

- 36338c3: Id prefixes `rsv_` (CMS resource version) and `rdl_` (CMS resource download).

## 0.4.0

### Minor Changes

- 2b07109: `IPB-EXP-006` (export archive expired and deleted, 410) and the `SVC_EXPORT_SWEEP` service reader
  role (PL3-D-25).
- f6e9a88: Service reader role `SVC_AI_RUN_SWEEP` (`ai.run`: id, tenant and time only) for the AI run retention sweep (OWNER-QUESTIONS #30, PL4-D-05).
- 200b25a: PL4 session 1 (PL4-D-02):

  - AI port interfaces LLM, EMBEDDING, IMAGE_GEN, SPEECH and RERANK (`ports/ai.ts`): data blocks, tools, usage, residency and retention, routing bands, the provenance sidecar and `AiProviderError`;
  - `@infrabyx/contracts/vidhi`: the skill-manifest schema, autonomy levels, task states and locked-action categories;
  - the IPB-03 §03.6.3 error codes (`IPB-AI-001` takes the IPB-03 meaning; PR-024), plus `IPB-AI-032`;
  - new ids, the `AGT_VIDHI` role and the `in.<p>.ai.*` and `in.<p>.vidhi.*` event names and payloads.

- 9af583a: The `FeedbackReceived` payload schema (`FeedbackReceivedData`, PL4-D-11).
- 288ae44: The `NotebookOutputCreated` payload schema (`NotebookOutputCreatedData`, PL4-D-10).
- b205b1d: Payload schemas for the Vidhi events: `TaskStateChangedData`, `VidhiApprovalRequestedData`, `ActionExecutedData`, `LockedActionAttemptedData` and `AutonomyChangedData` (PL4 session 6).
- 183c532: The service reader role `SVC_VIDHI_SCHED` (due Vidhi schedules) and the `ScheduleRunSkipped` payload schema with `SCHEDULE_SKIP_REASONS` (PL4-D-09).

## 0.3.0

### Minor Changes

- 50093e9: `EsignEnvelopeStore` and `EsignEnvelopeRecord`: products persist envelope ids, vendor references
  and each signer's method (PL3-D-23).
- e268b60: Export runtime errors `IPB-EXP-001` to `-005` (PR-017) and `MutationKernel.read` options with
  `snapshot` (REPEATABLE READ) for the export snapshot (PL3-D-22).
- 1ed0659: `NotifyPort` methods that touch tenant data take the `KernelContext` first (unreleased interface);
  id prefixes `ptk` (push device token) and `inm` (in-app message).
- 2725b6c: PL3 session 1: RULES, NOTIFY, PUSH and ESIGN port interfaces (`@infrabyx/contracts/ports`); the
  notification catalogue schema; `HumanQueue` and Work Inbox item types (`./kernel`); export map and
  `archive_manifest` v1 schemas (new subpath `./export`); id prefixes `rls`, `dcs`, `sca`, `ibx`,
  `ntf`, `dlv`, `sup`, `exj`, `arc`, `esr`; error codes `IPB-NTF-002` to `-006` and `IPB-UX-012`;
  platform events for rules, inbox, notifications, export, approval expiry and escalation, and the
  flag-provider alert; Ecosystem payloads `MarketingConsentUpdated`, `ExportRequested` and
  `ExportCompleted`. Additive only.
- 1ed0659: `PushTokenStore`: the device-token store behind the PUSH adapters (NOTIFY seals the tokens).
- 53697f5: `RulesPort` methods take the verified `KernelContext` first (the service runs inside tenancy);
  error codes `IPB-RULE-001` (rule set invalid), `-002` (no effective version) and `-003` (version
  not in the needed state), registered under PR-017 (PL3-D-18). Unreleased interface, so no product
  code changes.
- dd7a98b: `ApprovalRequestInput.diff` (`{ before, after }`, the checker diff) and the `TimerEngine` interface
  for durable workflow timers (PL3 plan §5, PL3-D-19).
- 3951517: Owner answers #21 and #22 (PL3-D-21): `SERVICE_READER_ROLES` (`SVC_SCHEDULER`,
  `SVC_NOTIFY_DISPATCH`, `SVC_NOTIFY_UNSUBSCRIBE`), each with its database role and the one table it
  may read, and `isServiceReaderRole`; `InboxItemInput.excludePrincipal` and `escalateAfterHours`.

## 0.2.0

### Minor Changes

- 9ac878e: `KmsPort.generateDataKey(keyId, aad?)`: optional AAD that binds the wrapped data key (the C-14
  encryption context). Existing callers are unaffected.
- ded1ae2: PL2 session 1: port interfaces for AUTHZ, QUEUE, WORKFLOW, EMAIL, SMS, WHATSAPP, PAYMENTS and
  OBSERVABILITY and the full IDENTITY interface; `PortCall`, capability flags and idempotency lookup;
  payload data-class annotations with `effectiveDataClass` (a caller may only raise the port default,
  PL2-D-03); delivery-recipient fields (IPB-DEV-05); integer-only paise/decimal conversion (P-04);
  the `provider_routing` schema and `checkRouting` (IPB-01 §01.4.5: secrets paths, residency,
  tighten-only policy, recipient delivery, unproven adapters refused in staging and above); the
  IPB-10 connector manifest schema with the P-18 settlement rule; provider-routing event payloads.
- 9c774b9: STORAGE: `presign(key, op, ttl, opts?)` takes `{ bucketClass, contentType }` so an upload URL is
  bound to its bucket class and content type. KMS: purpose `workflow` in `KMS_PURPOSES` for the
  Temporal payload codec (C-16).
- 7a36249: `KMS_PURPOSES`, `KmsEncryptionContext`, `isKmsEncryptionContext` and `PLATFORM_KMS_TENANT`: the fixed purpose registry and the C-14 context type for data-key wraps (PL2-D-50).
- 13c7379: Messaging (PL2-D-64): `IPB-API-018` in the error catalogue (IPB-10 §10.6.3); optional `WebhookRequestMeta` (source IP, query string) on the EMAIL, SMS and WHATSAPP `verifyWebhook`; optional `pricingCategory` and `errorCode` on `WhatsappEvent`.
- 0c4535d: `PaymentEvent.method`: the payment method category (card, UPI, netbanking, wallet, EMI, other), never card, VPA or account values (P-10).

### Patch Changes

- 2969424: IDENTITY: `authenticate` takes the PKCE `codeVerifier` for an authorisation code; new id prefix
  `rvk` for session and user revocations.
- 858a76a: Add the `idm` id prefix for port idempotency records (PL2 plan §3.5).

## 0.1.0

### Minor Changes

- a17086c: PL1 kernel vocabulary: data classes and residency policy (IPB-02 §02.4.3.1, IPB-01 §01.4.5), prefixed ULID identifiers, the nine-environment catalogue and guard groups (IPB-09-15, IPB-11 §11.2), the role floor (PL1-D-05), settings tiers and risk classes R0–R5, the 99-code error catalogue (incl. IPB-MOD-003 and IPB-UX-011, PL1-D-08) with RFC 9457 rendering (IPB-ENV codes per PL1-D-03), internal (IPB-10-37) and Ecosystem (Spec §3.2) CloudEvents envelopes, the module manifest (IPB-01-10), kernel interfaces, the port catalogue, and the SECRETS, KMS, STORAGE, FEATURE_FLAG and IDENTITY port contracts.

  Audience: developer · Reg: none · Notice class: standard

### Patch Changes

- c2cf60a: PL0 toolchain baseline: pnpm 9 lockfile, Turborepo pipeline, ESLint 10 flat config with the IPB
  rules `ipb/vendor-import`, `ipb/schema-boundary` and `ipb/no-process-env` (placeholders),
  Vitest, Prettier, Renovate per IPB-01 §01.4.1.2, SHA-pinned CI and release workflows, and the
  `ipb:check` structural checks. Released with the seven PL1 packages at 0.1.0 (PL1-D-02 / D-06); the fifteen later-phase packages stay unpublished scaffolds until their own phase.

  Audience: internal · Reg: none · Notice class: standard
