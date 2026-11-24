# @infrabyx/connectors

## 1.33.1

### Patch Changes

- Updated dependencies [591ff53]
  - @infrabyx/tenancy@1.30.0

## 1.33.0

### Minor Changes

- 95acbf9: A return URL on the ESP's hosted signing page (Udofin PR-UDF-086; R1-D-287). `contracts`: `Signer.returnUrl`, an optional `returnUrl` on `aadhaarEsign` and `dscSign`, `returnUrlProblem` and `ESIGN_RETURN_URL_MAX` (https with a host; no query string, fragment or `@`; at most 2,048 characters). `connectors`: Digio passes it in the hosted page's own `redirect_url` parameter, Leegality per invitee at creation (a different session return URL is refused `return_url_fixed`); an invalid one is refused `IPB-PORT-001` `return_url_invalid` before any vendor call. `fakes`: `FakeEsign` checks and records it (`returnUrlOf`). `testing`: tests only.

### Patch Changes

- Updated dependencies [95acbf9]
  - @infrabyx/contracts@1.52.0
  - @infrabyx/config@1.24.6
  - @infrabyx/crypto@1.15.4
  - @infrabyx/tenancy@1.29.1

## 1.32.4

### Patch Changes

- Updated dependencies [c07aefe]
  - @infrabyx/tenancy@1.29.0

## 1.32.3

### Patch Changes

- Updated dependencies [fc9e98c]
  - @infrabyx/tenancy@1.28.0
  - @infrabyx/contracts@1.51.0
  - @infrabyx/config@1.24.5
  - @infrabyx/crypto@1.15.3

## 1.32.2

### Patch Changes

- Updated dependencies [061f0d4]
  - @infrabyx/tenancy@1.27.0

## 1.32.1

### Patch Changes

- Updated dependencies [613e0e0]
- Updated dependencies [90ffc18]
- Updated dependencies [9abffba]
  - @infrabyx/tenancy@1.26.0
  - @infrabyx/contracts@1.50.0
  - @infrabyx/config@1.24.4
  - @infrabyx/crypto@1.15.2

## 1.32.0

### Minor Changes

- 4fbcf73: R1-D-276. `s3`/`minio` STORAGE: `IPB-KMS-001` (`storage_key_unavailable`) and the read/write outage errors (`IPB-PORT-002`, `IPB-STOR-002`) no longer carry the SDK error as `cause`, whose message can quote a KMS key ARN, a bucket or an object key; `meta.name` and `meta.status` stay. `clamav`: a file whose named key the scanner may not use is now `ERROR` with reason `storage_key_unavailable` (was `unavailable`); still quarantined. Behaviour visible: a product matching that reason should accept the new label.

### Patch Changes

- Updated dependencies [a37e9fe]
- Updated dependencies [4fbcf73]
  - @infrabyx/tenancy@1.25.0
  - @infrabyx/contracts@1.49.0
  - @infrabyx/config@1.24.3
  - @infrabyx/crypto@1.15.1

## 1.31.0

### Minor Changes

- f669e55: Udofin PR-UDF-078 (R1-D-268; IPB-DEV-04 gate B): `sandbox-status.json` lists every adapter this package publishes. Sixteen are added under `adapters`, each `unproven`: `nsdl-esign`, `nesl-dde`, `shcil-estamp`, `digio-estamp` and `manual-paper` (beside `leegality` and `digio`), and `digio-mandate`, `idfy-kyc`, `cibil`, `setu-aa`, `http-statement`, `generic-grc`, `sftp`, `tallyprime`, `native`, `turnstile` and `hcaptcha`; each names `offBy`, the settings (off by default) that keep it off, until its port-contract issue is opened. A new `hermetic` map lists the 29 self-hosted, in-process and composite adapters (with port and kind); the routing check does not read it. Behaviour visible: `infrabyx-routing check --sandbox-status` now refuses those sixteen in staging, pre-prod, prod and dr (`IPB-PORT-005`); keep them in dev and test routing files. A unit test fails when an adapter is published without an entry. No code path, setting or migration changes.
- 847e164: Udofin PR-UDF-080 (R1-D-269), **behaviour visible:** `S3Storage.get` (`s3` and `minio`) now throws `IPB-STOR-005` (500, `meta.reason: "hash_mismatch"`, fixed detail, no key, bucket, hash or cause) where it threw `IPB-PORT-002` (503) for bytes that do not match the SHA-256 recorded in the object's metadata; the SDK's response checksum mismatch (`Checksum mismatch`), which surfaced as a generic `IPB-PORT-002` read failure, is now `IPB-STOR-005` too. An outage stays `IPB-PORT-002`; neither returns bytes. The router's breaker does not count `IPB-STOR-005`, so a read of a tampered object is not failed over to the replica. `pdf-text` `extractText` passes the integrity failure on as `IPB-STOR-005` `hash_mismatch` (was `IPB-PORT-002` `unavailable`), and `clamav` answers `ERROR` `hash_mismatch` for it (was `unavailable`). Catch the new code, do not retry it, and alert on it as a possible tamper (guide §7ep).

### Patch Changes

- Updated dependencies [e98dfeb]
- Updated dependencies [24c16c4]
- Updated dependencies [5fc6afe]
- Updated dependencies [daa13b9]
  - @infrabyx/crypto@1.15.0
  - @infrabyx/contracts@1.48.0
  - @infrabyx/config@1.24.2
  - @infrabyx/tenancy@1.24.1

## 1.30.0

### Minor Changes

- 78cc372: Finbyx PR-FBX-53 (R1-D-266): the QUEUE adapters (`bullmq`, `pg-boss`) check names with the platform rule from `@infrabyx/contracts/ports` (`assertQueueName`, `assertQueueJob`), so a product's fixture can apply exactly the same rule. The rule is unchanged (lower case; a queue name has no `.` and at most 63 characters, a job name at most 100); refusals now also carry `meta.reason` (`queue_name`, `job_name`, `job_data`). `checkQueue` and `checkJob` stay exported.

### Patch Changes

- Updated dependencies [5ee71f6]
- Updated dependencies [cb859aa]
  - @infrabyx/contracts@1.47.0
  - @infrabyx/tenancy@1.24.0
  - @infrabyx/config@1.24.1
  - @infrabyx/crypto@1.14.1

## 1.29.0

### Minor Changes

- 0b912b6: `@infrabyx/connectors/file-transfer`: the FILE_TRANSFER reference adapter `sftp` (Udofin PR-UDF-071, Finbyx's BureauSubmitter its second user; R1-D-254, ADR-0014; C-29 on the owner's instruction, R1-D-249), `SftpFileTransfer` over `ssh2` 1.17.0 (MIT, new runtime dependency; no native addon is built). One connection per call to the product's configured target (`SftpTarget`: host, port, username, pinned `hostKeySha256`, `clientKeySecret`). Before the network: `int.file_transfer.sftp.enabled` (off by default), the target on the India-hosted allow-list `int.file_transfer.sftp.allow_hosts` (`SftpAllowList`, residency `IN`), the path rule and the class. Then: the host resolved once with every answer public (`isPublicAddress`) and the socket to the checked address; the client key from SECRETS checked as one unencrypted OpenSSH `ssh-ed25519` key; public-key authentication only; the host key `ssh-ed25519` and pinned by SHA-256 fingerprint (no trust on first use); fixed algorithms `SFTP_ALGORITHMS` (curve25519-sha256, AES-256-GCM and ChaCha20-Poly1305, no compression) and a fixed identification string; `put` by exclusive create (WRITE | CREAT | EXCL, never TRUNC), a partial file removed on failure; `get` capped before and while reading; a call deadline, a handshake timeout and the AbortSignal; fixed refusal labels only. Health makes no connection unless `healthProbe` is set. Router table entries (`noFailover`), the exit entry (`sftp` → `fake-file-transfer`) and the `FILE_TRANSFER` contract leg. Off and unproven; no migration.
- fcded7e: `leegality` and `digio` `downloadSigned(envelopeId, { keyRef })` write the signed PDF to REGULATED under the tenant's named STORAGE key (Udofin PR-UDF-074; R1-D-260). A malformed reference is refused `IPB-PORT-003` `key_ref_invalid` before the ESP is called; STORAGE's refusals (`key_ref_unknown`, `key_ref_prefix_conflict`, `IPB-KMS-001` `storage_key_unavailable`, …) fail the download unchanged, with nothing written and no retry under the class key. Without `keyRef` nothing changes (a `tenantKeyRefPrefixes` entry for `tenant/<tenant>/esign/` still applies). `nsdl-esign` still refuses `downloadSigned` `unsupported`.
- 6cdb714: `S3Storage.keyRefStatuses(tenantId, keyRef, { bucketClasses, compartment?, describeKey? })` (Udofin PR-UDF-076; R1-D-261): each class by `keyRefStatus`'s checks; with `describeKey`, one read-only KMS `DescribeKey` per distinct key id the classes resolve to, `AccessDeniedException` answering `storage_key_not_described` (a missing, unshared or unusable key stays `storage_key_unavailable`), and any other KMS failure throwing `IPB-PORT-002` for the whole call, without the key id. A malformed class list, compartment or tenant is refused `IPB-PORT-003`; a class without a bucket `IPB-PORT-001`. `keyRefStatus` is unchanged. `minio` declares `keyRefStatuses` `unsupported` (after the same format checks).

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
  - @infrabyx/tenancy@1.23.1

## 1.28.0

### Minor Changes

- e7854b7: `PartnerMtlsClient` (`@infrabyx/connectors/egress`; Udofin PR-UDF-069; R1-D-250): one outbound call to a configured partner over mutual TLS. Built with the partner's exact `hosts`, `clientCertificateRef` and `clientKeyRef` (SECRETS references, resolved with `resolveSecret`, which `secretsResolver` from `@infrabyx/config` fits), an optional `serverCa` (otherwise Node's bundled roots) and limits. `request({ method, url, body, idempotencyKey, contentType?, accept?, headers?, signal?, timeoutMs?, maxResponseBytes? })`: `POST` or `PUT` only, a non-empty body (1 MiB by default), a required `Idempotency-Key` (`IPB-API-010` when missing or ill-formed), https on port 443 to one of the hosts with no user-info or IP literal; DNS once, every answer public, the socket pinned to the checked address, SNI and the server certificate verified against the host name, TLS 1.2 or later; a 3xx is refused (`redirect`), never followed; the answer is capped (1 MiB by default, `IPB-SEC-013`) and must be identity-encoded; one deadline (15 s by default) and the caller's `AbortSignal` (`IPB-PORT-002`, `timeout` or `aborted`, with `meta.maybeSent`). The certificate and key are checked with `checkClientCredential` and kept only in a TLS secure context for `credentialTtlMs` (5 minutes by default, never past notAfter); `checkCredentials()` resolves them without calling the partner and answers the dates and `x5tS256`; `forgetCredentials()` drops the cache. Refusals are `IPB-SEC-018`, `IPB-PORT-001`, `IPB-PORT-002` or `IPB-PORT-005` with a fixed `meta.reason`, never the URL's path or query, a header value, the body or the key. Only P-256 client keys and SECRETS-held keys (not KMS-held) for now (owner question #180). The public-address check, host-name rule and DNS pin of the `governed` adapter move unchanged to `egress/guard.ts` and are exported (`allAddressesPublic`, `checkPublicHostName`, `pinnedLookup`); `isPublicAddress` is exported as before. No setting or migration.
- a48347d: ESIGN signer certificates (Udofin PR-UDF-070; R1-D-251). `leegality` and `digio` fill each signature record's `signerCertificate` from the signed PDF's own signatures (`signerCertificatesFromPdf`): the k-th bound signature is the k-th signer to sign (envelope order when sequential, the ESP's signing times when parallel), and only when that mapping is certain (one bound signature per signer, distinct times); otherwise it stays unset. `nsdl-esign` has no records yet (#177). All three refuse `createMultiDocumentEnvelope` and `downloadSignedDocuments` with `unsupported` (their descriptor capabilities say so) until a vendor's multi-document support is verified. New helpers `withSignerCertificate` and `NO_MULTI_DOCUMENT`.

### Patch Changes

- Updated dependencies [75cbd9a]
- Updated dependencies [beca045]
- Updated dependencies [5b1257d]
- Updated dependencies [199c930]
- Updated dependencies [27057c2]
- Updated dependencies [a107b8d]
- Updated dependencies [a702fdc]
- Updated dependencies [f3293a2]
  - @infrabyx/contracts@1.45.0
  - @infrabyx/crypto@1.13.0
  - @infrabyx/tenancy@1.23.0
  - @infrabyx/config@1.23.1

## 1.27.0

### Minor Changes

- 450df6a: A customer step-up for sensitive borrower actions (Udofin PR-UDF-056; R1-D-244). `CustomerIdentityBase.startStepUp` and `confirmStepUp` (Keycloak and Zitadel customer adapters): a fresh one-time code to the account's registered login, made by the platform (salted SHA-256 only), sent through NOTIFY, bound to the key of the active device session and guarded like a sign-in code; on success the device's `step_up_at` and `step_up_acr` are recorded and ledgered (`identity.customer.device.step_up`). `verifyRequest` answers `acr` (`otp`) and `auth_time` (the later of the device's sign-in and its last step-up) and takes `fresh: true` to read the device past the 15 s cache. New `assertCustomerStepUp(claims, policy, now?)` (refuses with `IPB-SEC-001` in the step-up form: `meta.step_up`, `customer`, `required_acr`, `max_age`, nothing else) and `customerStepUpChallenge(e)` (the RFC 9470 401 with `WWW-Authenticate: DPoP error="insufficient_user_authentication", acr_values=..., max_age=...`); `stepUpChallenge` ignores a customer refusal. New optional `CustomerAuthStore.recordStepUp` (`PgCustomerAuthStore`, `MemoryCustomerAuthStore`), `activeDevice(..., { fresh })`, `DeviceRecord.stepUpAt`/`stepUpAcr`, `CUSTOMER_STEP_UP_ACTION`, `CUSTOMER_AUTH_TIME_SKEW_SECONDS`. Migration `0017_customer_device_step_up` (expand-only: two nullable columns on `connectors.customer_device`); apply it before upgrading. No IdP or Keycloak extension change.
- 179ac80: PR-UDF-054 (E8; R1-D-245): four new adapters, all off by default and `unproven` until their sandbox legs run. None buys anything and none adds cryptography.

  - **ESTAMP `shcil-estamp`** (`ShcilEstamp`, `int.estamp.shcil.enabled`): records an e-stamp certificate the RE bought through its own SHCIL channel and checks it with SHCIL's read-back (only the number, State and issue date are sent), `verify` reads it back, `attach` links one document. Vendor shapes are stub-shaped, to confirm against the sandbox.
  - **ESTAMP `digio-estamp`** (`DigioEstamp`, `int.estamp.digio.enabled`): the second stamping adapter; reads back a stamp Digio already issued to the RE, by Digio's id; never orders or affixes a stamp from prepaid inventory. Stub-shaped.
  - **ESTAMP `manual-paper`** (`ManualStampPaper`, `int.estamp.manual_paper.enabled`): records physical stamp paper or franking the RE holds (State, article, duty, serial, vendor's or agent's licence, stamped document hash checked against STORAGE, scanned certificate's document id); no network call at all.
  - The three share `RecordingEstamp` (`record.ts`): `purchase` refused `purchase_not_permitted`, `quoteDuty` and `handleWebhook` `unsupported`, `covers` false; one record per idempotency key; a certificate number once per State and channel (`certificate_reused`); the issuer's record compared (`certificate_mismatch`, `certificate_not_found`, `certificate_not_usable`); the purchaser's name never kept or sent. Products persist records through a `StampRecordStore` (`MemoryStampRecordStore` for tests; a product table needs a unique index on State, channel and number) and write them in their kernel mutation.
  - **ESIGN `nsdl-esign`** (`NsdlEsign`, `int.esign.nsdl.enabled`): a shell for NSDL eSign under the CCA eSign API. Envelopes are validated and kept locally (Aadhaar OTP and biometric only, never downgraded; the document checked against its SHA-256); `buildEsignRequestXml` builds the unsigned request; the ASP request signature (RSA XML-DSig) is refused `unsupported` (`step: asp_request_signature`) because it is not an approved cryptography item, and `downloadSigned`, `verifySignature`, `handleWebhook`, `dscSign` and `cancel` are `unsupported`. No network call; health is down.

### Patch Changes

- Updated dependencies [d4636a3]
- Updated dependencies [ae319d5]
- Updated dependencies [2d543fe]
- Updated dependencies [98a1d62]
- Updated dependencies [461fe2c]
  - @infrabyx/contracts@1.44.0
  - @infrabyx/config@1.23.0
  - @infrabyx/crypto@1.12.0
  - @infrabyx/tenancy@1.22.2

## 1.26.0

### Minor Changes

- 5c6298c: `PdfTextExtractor.extractText` passes a disabled or revoked named tenant key through as its own refusal (Udofin PR-UDF-067; R1-D-241). When the STORAGE read fails with `IPB-KMS-001` `storage_key_unavailable` (PR-UDF-058: the object's named key is disabled, deleted or no longer granted), the extractor now throws `IPB-KMS-001` (port `PDF`, adapter `pdf-text`) with `meta: { reason: "storage_key_unavailable" }` and nothing else (no key reference, vendor error name or cause), instead of `IPB-PORT-002` `unavailable`. Every other read failure, including an `IPB-KMS-001` with another reason, stays `IPB-PORT-002` `unavailable`; the parse refusals (`IPB-SEC-010`, `-013`, `-015`, `-011`) are unchanged. Minor, not patch: callers see a new code for this case, so one that treated every `IPB-PORT-002` as a retryable outage should handle `IPB-KMS-001` as "the key owner must restore the grant" instead.
- f0edee3: Named tenant key status (Udofin PR-UDF-068; R1-D-239). `contracts`: optional `StoragePort.keyRefStatus(tenantId, keyRef, { bucketClass, compartment?, describeKey? })` answering `{ status: "resolves", keyState? }` or `{ status: "refused", reason, keyState? }` with a write's refusal label or `storage_key_unavailable`, never a key id; `STORAGE_KEY_STATES`, `STORAGE_KEY_UNAVAILABLE`, `isValidStorageTenantId` and `storageKeyRefStatusRefusal`. `connectors`: `S3Storage.keyRefStatus` runs the write's own checks and, with `describeKey`, one read-only KMS `DescribeKey` (a key that is not `Enabled`, or that the role may not describe, answers `storage_key_unavailable`); `MinioStorage` declares it `unsupported`. `fakes`: `MemoryStorage.keyRefStatus` and a `keyStates` option. `testing`: a STORAGE built-in contract case. Read-only, not ledgered; no setting, no migration.
- 2d2729b: Named tenant keys in QUARANTINE (Udofin PR-UDF-066; R1-D-240). `contracts`: `NAMED_KEY_CLASSES` now includes `QUARANTINE`, so a lender's upload can be written under the lender's key (by `keyRef` or a prefix map) before its scan; `AUDIT`, `GENERAL` and `PUBLIC_ASSETS` still refuse a reference. New `promotedObjectMeta(from, to)` carries the reference into the clean write after the scan, so the copy is under that reference's key at the clean location or refused, never under the clean class's key. `connectors`: the `s3` adapter applies the same separation rules in `QUARANTINE`; the AV adapter's workload needs `kms:Decrypt` on each such key, and a read it may not decrypt keeps the file quarantined (`ERROR`). `testing`: a STORAGE built-in contract case for the upload and its promotion. No setting, no migration, no IAM change.

### Patch Changes

- Updated dependencies [648c511]
- Updated dependencies [9be2fc7]
- Updated dependencies [f0edee3]
- Updated dependencies [2d2729b]
  - @infrabyx/crypto@1.11.0
  - @infrabyx/contracts@1.43.0
  - @infrabyx/config@1.22.3
  - @infrabyx/tenancy@1.22.1

## 1.25.0

### Minor Changes

- dbb08e6: The verified email is deleted at account closure or on the borrower's erasure request (owner answer #161 (3); R1-D-235). Migration `0016_customer_verified_email_delete` (expand-only): DELETE on `connectors.customer_verified_email` for `app_rw` only, and a trigger that lets a row go only inside the kernel action `identity.customer.verified_email.delete`. New optional `CustomerAuthStore.deleteVerifiedEmail` (`PgCustomerAuthStore` and `MemoryCustomerAuthStore`; ledgered with the reason, never the address; a repeat is a ledgered no-op), `VerifiedEmailDeletionReason`, `VERIFIED_EMAIL_DELETE_ACTION`, `VERIFIED_EMAIL_ERASURE_REF`. `retireLogin` deletes the row (reason `account_closed`) before the IdP frees the login; `eraseVerifiedEmail` deletes it on erasure (reason `erasure_request`, with the request reference). A store that can save an address but not delete it makes both refuse with IPB-PORT-001 `unsupported`. Apply `connectors/0016` before upgrading.

### Patch Changes

- Updated dependencies [206b3c1]
- Updated dependencies [2cb5b3f]
- Updated dependencies [a38f921]
- Updated dependencies [f62dcaa]
- Updated dependencies [dbb08e6]
  - @infrabyx/tenancy@1.22.0
  - @infrabyx/contracts@1.42.0
  - @infrabyx/crypto@1.10.0
  - @infrabyx/config@1.22.2

## 1.24.1

### Patch Changes

- Updated dependencies [98c9416]
  - @infrabyx/contracts@1.41.0
  - @infrabyx/config@1.22.1
  - @infrabyx/crypto@1.9.2
  - @infrabyx/tenancy@1.21.4

## 1.24.0

### Minor Changes

- 053e16a: Borrower email with byte-identical attachments and a delivery receipt, and the verified email (Udofin PR-UDF-055; R1-D-224). `contracts`: `NotificationRequest.attachments` (`NotificationAttachment`: STORAGE key, SHA-256, file name, PDF, PNG or JPEG; at most 10), `DeliveryRecord.vendorRef` and `DeliveryRecord.attachments` (the receipt), `EmailMessage.files` (`EmailAttachment`: verified bytes, sent unchanged, only to an adapter with `attachments: "native"`), `EMAIL_ATTACHMENT_LIMITS`, `EMAIL_ATTACHMENT_MEDIA_TYPES`, `emailAttachmentTypeOf`, `attachmentExtensionFits`; optional `CustomerIdentityPort.startEmailVerification`, `confirmEmailVerification` and `verifiedEmail` (`VerifiedCustomerEmail`). `config`: the settings `ntf.email.attachments.enabled` (tenant), `ntf.email.attachments.confidential` and `int.identity.customer.email_capture.enabled` (platform), all off. `notify`: attachments read from STORAGE at send and checked (class, type, SHA-256, 10 MiB) before the adapter; the receipt in `deliveryStatus`; migration `0008_email_attachments` (two nullable columns; expand-only). `connectors`: `ses` and `brevo` take `files` and check each SHA-256 again; the verified-email capture in the customer IDENTITY adapters (`emailCapture` option, `readCustomerEmailCapture`, `CustomerAuthStore.saveVerifiedEmail` and `verifiedEmail`, optional); migration `0015_customer_verified_email` (expand-only). `testing`: the SES and Brevo stubs record each attachment's SHA-256. Everything is off by default; nothing existing changes. Apply `notify/0008` and `connectors/0015` before turning either feature on.
- ce8ca22: Owner answers of 20 Nov 10:50 (R1-D-229), all optional and additive. `contracts/events`: `KfsIssuedData.loan_amount_paise` (the KFS "Loan amount", integer paise, distinct from the net disbursed amount; PR-UDF-051); `ExecutionPackManifest.disbursement_clause { document_id, page_or_clause_ref, amount_stated_paise }`, whose document must be in the pack (PR-UDF-053); `SecurityIncidentNotifiedData.cert_in_category` (`CERT_IN_INCIDENT_CATEGORIES`, CERT-In Directions Annexure I) and `cert_in_report_by` (at most `detected_at` + 6 h), with `certInReportBy(noticedAt)` and `CERT_IN_REPORT_WINDOW_MS`, carried by `securityIncidentClockCopy` (PR-FBX-51, #159 (a)). `connectors`: a `tenantNamedKmsKeyIds` value may be `{ keyId, bucketKey?: boolean }` (`NamedKmsKey`); `bucketKey: false` writes and presigned uploads under that reference with S3 Bucket Keys off (a KMS request per object operation); the string form is unchanged, Bucket Keys on (PR-UDF-058, #165 (3)). `fakes`: `FakeLender` sends the KFS loan amount and the manifest's disbursement clause. `testing`: two lender contract cases for them; the GRC incident case sends the CERT-In fields.
- b135555: No-cache presigned downloads (Udofin PR-UDF-060; R1-D-230). `connectors`: a presigned `get` of a `REGULATED` or `CONFIDENTIAL` object (compartments included), on `s3` and `minio`, signs the response overrides `response-cache-control=no-store, private` and `response-expires=Thu, 01 Jan 1970 00:00:00 GMT`, so the store answers with `Cache-Control: no-store, private` and a past `Expires` and devices and webviews keep no copy; the overrides follow the bucket the URL reads from and cannot be dropped by a caller. Other classes and upload URLs are unchanged. S3 has no `Pragma` override: `Cache-Control: no-store` supersedes it for HTTP/1.1 clients. `contracts`: `NO_CACHE_PRESIGN_CLASSES`, `PRESIGN_NO_CACHE` and `presignNoCache`. `fakes`: `MemoryStorage` adds the same parameters to its download URLs. `testing`: a STORAGE contract case checks the URL and, on HTTP stores, the headers returned. No setting, no migration.

### Patch Changes

- Updated dependencies [053e16a]
- Updated dependencies [ce8ca22]
- Updated dependencies [b135555]
- Updated dependencies [48810fd]
- Updated dependencies [1ffb012]
  - @infrabyx/contracts@1.40.0
  - @infrabyx/config@1.22.0
  - @infrabyx/crypto@1.9.1
  - @infrabyx/tenancy@1.21.3

## 1.23.0

### Minor Changes

- 3b57c29: The GRC port and the §6.15 GRC events (Finbyx PR-FBX-51; R1-D-220; ADR-0013). `contracts/events` adds the v1 data schemas `ControlTestResultPublishedData`, `ComplianceIssueRaisedData`, `ReturnStatusUpdatedData`, `PolicyAttestedData` and `SecurityIncidentNotifiedData` with their type constants (`in.infrabyx.grc.<Event>.v1`) and enums, `GRC_EVENTS` (type, schema, idempotency fields, direction, regulated; with `EvidenceSubmitted` and `ObligationPublished`), `grcIdempotencyKey`, `grcPersonalDataProblems` (every schema refuses an Aadhaar-like number or a PAN anywhere in the data), `GRC_MASKED_ID`, `RETURN_PERIOD` and `securityIncidentClockCopy` (the OH13 copy). `contracts/ports` adds `GrcPort` on the Ecosystem Spec §9.2 generic connector contract: `listObligations({ updatedSince?, cursor?, limit? }, call?)` → `{ items: GrcObligation[], nextCursor? }` and `publishControlTestResult`, `submitEvidence`, `raiseIssue`, `notifyIncident`, `updateReturnStatus`, `recordPolicyAttestation` (the event data, `call?`) → `GrcReceipt`, with `GRC_POST_METHODS`, `GRC_REFUSALS`, `grcRefusal`, `assertGrcClass`, `prepareGrcPost`, `prepareGrcObligationQuery` and the catalogue entry (tier 2, `int.grc.`, in `R1_PORTS`). Every POST is keyed (the caller's key, else the event's own); the same key and body answer the same receipt, another body is `IPB-PORT-004`; incident updates are taken in `update_seq` order (`out_of_order`); a call above CONFIDENTIAL and any personal data are `IPB-PORT-003`. `config` registers `int.grc.generic.enabled` (false) and `int.grc.generic.host` (empty). `connectors` adds `@infrabyx/connectors/grc`: `GenericGrc` (`generic-grc`), the §9.2 REST contract to one configured host with a bearer token from SECRETS, stub-shaped where §9.2 is silent, off and unproven; its router method table and exit entry. `fakes` adds `FakeGrc`, `GrcFixtures` and `grcFakeFixtures`; `testing` adds `grcContractCases`, `grcSamples`, `grcObligations` and `startGrcStub`. No migration; nothing existing changes.
- 4d509e6: STORAGE puts under a named tenant key (Udofin PR-UDF-058; R1-D-227), so a vault keeps each lender's files under that lender's own KMS key. `contracts/ports`: optional `ObjectMeta.keyRef` and `PresignOptions.keyRef` (a reference such as `lender:<id>`, never a key id), `isValidStorageKeyRef`, `NAMED_KEY_CLASSES` (`CONFIDENTIAL`, `REGULATED`), `STORAGE_KEY_REF_META`, `STORAGE_KEY_REF_REFUSALS` and `resolveStorageKeyRef`. `connectors`: `S3StorageOptions.tenantNamedKmsKeyIds` and `tenantKeyRefPrefixes`; a named write is encrypted under the resolved key, records the reference (`get` returns `meta.keyRef`), and is refused (never sent under the class key) for an unknown, malformed, misplaced, shared or changed reference or for a tenant with its own CMK; a disabled or revoked named key reads as `IPB-KMS-001` `storage_key_unavailable` (failures of objects under platform keys are unchanged); `minio` refuses a reference as `unsupported`. `fakes`: `MemoryStorage(now, { keyRefs, keyRefPrefixes })` records the reference (none known by default). `testing`: a built-in STORAGE contract case for named keys; a STORAGE adapter outside the platform either configures `lender:contract` and `lender:contract-b` for tenant `tnt_contract` in `REGULATED` in its contract leg or declares `put.keyRef` unsupported. Writes without a reference are unchanged.

### Patch Changes

- Updated dependencies [5fd012a]
- Updated dependencies [3b57c29]
- Updated dependencies [4d509e6]
  - @infrabyx/contracts@1.39.0
  - @infrabyx/crypto@1.9.0
  - @infrabyx/config@1.21.0
  - @infrabyx/tenancy@1.21.2

## 1.22.1

### Patch Changes

- Updated dependencies [3c4b588]
  - @infrabyx/contracts@1.38.0
  - @infrabyx/crypto@1.8.0
  - @infrabyx/config@1.20.1
  - @infrabyx/tenancy@1.21.1

## 1.22.0

### Minor Changes

- 82dc7ef: The AA consent's FIU check, approval link and product reference (Udofin PR-UDF-050; R1-D-204). `contracts`: `AaConsentRequest.fiuId?` (the FIU the consent is for, `AA_FIU_ID_REGEX`) and `AaConsentRequest.consentArtefact?` (the product's own `{ kind, id }`, R1-D-203; `consentRef` is unchanged, the required `cpr_` string); `AaConsent.fiuId?` (the FIU the AA reports) and `AaConsent.approvalUrl?` (the AA's customer approval page, only while PENDING); `aaFiuMismatch`, `AA_FIU_MISMATCH` (`fiu_mismatch`), `aaApprovalUrlAllowed` (`https:`, no user information, an exact listed host, and no 12-digit run or Aadhaar-like number once every RFC 9562 UUID is set aside, so an id whose last group is all digits is accepted; owner answer #154), `RFC9562_UUID`, `isRfc9562Uuid` and `AA_APPROVAL_URL_REFUSED` (`approval_url_not_allowed`). When a request names a FIU, a consent the AA reports for another FIU, or for none, is refused `IPB-PORT-001` `fiu_mismatch` (definite) before anything is kept or returned, and so is every later read-back (`consentStatus`, `revoke`, `fetch`, `handleWebhook`); a request without `fiuId` is compared with nothing, as before. `connectors` (`SetuAccountAggregator`): reads the FIU from the consent read-back's `detail.FIU.id`, keeps the asked FIU in `SetuConsentRecord.fiuId`, answers Setu's link as `approvalUrl` while PENDING only after `aaApprovalUrlAllowed` against the new `approvalHosts` option (default Setu's two hosts), reads the consent back before keeping its record so a refused one leaves none, and deprecates `approvalUrl(consentId)`. `fakes` (`FakeAccountAggregator({ fiuId?, approvalHost? })`) reports its own FIU (`fake-fiu`) and a letters-only link while PENDING, with `reportFiu` and `consentsKept` test hooks; `AccountAggregatorFixtures` gains optional `fiuId` and `reportFiu`. `testing` adds the AA contract cases (calls with and without a consent artefact, the FIU refusals, the link only while PENDING, an Aadhaar-like sweep) and the Setu stub's `fiuId`, `reportFiu`, `linkBase` and `nextConsentId` hooks (its ids are any random UUID, an all-digit last group included).
- 2f9d3f8: Aadhaar OTP e-KYC for a notified reporting entity (Udofin PR-UDF-041; R1-D-194). `KycPort.aadhaarOtpRequest({ uid, uidKind, consent }, call)` returns `{ txn, expiresAt }` with the evidence and `aadhaarOtpVerify({ txn, otp }, call)` returns `{ ekyc, signatureValid, uidLast4 }` with the evidence; both optional on the interface, provided by `FakeKyc`, `DigioKyc`, `IdfyKyc` and `kycMethodRouter` (the new `aadhaar_otp` method). Every call is refused `not_configured` before any vendor call unless the adapter is built with `notifiedEntity: true`. `contracts` adds `AadhaarOtpRequest`, `AadhaarOtpVerify`, `AADHAAR_UID_KINDS`, `AADHAAR_OTP_REFUSALS` (`uid_invalid`, `mobile_not_linked`, `otp_invalid`, `otp_expired`, `not_configured`) and `aadhaarUidValid` (12-digit Aadhaar number with first digit 2 to 9, or 16-digit VID, each with the Verhoeff check; grouped forms refused). The e-KYC response is written to the adapter's STORAGE; one that carries a full number is refused `ekyc_holds_number`. `aadhaarOtpVerify` is idempotent on `call.idempotencyKey` for 24 hours: a retry gets the first answer, the same key with another code or transaction is `IPB-PORT-004`. `connectors` adds `AadhaarOtpVerifyStore`, `PgAadhaarOtpVerifyStore`, `MemoryAadhaarOtpVerifyStore` and the migration `0011_kyc_aadhaar_otp_verify.sql` (`connectors.kyc_aadhaar_otp_verify`, forced RLS); `IdfyKyc` gains `currentTenant`. `fakes` adds `FAKE_AADHAAR_OTP`, `syntheticUid`, `AadhaarOtpFixtures` and `KycFixtures.aadhaarOtp`; `testing` adds five contract cases and the Digio and IDfy stubs' Aadhaar OTP.
- 9e626ef: Bank account checks by mode, keyed retries and the penny-drop funding statement (Udofin PR-UDF-043; R1-D-196). `BankAccountCheck` gains an optional `mode` (`"pennyless"` or `"penny_drop"`, `BANK_ACCOUNT_MODES`) and `BankAccountResult` an optional `mode` (the mode used; always set by the platform's adapters and the fake). An adapter that cannot honour the mode asked refuses `IPB-PORT-002` with `meta.reason: "mode_unsupported"` (`BANK_ACCOUNT_MODE_UNSUPPORTED`) before any vendor call, never falling back to another mode; omitted, the adapter's configured mode is used and reported. `bankAccountVerify` is idempotent on `call.idempotencyKey` for 24 hours: a retry gets the first answer with no vendor call, and the same key with another account, IFSC, name or mode is `IPB-PORT-004`; a keyed penny drop whose first call did not finish is never sent again (`pending_unresolved`). The status set is unchanged (`BANK_ACCOUNT_STATUSES`). `contracts` adds `KYC_ADAPTER_FUNDING` and `kycAdapterFunding(adapter)`: per adapter, who funds a penny drop (`provider`, `tenant` or `unknown`) and the source, a statement only; Digio and IDfy are `unknown` until verified. `DigioKyc` and `IdfyKyc` now provide pennyless bank account checks (stub-shaped, adapters off) and refuse a penny drop `mode_unsupported`; `connectors` adds `BankAccountVerifyStore`, `PgBankAccountVerifyStore`, `MemoryBankAccountVerifyStore`, `keyedBankAccountVerify` and the migration `0012_kyc_bank_account_verify.sql` (`connectors.kyc_bank_account_verify`, forced RLS); `kycMethodRouter` moves a check past an adapter that refuses `mode_unsupported`, but not a keyed check or a penny drop past an unavailable one; the router's breaker no longer counts `mode_unsupported`. `FakeKyc` honours both modes (options `bankAccountModes`, `bankAccountMode`) and counts `bankAccountVendorCalls`; `fakes` adds `KycFixtures.bankAccount` (`BankAccountFixtures`); `testing` adds four contract cases and the Digio and IDfy stubs' bank accounts.
- aac1c2c: A product's own consent artefact beside the bureau consent receipt (Udofin PR-UDF-049; R1-D-203, owner answer #153). `BureauPullRequest.consentRef` is unchanged (the required `cpr_<ULID>` string), so no caller or adapter outside the platform needs a change. New optional `BureauPullRequest.consentArtefact: { kind, id }`, the product's own purpose-consent artefact for the same pull, and `BureauReport.consentArtefact?`, echoed only when the request carried one (an answer to a pull without it is exactly as before). `contracts` adds `ports/consent-ref`: `ConsentReceiptRef` (the `cpr_` string), `ConsentArtefact` (strict `{ kind, id }`: `kind` one to four dot-separated `[a-z][a-z0-9_]*` segments, 3 to 64 characters, `cpr` and `cns` reserved; `id` 3 to 128 characters of `[A-Za-z0-9._-]`, not a platform `cpr_`/`cns_` id; neither may hold a standalone run of 10 or more digits, an Aadhaar-like number (`findAadhaarLike`) or a standalone PAN-shaped run; each refusal a fixed label from `CONSENT_ARTEFACT_REFUSALS`), `consentArtefactProblem`, `consentInForce` (the artefact as `<kind>:<id>` when present, else `consentRef`) and `consentEcho`. The platform checks an artefact's shape only; the product asserts the consent behind it. Neither is sent to the CIC. `fakes` (`FakeCreditBureau`) and `connectors` (`CibilBureau`, whose pull record keeps `consentArtefact?` beside `consentRef`) accept and echo both; `testing` adds contract cases for calls with and without an artefact and the refusals, `contractConsentArtefact` and `malformedConsentArtefacts`.
- d58d5f0: DigiLocker start, document evidence and idempotent pulls (Udofin PR-UDF-040; R1-D-193). `KycPort.startDigilocker({ docTypes, returnUrl }, call)` returns `{ consentSession, signInUrl, expiresAt }` with the evidence; optional on the interface, provided by `FakeKyc`, `DigioKyc` and `kycMethodRouter`, refused `unsupported` by `IdfyKyc`. The return address must pass `digilockerReturnUrlAllowed` (`https:`, no user information, no 12-digit run, a host on the adapter's `digilockerReturnHosts`), else `return_url_not_allowed`. `DigilockerDocument` gains `evidence` and `signatureValid` (`null` when the vendor does not report it). `digilockerPull` is idempotent on `call.idempotencyKey` for 24 hours: a retry returns the stored documents instead of `consent_used`, the same key with another session or other types is `IPB-PORT-004`. `connectors` adds `DigilockerPullStore`, `PgDigilockerPullStore` and `MemoryDigilockerPullStore` and the migration `0010_kyc_digilocker_pull.sql` (`connectors.kyc_digilocker_pull`, forced RLS); the Digio stub gains the start and `completeDigilocker`; `kycContractCases` gains three cases and `KycFixtures.digilockerReturnUrl`.
- dbaecff: V-CIP webhooks verified without a vendor call (Udofin PR-UDF-046; R1-D-199). `KycPort.verifyWebhook(rawBody, headers, meta?) → { eventId, vcipId, receivedAt }` (`KycWebhookReceipt`), optional on the interface, checks a webhook's size, signature, window and replay only, with no vendor call and no read-back, so a product answers 401 to an unverified event, records `eventId` in its module inbox, acknowledges within 2 s and reads the session back with `vcipStatus` from its queue (IPB-10-27). `handleWebhook` keeps its signature and, where `verifyWebhook` exists, is `verifyWebhook` and then `vcipStatus`. `contracts` adds `verifyKycWebhookWith` (the order: the body's size, at most `KYC_WEBHOOK_MAX_BODY_BYTES` (64 KiB) before anything is read; the Standard Webhooks headers; the signature and `KYC_WEBHOOK_TOLERANCE_SECONDS` (300) window; the replay claim on the delivery's id and timestamp; then the session id), `KYC_WEBHOOK_REFUSALS` (`body_too_large`, `signature_invalid`, `timestamp_stale`, `event_replayed`; `IPB-API-018`, definite), `kycWebhookRefused`, `KYC_WEBHOOK_MALFORMED` (`IPB-PORT-001` for a verified event naming no session) and `KycWebhookReplayStore`. `crypto` adds `verifyStandardWebhook` (C-13: HMAC-SHA-256 over `<id>.<timestamp>.<body>` as IPB-10-21 defines it, constant time, ±5 minutes, `whsec_` secrets, rotation, `v1` only) and `signStandardWebhookForTest`; no new algorithm. `FakeKyc` verifies Standard Webhooks (`FAKE_KYC_WEBHOOK`, `signFakeKycWebhook`, option `webhook: { secrets, replay }`, `vcipStatusVendorCalls`), and its `handleWebhook` now refuses an unsigned event. `KycFixtures.webhook` (optional) drives two new contract cases. `connectors` adds `standardWebhookKycVerifier` for an adapter whose provider signs with Standard Webhooks; `DigioKyc` and `IdfyKyc` refuse `verifyWebhook` `unsupported`; `kycMethodRouter` routes it under `vcip`. **Products: `FakeKyc.handleWebhook` and `verifyWebhook` now refuse an unsigned delivery, so a test that posts an event to the fake must sign it with `signFakeKycWebhook(body)` (from `@infrabyx/fakes` or `@infrabyx/testing`) and pass the headers it returns.** C-13 covers Standard Webhooks v1 by the owner's approval (R1-D-210); RFC 9421 is not approved.
- 80a843a: Liveness by mode, applied thresholds, keyed retries and the template retention statement (Udofin PR-UDF-044; R1-D-197). `LivenessCheck` gains an optional `mode` (`"passive"`, `"active_gesture"` or `"active_voice"`, `LIVENESS_MODES`) and `ScoreResult` an optional `threshold` (the threshold the adapter applied, for liveness and face match) and `mode` (the liveness mode used); the platform's adapters and the fake always set them. An adapter that cannot honour the mode refuses `IPB-PORT-002` with `meta.reason: "mode_unsupported"` (`KYC_MODE_UNSUPPORTED`, which `BANK_ACCOUNT_MODE_UNSUPPORTED` now equals) before any vendor call, never falling back; omitted, the configured mode is used and reported. `livenessCheck` and `faceMatch` are idempotent on `call.idempotencyKey` for 24 hours, a key scoped to its method: a retry gets the first answer with no vendor call, and the same key with other frames, another mode or other images is `IPB-PORT-004`. `score` is a finite number from 0 to 1 (`kycScoreValid`): an adapter normalises a vendor score on its known scale and refuses any other `IPB-PORT-003` with `meta.reason: "score_out_of_range"` (`KYC_SCORE_OUT_OF_RANGE`), never clamping. `contracts` adds `KYC_ADAPTER_RETENTION` and `kycAdapterRetention(adapter)`: per adapter, whether the vendor keeps a face template or embedding beyond the call (`none`, `kept` or `unknown`) and the source, a statement only; Digio and IDfy are `unknown` until a written vendor statement. `IdfyKyc` honours `passive` liveness only (its photo liveness), reports its thresholds (now checked to be from 0 to 1), reads scores on the scale `IDFY_SCORE_SCALE` (1, or the option `scoreScale: 100`) and refuses one off it instead of guessing the scale and clamping; `DigioKyc` has no liveness or face-match path and still refuses both `unsupported`. `connectors` adds `KycScoreCheckStore`, `PgKycScoreCheckStore`, `MemoryKycScoreCheckStore`, `keyedScoreCheck`, `livenessMode`, `scoreOnScale` and the migration `0013_kyc_score_check.sql` (`connectors.kyc_score_check`, forced RLS; no image, template, embedding or storage reference in clear); `kycMethodRouter` moves any call past `mode_unsupported` and keeps a keyed liveness check or face match with an unavailable adapter. `FakeKyc` honours every liveness mode (options `livenessModes`, `livenessMode`, `livenessThreshold`, `faceMatchThreshold`), counts `livenessVendorCalls` and `faceMatchVendorCalls`, and `offScaleNext()` makes its next score off the scale; `fakes` adds `KycFixtures.scores` (`ScoreFixtures`); `testing` adds seven contract cases and the IDfy stub's `livenessChecks`, `faceMatches` and `scoreOnce`.
- ff2a74b: The STATEMENT_ANALYSIS port, its adapters and its fake (Udofin PR-UDF-048; R1-D-202; ADR-0012). `contracts` adds `StatementAnalysisPort`: `analyse({ subjectRef, inputs: [{ fiType, storageKey, sha256 }], reportPrefix }, call?) → StatementAnalysis` (`analysisId` `sta_<ULID>`, `state` `COMPLETED`, `PENDING` or `FAILED`, `report?: { storageKey, sha256 }`, `failureReason?`, `adapter`, `method`, `vendorRef`, `checkedAt`), `status(analysisId, call?)` and `handleWebhook(rawBody, headers, meta?)`, with `StatementAnalysisRequest` (strict; STORAGE references and SHA-256s only, up to 24 inputs in the report prefix's tenant, no Aadhaar-like subject reference; every field REGULATED), `StatementAnalysisResult`, `statementAnalysisResultOnly`, `STATEMENT_ANALYSIS_FAILURES`, `STATEMENT_ANALYSIS_REFUSALS`, `assertStatementAnalysisClass`, `statementInputFormat`, the catalogue entry (tier 2, `int.statement_analysis.`, in `R1_PORTS`), the `sta` id prefix and `PORT_DEFAULT_DATA_CLASS.STATEMENT_ANALYSIS = "REGULATED"`. `config` registers `int.statement_analysis.platform.enabled`, `int.statement_analysis.http.enabled` (both false) and `int.statement_analysis.http.host` (empty). `connectors` adds `@infrabyx/connectors/statement-analysis`: `PlatformStatementAnalyser` (`platform-statement`, the reference: in-platform, no vendor or egress, a checksum-summary report and nothing from a statement's content) and `HttpStatementAnalyser` (`http-statement`, a vendor-neutral HTTP alternative, every vendor shape stub-shaped), both off and refusing `handleWebhook` `unsupported`; `StatementAnalysisStore`, `PgStatementAnalysisStore`, `MemoryStatementAnalysisStore` and the migration `0014_statement_analysis.sql` (`connectors.statement_analysis`, forced RLS, hashes and references only, 24 hours); keyed retries answer the same analysis with one analyser call and the key with another request is `IPB-PORT-004`; an input outside the REGULATED class, or a call class other than REGULATED, is `IPB-PORT-003` before any analyser call, and the router's method table refuses an instance that cannot carry REGULATED. `fakes` adds `FakeStatementAnalysis` (its webhook signed with the approved C-22 profile under a development key), `signFakeStatementAnalysisNotification`, `fakeStatementAnalysisWebhookKeys` and `StatementAnalysisFixtures`; `testing` adds `statementAnalysisContractCases`, `statementAnalysisFakeFixtures`, `contractStatement`, `startStatementAnalysisStub` and the ESLint plugin's port default. Run `infrabyx-migrate` for `connectors/0014` if you wire the adapters' PostgreSQL store.
- d35f7e9: The RE-hosted V-CIP launcher and its signed hand-off (Udofin PR-UDF-045; R1-D-198). `KycPort.launchVcip({ context, jws }, call) → { vcipId, launchUrl, expiresAt }` (`VcipLaunch`, with the evidence), optional on the interface, lets an LSP hand a customer to an RE's V-CIP without hosting any V-CIP component. `contracts` adds `VcipHandoffContext` (tenant, RE, LSP, customer reference, journey id, issued-at, expires-at, nonce: ids and times only, strict, at most `VCIP_HANDOFF_MAX_LIFETIME_SECONDS` (900) from issue to expiry, no field with a 12-digit run or an Aadhaar-like number), `LaunchVcip`, `VCIP_HANDOFF_REFUSALS` (`handoff_invalid`, `handoff_replayed`, `handoff_expired`), `vcipHandoffFailure`, `vcipHandoffTimeRefusal`, `vcipLaunchUrlAllowed` (`https:`, the adapter's exact hosts, no user information, no number) and `VCIP_LAUNCH_URL_REFUSED`. The LSP signs the context with the existing `signRegulatedMessage`; the adapter verifies it with `verifyRegulatedMessage` and its replay store before any vendor call (nothing new in cryptography), and refuses `IPB-PORT-001` with a fixed label, definite. `vcipStatus(vcipId, call?)` takes an optional `PortCall` and reads under its tenant. `VcipManifest` gains `reasonCode` (`VCIP_REASON_CODES`) and `liveness.mode` (`LIVENESS_MODES`); the free-text `reason` stays, deprecated, never to be shown. `VcipSession` gains an optional `vcipId` to start a launched session. `FakeKyc` implements the launcher (`FAKE_VCIP_HANDOFF`, `signFakeVcipHandoff`, `fakeVcipHandoffKeys`, `fakeVcipHandoffContext`, `vcipLaunchVendorCalls`); `KycFixtures.vcipLaunch` (optional) drives three new contract cases. `VcipConductor` takes hand-offs (`handoff: { reId, issuers, replay, launchBaseUrl, launchHosts? }`), schedules the session the RE's official starts with `startVcip({ …, vcipId })`, expires it with its hand-off (`launch_expired`), takes a `reasonCode` on `complete` and `drop`, a liveness `mode` on `assess`, and a `PortCall` or tenant on `vcipStatus`. `DigioKyc` and `IdfyKyc` refuse `launchVcip` `unsupported`; `kycMethodRouter` routes it under `vcip` and never moves a launch past an unavailable adapter.

### Patch Changes

- 1cdbf0f: Aadhaar offline verification names its form (Udofin PR-UDF-039; R1-D-190). `AadhaarOfflineCheck.kind` (`AADHAAR_OFFLINE_KINDS`: `xml_zip`, the default, or `secure_qr`): the ZIP needs its share code, a Secure QR is refused with one; `AadhaarOfflineResult.kind` echoes it. The contract states the stored-object SHA-256 check before any parse or vendor call (`hash_mismatch`) and that no field carries more than the last four digits. Digio refuses `secure_qr` as `unsupported` until its path is checked against UIDAI's Secure QR specification; the fake verifies both forms. `kycContractCases` gains the case.
- b0e0b72: One no-Aadhaar rule, its scanner and a test-database sweep (Udofin PR-UDF-042; R1-D-195). `contracts` adds the subpath `@infrabyx/contracts/aadhaar`: `findAadhaarLike(text, { letters? })` returns `{ kind: "AADHAAR" | "VID", start, end, masked }` for each 12-digit Aadhaar number (first digit 2 to 9, Verhoeff) and 16-digit VID (Verhoeff), plain or grouped in fours, bounded by a non-digit (a letter or `+` is a boundary; `letters: "join"` makes a letter part of the run), masked to the last four digits; also `holdsAadhaarLike` and `AADHAAR_LIKE_KINDS`. `verhoeffValid` moves there and is re-exported unchanged from the root and `./search-refusal`. `testing` adds `startPostgres({ beforeDrop(admin) })` (run by `end()` before the drop; a throwing hook still drops the database, then `end()` rejects with its error), the `infrabyx-aadhaar-scan` bin (exit 1 on a find, 0 on none, 2 on a usage error; masked output only), and `scanTextForAadhaar`, `scanPathsForAadhaar` and `scanDatabaseForAadhaar` (also as `@infrabyx/testing/aadhaar-scan`). `ai`'s scrubber uses the shared rule for its AADHAAR detector: a 16-digit VID is now tokenised as `AADHAAR`, and twelve digits right after a `+` are no longer missed; `verhoeffValid` keeps its behaviour. `connectors`' e-KYC check (`holdsAadhaarNumber`) uses the shared rule with `letters: "join"` and now also refuses a grouped number.
- 7d70042: Keycloak IDENTITY (CVE-2026-114938, CRITICAL; owner answer #143, R1-D-192): no code change in the adapters. Run the platform's Keycloak customer image as built from this release: its entrypoint turns the HotSpot Base64 intrinsic off (`-XX:-UseBASE64Intrinsics`) on every start and every node, and its build fails without it. On the stock Keycloak image, or with your own entrypoint, make `JAVA_OPTS_APPEND` end with `-XX:-UseBASE64Intrinsics` on every node and check your own scans (product guide §7cp).
- Updated dependencies [82dc7ef]
- Updated dependencies [1cdbf0f]
- Updated dependencies [2f9d3f8]
- Updated dependencies [b0e0b72]
- Updated dependencies [1cdbf0f]
- Updated dependencies [9e626ef]
- Updated dependencies [aac1c2c]
- Updated dependencies [62dc1eb]
- Updated dependencies [d58d5f0]
- Updated dependencies [dbaecff]
- Updated dependencies [80a843a]
- Updated dependencies [1cdbf0f]
- Updated dependencies [ff2a74b]
- Updated dependencies [d35f7e9]
  - @infrabyx/contracts@1.37.0
  - @infrabyx/tenancy@1.21.0
  - @infrabyx/crypto@1.7.0
  - @infrabyx/config@1.20.0

## 1.21.0

### Minor Changes

- 955cc67: TallyPrime agent key notices (owner answer #139 (1); R1-D-186). `TallyAgentService.sendKeyNotices(ctx)` tells the tenant's administrators on day 80 and again on day 85 of an agent's key, once each, through the new platform notification class `accounting.agent_key_expiring` (mandatory, in-app and email); `TallyAgentView.keyNoticeDay`; `TALLY_AGENT_KEY_NOTICE_DAYS` and `TALLY_AGENT_KEY_NOTICE_CLASS`. From day 90 the gateway's 403 says how to re-enrol (`keyExpiredDetail`). Migration `connectors/0009` (expand-only): `tally_agent.key_notice_day`. Help entry `hlp.notify.accounting.agent_key_expiring`.

### Patch Changes

- Updated dependencies [4af2688]
- Updated dependencies [955cc67]
  - @infrabyx/contracts@1.36.0
  - @infrabyx/config@1.19.0
  - @infrabyx/crypto@1.6.2
  - @infrabyx/tenancy@1.20.7

## 1.20.0

### Minor Changes

- 3a33260: PR-FBX-49 (R1-D-182): the realm half of the product MFA floor. `KeycloakRealmSpec.mfaFloor` marks every floor role (product roles included) for MFA, and `applyRealm` now adds missing roles and markers to a realm that already exists (never removes one); a floor role the realm lacks fails `ipbRealm`. `KeycloakIdentityOptions.mfaFloor` gives the enrolment action to users who get a floor role on creation or through a sync, never an SMS action for an SMS-excluded role (`KEYCLOAK_NON_SMS_ENROLMENT_ACTIONS`), and `requireMfaEnrolment()` flags existing holders without a factor. Zitadel: the login policy's second factors (TOTP and U2F) are part of `ZITADEL_IPB_SETTINGS` and read back by `readSettings`, and `zitadelClaims` keeps Zitadel's RFC 8176 `amr` values (adding `webauthn` for `user`) instead of collapsing them to `mfa`, so an SMS-excluded role is no longer refused on Zitadel after TOTP or a security key.
- a6929eb: Owner answer #136 (4) (R1-D-184): how a TallyPrime agent keeps its key, and a 90-day key life. `AgentEnrolRequest.keyProtection` (`dpapi` or `file`; omitted by older agents, read as `file`), `TALLY_AGENT_KEY_MAX_DAYS` (90), `TALLY_AGENT_KEY_WARN_DAYS` (80), `TALLY_KEY_PROTECTIONS`; `TallyAgentView` gains `keyProtection`, `keyExpiresAt`, `rotationDue` and `warnings` (`key_unencrypted`, `key_expired`). `connectors`: migration `connectors/0008` (`tally_agent.key_protection`, set once with the key); the enrolment records the protection and, for `file`, a warning in its ledger entry; from day 90 the gateway refuses the agent's requests until it is enrolled again. The agent (1.1.0, built from source) keeps its key under Windows DPAPI for its service account through Windows PowerShell 5.1, with the key on standard input only; the mode-0600 file is the fallback elsewhere. Runbook `docs/runbooks/tally-agent.md`.

### Patch Changes

- Updated dependencies [a6929eb]
  - @infrabyx/contracts@1.35.0
  - @infrabyx/config@1.18.1
  - @infrabyx/crypto@1.6.1
  - @infrabyx/tenancy@1.20.6

## 1.19.0

### Minor Changes

- 3e69471: The TallyPrime adapter of the ACCOUNTING sink (PR-FBX-46, R1-D-178), at `@infrabyx/connectors/accounting`: `TallyAccountingSink` (`tallyprime`), `TallyAgentService` (enrolment under R3 maker-checker, one-time codes, revocation) and `TallyAgentGateway` (the framework-free agent API). Migration `connectors/0007` (`tally_agent`, `tally_journal`, `tally_read`, role `svc_tally_poll`). Off until a tenant sets `int.accounting.tally.enabled`; unproven until a TallyPrime sandbox company exists.

### Patch Changes

- Updated dependencies [3e69471]
- Updated dependencies [3e69471]
- Updated dependencies [3e69471]
  - @infrabyx/config@1.18.0
  - @infrabyx/contracts@1.34.0
  - @infrabyx/crypto@1.6.0
  - @infrabyx/tenancy@1.20.5

## 1.18.0

### Minor Changes

- 34f5e49: Inbound mail replies (PR-LDC-50, R1-D-177): `SesEmail.verifyInbound` takes SES email receiving's signed `Received` notifications from a separate SNS topic (`inbound.topicArn`), with the message inline (SNS action) or read from the configured inbound S3 bucket in India (S3 action, capped at 10 MiB), and the SPF, aligned-DKIM and DMARC verdicts from the signed receipt only. `ses` and `brevo` send a message's own `replyTo` in place of the brand's. Brevo offers no inbound route (no payload signature or receiving-side verdict); the exit runbook records it.

### Patch Changes

- Updated dependencies [34f5e49]
- Updated dependencies [34f5e49]
  - @infrabyx/config@1.17.0
  - @infrabyx/contracts@1.33.0
  - @infrabyx/tenancy@1.20.4
  - @infrabyx/crypto@1.5.18

## 1.17.0

### Minor Changes

- 6bb68c1: The `governed` EGRESS adapter (`@infrabyx/connectors/egress`; IPB-04 §04.4.4, IPB-02-43): https on 443 only, the allow-list, every resolved address public (IANA special-purpose ranges refused), the connection pinned to the checked address, each redirect re-checked (at most 5), one deadline, capped body and decoding, a fixed User-Agent and no cookies; off behind `int.egress.governed.enabled`. `PlatformWebSnapshot` (`@infrabyx/connectors/web-snapshot`; PR-LDC-40, R1-D-176): fetch, store with SHA-256, AV scan and record one public page, with its ledger entry in the same transaction; served only as a download. Migration `connectors/0006` (`connectors.web_snapshot`): run `infrabyx-migrate`.

### Patch Changes

- Updated dependencies [6bb68c1]
- Updated dependencies [6bb68c1]
  - @infrabyx/config@1.16.0
  - @infrabyx/contracts@1.32.0
  - @infrabyx/tenancy@1.20.3
  - @infrabyx/crypto@1.5.17

## 1.16.4

### Patch Changes

- 32097cb: Rule engines accept dated parameters (PR-LDC-57, R1-D-175): a parameter with a `schedule` has no default, so compiling without a bound value is refused (`RuleCompileError` `parameter`) instead of compiling on a guess. Setting-backed parameters are unchanged.
- Updated dependencies [32097cb]
  - @infrabyx/contracts@1.31.0
  - @infrabyx/config@1.15.2
  - @infrabyx/crypto@1.5.16
  - @infrabyx/tenancy@1.20.2

## 1.16.3

### Patch Changes

- Updated dependencies [c79fef5]
  - @infrabyx/contracts@1.30.0
  - @infrabyx/config@1.15.1
  - @infrabyx/crypto@1.5.15
  - @infrabyx/tenancy@1.20.1

## 1.16.2

### Patch Changes

- bb9f524: The Zitadel customer adapter no longer fails a new account's first code under load (R1-D-171, R1-D-172). Zitadel's session API checks the user against its user projection without bringing it up to date (`GetUserByID(ctx, false, ...)`, zitadel v4.19.5), so `POST /v2/sessions` could answer 404 for an account created a moment earlier. The adapter now reads a new account by id before its first session, which updates the projection. On a 404 it reads the account once more and retries once. A second refusal is still `IPB-PORT-002`. No API, setting or migration change.

## 1.16.1

### Patch Changes

- 07cdac1: Security (R1-D-166, R1-D-167): `ZitadelCustomerIdentity` no longer resolves a login to an account whose login was just retired or moved while Zitadel's user search still lists it. A search hit is used only after `GET /v2/users/{id}` shows that account active under the login's username, an account not yet in the search is found by its own id, and a lookup Zitadel cannot confirm fails instead of guessing. New optional `fetchImpl` option (tests only), as on `ZitadelIdentity`. No change for Keycloak or for callers.

## 1.16.0

### Minor Changes

- 1089dc7: `@infrabyx/connectors/av`: the `clamav` AV adapter (clamd `INSTREAM` over TCP, in-cluster addresses only, fail-closed verdicts, stale signatures refused), off behind `int.av.clamav.enabled`; AV in the exit runbook (PR-LDC-41). Its health answer reports signature-database freshness (`signatures_at`, `signature_age_hours`, `max_signature_age_hours`, `signatures_fresh`) and is `degraded` when stale.
- 1089dc7: `assertMfaForRoles(claims, floor?, { stepUp? })` takes a product floor, refuses SMS-only sessions for excluded roles and can answer in RFC 9470 step-up form (`stepUpChallenge`); `assertStepUpReachable` is the boot check for step-up routes (PR-LDC-55). Unchanged without a floor.
- 1089dc7: `@infrabyx/connectors/pdf`: the `pdf-text` adapter (`PdfTextExtractor`, PR-LDC-39), a bounded PDF text parser with no dependency (cross-reference tables and streams, object streams, FlateDecode, ToUnicode), run in a worker thread with heap, stack and time limits; refuses unscanned, infected, changed and encrypted files and anything over a limit.
- 1089dc7: Storage compartments (PR-LDC-60): `ObjectMeta.compartment` (`BOARD_CONFIDENTIAL`, `SEALED`) within `CONFIDENTIAL` or `REGULATED`. The S3 and MinIO adapters write each compartment to its own bucket under its own SSE-KMS key (platform or tenant CMK) and refuse a missing or shared bucket or key; `int.storage.bucket.{class}.{compartment}`; `MemoryStorage` keeps the compartment.

### Patch Changes

- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
  - @infrabyx/contracts@1.29.0
  - @infrabyx/tenancy@1.20.0
  - @infrabyx/config@1.15.0
  - @infrabyx/crypto@1.5.14

## 1.15.0

### Minor Changes

- 15be78b: `@infrabyx/connectors/av`: the `clamav` AV adapter (clamd `INSTREAM` over TCP, in-cluster addresses only, fail-closed verdicts, stale signatures refused), off behind `int.av.clamav.enabled`; AV in the exit runbook (PR-LDC-41). Its health answer reports signature-database freshness (`signatures_at`, `signature_age_hours`, `max_signature_age_hours`, `signatures_fresh`) and is `degraded` when stale.

### Patch Changes

- Updated dependencies [15be78b]
- Updated dependencies [15be78b]
- Updated dependencies [15be78b]
- Updated dependencies [15be78b]
- Updated dependencies [15be78b]
- Updated dependencies [15be78b]
  - @infrabyx/contracts@1.28.0
  - @infrabyx/tenancy@1.19.0
  - @infrabyx/config@1.14.0
  - @infrabyx/crypto@1.5.13

## 1.14.5

### Patch Changes

- Updated dependencies [043a348]
- Updated dependencies [043a348]
- Updated dependencies [043a348]
  - @infrabyx/contracts@1.27.0
  - @infrabyx/config@1.13.4
  - @infrabyx/crypto@1.5.12
  - @infrabyx/tenancy@1.18.2

## 1.14.4

### Patch Changes

- 26c3035: Keycloak 26.8.2: `applyRealm` (workforce and customer realms) makes the built-in `kc-admin-api` client scope a default scope of the admin service account's client, so its token passes the Admin REST API's new audience check; a realm on an earlier version is unchanged (`grantAdminApiScope`).

## 1.14.3

### Patch Changes

- Updated dependencies [0aa0f1d]
- Updated dependencies [0aa0f1d]
- Updated dependencies [0aa0f1d]
  - @infrabyx/config@1.13.3
  - @infrabyx/tenancy@1.18.1
  - @infrabyx/contracts@1.26.0
  - @infrabyx/crypto@1.5.11

## 1.14.2

### Patch Changes

- Updated dependencies [496180e]
  - @infrabyx/contracts@1.25.0
  - @infrabyx/tenancy@1.18.0
  - @infrabyx/config@1.13.2
  - @infrabyx/crypto@1.5.10

## 1.14.1

### Patch Changes

- Updated dependencies [e86dedf]
  - @infrabyx/tenancy@1.17.0
  - @infrabyx/contracts@1.24.0
  - @infrabyx/config@1.13.1
  - @infrabyx/crypto@1.5.9

## 1.14.0

### Minor Changes

- d3888de: The Gotenberg DOCGEN adapter (OWNER-QUESTIONS #120, R1-D-100; R1-plan M71): `GotenbergDocgen` (`@infrabyx/connectors/docgen`) renders `renderHtml` requests to PDF or PDF/A (PDF/A-2b with PDF/UA) through an in-cluster Gotenberg's Chromium route, so Hindi, Punjabi and other Indic text is shaped with the Noto fonts in its image (`fonts-noto-core`); the PDF goes to the tenant's STORAGE under the request's output prefix with its SHA-256 and page count. It sends one `index.html` and nothing else, fails on console exceptions, talks HTTPS to its configured host only, and is off behind the new setting `int.docgen.gotenberg.enabled` (PLATFORM, default false, R4). The template methods are declared unsupported. `@infrabyx/testing` adds `docgenHtmlContractCases` and the pinned `gotenberg` test image (8.39.0); `port-contract` gains a DOCGEN leg; `PORT_EXIT` has the DOCGEN entry. With `renderPdf` from `@infrabyx/export`, vernacular KFS and notices render for every product.

### Patch Changes

- Updated dependencies [d3888de]
  - @infrabyx/config@1.13.0
  - @infrabyx/tenancy@1.16.1

## 1.13.0

### Minor Changes

- 67be297: The detached JWS in `X-Infrabyx-JWS` (Ecosystem Spec v1.4 §3.6, PR-043, OWNER-QUESTIONS #116; R1-plan M61). `@infrabyx/contracts/events`: `REGULATED_JWS_HEADER` and `regulatedJwsFromHeaders(headers)` (a Fetch `Headers` or a Node header record): exactly one header, any case, one compact detached JWS of at most 1,024 octets; a missing, repeated, comma-joined, over-long or malformed value is refused with its reason. The Operations Hub provisioning adapter adds `deliveryHeaders(event)` (a fresh JWS per delivery, so a retry has a new `jti`) and `receiveHttp(body, headers)`, which refuses a bad header as `signature-invalid` (`IPB-API-018`) before verifying or storing anything and keeps the header value byte for byte as the proof. `receive(event, jws)` and `signForDelivery` are unchanged. A product that already sends and reads `X-Infrabyx-JWS` removes nothing (minor rather than patch, because two methods are added).

### Patch Changes

- Updated dependencies [67be297]
- Updated dependencies [67be297]
- Updated dependencies [67be297]
- Updated dependencies [67be297]
  - @infrabyx/contracts@1.23.0
  - @infrabyx/tenancy@1.16.0
  - @infrabyx/config@1.12.1
  - @infrabyx/crypto@1.5.8

## 1.12.2

### Patch Changes

- Updated dependencies [3c9bb25]
- Updated dependencies [3c9bb25]
- Updated dependencies [3c9bb25]
- Updated dependencies [3c9bb25]
  - @infrabyx/config@1.12.0
  - @infrabyx/tenancy@1.15.0
  - @infrabyx/contracts@1.22.0
  - @infrabyx/crypto@1.5.7

## 1.12.1

### Patch Changes

- Updated dependencies [bc2c301]
  - @infrabyx/tenancy@1.14.1

## 1.12.0

### Minor Changes

- 1dda4b2: EMAIL (R1-plan M58; R1-D-90): `ses` and `brevo` send `EmailMessage.content` (a tenant's rendered subject, plain text and optional HTML) in place of the vendor template, as SES simple content and as Brevo's `subject`, `textContent` and `htmlContent` (a text-only message gets its text escaped as the HTML body), and declare the capability `content: "native"`.

### Patch Changes

- Updated dependencies [1dda4b2]
- Updated dependencies [1dda4b2]
- Updated dependencies [1dda4b2]
  - @infrabyx/tenancy@1.14.0
  - @infrabyx/config@1.11.0
  - @infrabyx/contracts@1.21.0
  - @infrabyx/crypto@1.5.6

## 1.11.0

### Minor Changes

- b8c1f2c: RULES engines (R1-plan M55; R1-D-88): rule parameters are constants bound at compile time (`compile(body, parameters?)`, defaults otherwise); a row compares an input with a parameter as with a literal on `zen`, `json-rules` and `memory`, and a parameter is never an input. ZEN warms each compiled decision once, so its first evaluation does not pay its lazy set-up inside the time budget (PR-LDC-25).

### Patch Changes

- Updated dependencies [b8c1f2c]
- Updated dependencies [b8c1f2c]
  - @infrabyx/contracts@1.20.0
  - @infrabyx/tenancy@1.13.0
  - @infrabyx/config@1.10.1
  - @infrabyx/crypto@1.5.5

## 1.10.0

### Minor Changes

- c8b8f88: `cibil` maps each account's EMI to `Tradeline.emiPaise` (`cibilEmiPaise`; absent, empty, zero or malformed is `null`). `nesl-dde` maps each signed executant's evidence to `DdeRecord.signers` (`neslSigners`, failing closed on a partial trail) and registers a not-stampable document with NeSL's reason code in place of a stamp reference (`neslNonStampable`, `mapNeslNotStampable`); a key replayed with another stamping is refused. All vendor shapes stub-shaped `[VERIFY]`; both adapters stay off and `unproven` (PR-FBX-35; R1-D-84).
- c8b8f88: Tenant SSO brokers on `KeycloakIdentity` and `ZitadelIdentity` (PR-LDC-09; R1-D-78), linking only on both: a brokered login reaches only an account the product provisioned in the broker's tenant, and never creates one. Keycloak: realm identity providers built from Keycloak's own `import-config` of the discovery or metadata URL, PKCE S256, signatures validated, `trustEmail` off, owner tenant, verified domains and source URL in `KEYCLOAK_BROKER_KEYS`, and the first-login flow `ipb-broker-link-only` (`KEYCLOAK_BROKER_LINK_FLOW`: detect the existing account, then re-authentication; no account creation, no profile review), which `applyRealm` creates and restores with the new `identityBrokers` realm option, with an `idp` access-token claim and the admin grant `manage-identity-providers`; a session whose broker belongs to another tenant than its account is refused (`IPB-IDN-001` `idp_tenant`). Zitadel: organisation generic OIDC or SAML IdPs with linking only (no account creation), on the login policy while enabled, routed by organisation metadata `ipb.idp.<alias>`; a user's token is refused while the account is linked to another tenant's broker (`idp_tenant`). Both: the client secret resolved through the new `resolveSecret` option (a SECRETS resolver) and never returned; an alias owned by another tenant or configured by hand is refused (`IPB-PORT-004` `alias_taken`), as is a domain already routed (`domain_taken`); discovery maps a verified email domain to its enabled broker (capability `discoverIdentityProvider: emulated`). `applyRealm` takes a `fetchImpl` test option.
- c8b8f88: Keycloak breached-password check without a third-party call (PR-LDC-04; R1-D-83): `KeycloakRealmSpec.passwordBlacklist` adds Keycloak's `passwordBlacklist(<file>)` policy to the IPB floor (`length(12) and notUsername and notEmail and passwordHistory(5)`), and `KEYCLOAK_PASSWORD_BLACKLIST` (`ipb-common-passwords.txt`) names the list the Keycloak customer image (`infra/keycloak/customer-otp`) now carries: the 10,000 most common passwords of 12 or more characters from SecLists (MIT). `keycloakPasswordPolicy(file?)` returns the policy string and refuses a name that is not a plain file name. Off unless the realm names a list, because Keycloak refuses a realm whose list it does not hold; set `passwordBlacklist: KEYCLOAK_PASSWORD_BLACKLIST` on realms served by the customer image.
- c8b8f88: `refreshSession` on `KeycloakIdentity` and `ZitadelIdentity` (PR-LDC-03; R1-D-77). Keycloak refreshes under the realm's rotation (`revokeRefreshToken`, `refreshTokenMaxReuse` 0): a token Keycloak reports as reused (`Stale token`, `Maximum allowed refresh token reuse exceeded`) has its session revoked in the revocation store, then ended at Keycloak. Zitadel rotates every token but reports a spent one only as invalid, so the adapter detects reuse from a `RefreshTokenLedger` of SHA-256 hashes (`MemoryRefreshTokenLedger` by default; option `refreshLedger`; capability `refreshSession.reuseDetection: emulated`), then revokes the session (or the user, when the tokens carry no `sid`) and refuses the family's later tokens. Refresh tokens are never logged or put in an error. `oauthError`, `unverifiedJwtPayload` and `refreshRefused` helpers; a `fetchImpl` test option on both adapters.

### Patch Changes

- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
  - @infrabyx/tenancy@1.12.0
  - @infrabyx/contracts@1.19.0
  - @infrabyx/config@1.10.0
  - @infrabyx/crypto@1.5.4

## 1.9.0

### Minor Changes

- 9c368c7: CEL string functions in every RULES engine: `s.startsWith(x)`, `s.endsWith(x)`, `s.contains(x)` (a string literal or another string input) and `s.matches("re")`, an unanchored search whose pattern is a literal in a linear-time subset checked when the draft is compiled (`cel_pattern`; at most 256 characters; no back-references, look-around, possessive or nested quantifiers); `zen` and `json-rules` search with `re2js` 2.8.8. String inputs must be well-formed UTF-16 and at most 4 096 characters; `evaluateCel` refuses a `matches` outside the subset (PR-LDC-13; R1-D-71).
- 9c368c7: The Operations Hub provisioning adapter's request half and failure path (Ecosystem Spec v1.3; PR-LDC-11, M38; R1-D-70): `request()` writes `ProvisioningRequested` to the product's outbox, idempotent on the request id; `signForDelivery()` signs it at delivery; `receive()` and `drain()` take `ProvisioningFailed` once per request (one outcome per request), refuse personal data in `detail`, and hand it to `onFailed` with the 30-day purge deadline.

### Patch Changes

- Updated dependencies [9c368c7]
- Updated dependencies [9c368c7]
- Updated dependencies [9c368c7]
- Updated dependencies [9c368c7]
  - @infrabyx/tenancy@1.11.0
  - @infrabyx/contracts@1.18.0
  - @infrabyx/config@1.9.2
  - @infrabyx/crypto@1.5.3

## 1.8.1

### Patch Changes

- Updated dependencies [714ad01]
  - @infrabyx/contracts@1.17.0
  - @infrabyx/config@1.9.1
  - @infrabyx/crypto@1.5.2
  - @infrabyx/tenancy@1.10.1

## 1.8.0

### Minor Changes

- b3edda2: `DigioMandates` takes the approvals engine's verifier (`approvals`) and the tenant (`tenantId`), both required, and has the engine consume each call's approval before Digio is called to register or cancel a mandate (R1-D-66). A retry that reads the first mandate back consumes nothing.
- b3edda2: `OperationsHubProvisioning` (`@infrabyx/connectors/provisioning`; PR-LDC-11, R1-D-68): verifies the signed `TenantProvisioned`, stores it in the product's Ecosystem inbox and creates the tenant once per provisioning request through `TenantBootstrap.provision`, with the product's hook in the creation transaction.

### Patch Changes

- Updated dependencies [b3edda2]
- Updated dependencies [b3edda2]
- Updated dependencies [b3edda2]
- Updated dependencies [b3edda2]
- Updated dependencies [b3edda2]
  - @infrabyx/config@1.9.0
  - @infrabyx/tenancy@1.10.0
  - @infrabyx/contracts@1.16.0
  - @infrabyx/crypto@1.5.1

## 1.7.0

### Minor Changes

- fdd1f1a: The first BUREAU and AA_FIU adapters (owner answer #97; R1-D-61), built against stubs and off until the owner's sandboxes exist:

  - **`cibil`** (TransUnion CIBIL) from `@infrabyx/connectors/bureau`: CIBIL pulls only, the raw report in the tenant's REGULATED STORAGE by its SHA-256, a normalised summary in integer paise with no PAN, and `pending` pulls completed by read-back. Off behind `int.bureau.cibil.enabled`.
  - **`setu-aa`** (Setu FIU) from `@infrabyx/connectors/aa-fiu`: ReBIT consent requests, fetches only under an ACTIVE consent within its range and FI types, payloads in REGULATED STORAGE with their schema version and hash, masked accounts only, and `approvalUrl` for the customer's approval page. Off behind `int.aa_fiu.setu.enabled`.

  Both read every event back from the vendor. The exit map lists both ports, with the second vendor pending.

- ed143e3: The Digio mandate adapter and NeSL DDE, against stubs and off (owner answer #100; R1-D-62):

  - **`digio-mandate`** (`@infrabyx/connectors/payments`: `DigioMandates`, `MemoryMandateKeyStore`): PAYMENTS' `MandateLifecycle` for eNACH and UPI AutoPay. Every registration and cancellation runs `assertMoneyCall`; amounts are integer paise checked back exactly; each idempotency key is claimed before Digio is called; callbacks are read back. Off behind `int.payments.digio_mandate.enabled`.
  - **`nesl-dde`** (`@infrabyx/connectors/estamp`: `NeslDde`, `MemoryDdeRecordStore`): ESTAMP's Digital Document Execution methods only; stamp duty is not bought here. Off behind `int.estamp.nesl_dde.enabled`.

### Patch Changes

- Updated dependencies [fdd1f1a]
- Updated dependencies [ed143e3]
  - @infrabyx/config@1.8.0
  - @infrabyx/tenancy@1.9.2

## 1.6.0

### Minor Changes

- 2a95100: The DEVICE_ATTESTATION reference adapter `native` (Udofin PR-UDF-028; owner answer #99; R1-D-59). Exported from `@infrabyx/connectors/device-attestation`:

  - **Play Integrity:** `decodeIntegrityToken` with a C-24 token, the binding, package, signing certificate, licence, device level and age checked, and each token used once.
  - **App Attest:** verified locally with C-27; a key registers once.

  Both halves are off behind `int.device_attestation.play_integrity.enabled` and `int.device_attestation.app_attest.enabled` (`config`). `testing`: `startPlayIntegrityStub`, `nativeDeviceEvidence`, and `DeviceEvidence`, the minter the contract cases now take, so they run on `native` and on the fake. Exit map and port matrix: `DEVICE_ATTESTATION`.

### Patch Changes

- 3073ca6: `@temporalio/*` 1.25.0 (security update, R1-D-60): `core-bridge` now ships Rust `zip` 9.0.5, which fixes CVE-2026-115905, -115907, -115908 and -115909. Products drop any override of their own that raised Temporal, and the matching waivers.
- Updated dependencies [2a95100]
- Updated dependencies [2a95100]
  - @infrabyx/config@1.7.0
  - @infrabyx/crypto@1.5.0
  - @infrabyx/tenancy@1.9.1

## 1.5.0

### Minor Changes

- 1b99d7a: The CAPTCHA and DEVICE_ATTESTATION ports (Udofin PR-UDF-029 and PR-UDF-028; ADR-0004; R1-D-50). `contracts`: `CaptchaPort` (`verify` returns a verdict: `invalid`, `expired`, `duplicate`, `action_mismatch`, `hostname_mismatch`) and `DeviceAttestationPort` (Play Integrity, App Attest registration and assertions, bound to a nonce or the DPoP key), both catalogued in `R1_PORTS`. `connectors` (`@infrabyx/connectors/captcha`): `TurnstileCaptcha` (reference) and `HCaptchaCaptcha` (alternative), which send only the token and the secret, and `CaptchaGate`, which asks for a token only while `int.captcha.under_attack` is on and then fails closed with 429 IPB-SEC-019. `config`: `int.captcha.under_attack`, `int.captcha.turnstile.enabled`, `int.captcha.hcaptcha.enabled` (both adapters off by default). `testing`: `FakeCaptcha`, `startCaptchaStub`, `captchaContractCases`, `FakeDeviceAttestation`, `deviceAttestationContractCases`. The device-attestation vendor adapters wait for the owner (OWNER-QUESTIONS #99).
- c83e9e0: Changing and retiring a customer's login (Udofin PR-UDF-034; R1-D-51). `CustomerIdentityPort` gains optional `startLoginChange`, `confirmLoginChange` and `retireLogin`. `KeycloakCustomerIdentity` and `ZitadelCustomerIdentity` implement them: a change needs one code to each login, from the same device key, and keeps the account's id, devices and subject; retiring forgets the devices, disables the account and frees the login for a new account. Zitadel accounts are now found by username, so a changed or recycled login maps to the right account. `CustomerAuthStore.recordAccountEvent` (optional) ledgers both events by the account's hash; `PgCustomerAuthStore` implements it.
- 1e721cd: The IDfy KYC adapter on a stub (owner answer #91; R1-plan M25; R1-D-45). `idfy-kyc` provides PAN verification, face match and photo liveness, the methods the Digio reference lacks, over the egress client with no SDK; images are read from STORAGE and checked against their SHA-256 before they leave, and nothing the vendor returns is stored. Its request and result shapes are stub-shaped until the owner's IDfy sandbox exists (`mapIdfyPan`, `mapIdfyScore`), so it stays off behind `int.kyc.idfy.enabled` and `unproven`. `kycMethodRouter` routes each KYC method to the first adapter in its order that provides it (Digio first, IDfy second; Finbyx PR-FBX-24) and moves on only when an adapter is off, unavailable or lacks the method, never on an answer about the customer. `PORT_EXIT` names `idfy-kyc` as KYC's exit target.
- 854e309: The `livekit` VIDEO_MEET reference adapter (`@infrabyx/connectors/video-meet`; owner answer #88, R1-D-53): a self-hosted LiveKit server called over its HTTP server API with C-26 tokens, the room's policy (India only, no anonymised origin, the official from the official network) enforced before a token is issued, webhooks verified and read back, and recordings moved from the egress disk to the room's STORAGE target with one locked single-part write each before the disk copy is removed. Off behind `int.video_meet.livekit.enabled` (`config`); the egress path is `unproven` until a deployment runs the egress worker. `testing`: the `livekit` test image and `videoMeetContractCases({ signWebhook })`. Compose: the `video` profile.
- 3d8dfd6: `RedisReplayStore.fromUrl(url, { prefix, password, timeoutMs })` opens the platform's own Redis or Valkey connection for the DPoP replay store, so a product needs no Redis client of its own (Udofin PR-UDF-032; IPB-01-14; R1-D-47). `redis://` or `rediss://` (TLS) only; commands are not queued while disconnected and time out (2 s), so a claim during an outage throws and sign-in fails closed. `close()` ends the connection.
- 0a33a67: V-CIP through our own VIDEO_MEET room (R1-plan M24; owner answer #90 (b); R1-D-55). `VcipConductor` in `@infrabyx/connectors/kyc` starts the recording in the tenant's room, sends only frames and the document photo to a KYC scorer for liveness and face match, takes the decision only from the session's official, refuses an approval without passed checks, a geo-tag in India and a recording the provider does not keep, and keeps every artefact in the tenant's STORAGE by hash. `MemoryVcipStore` for tests. Off behind the product's `kyc.vcip.enabled`.

### Patch Changes

- Updated dependencies [7910610]
- Updated dependencies [1b99d7a]
- Updated dependencies [c83e9e0]
- Updated dependencies [af2ae98]
- Updated dependencies [c4117e4]
- Updated dependencies [1e721cd]
- Updated dependencies [854e309]
- Updated dependencies [854e309]
- Updated dependencies [0da0398]
- Updated dependencies [05c3122]
  - @infrabyx/tenancy@1.9.0
  - @infrabyx/contracts@1.15.0
  - @infrabyx/config@1.6.0
  - @infrabyx/crypto@1.4.0

## 1.4.0

### Minor Changes

- 4a87754: Per-object retention that is only ever extended (Finbyx PR-FBX-27; IPB-01-29; R1-D-42). `StoragePort.extendRetention(key, retainUntil)` (S3 `PutObjectRetention` in COMPLIANCE mode; an earlier or equal date, or an object without retention, is refused with `IPB-STOR-003`) and `retentionOf(key)`, on the `s3` and `minio` adapters and `MemoryStorage`, with a shared contract case. `assertImmutable` now also checks the stored SHA-256 checksum against the hash recorded at write, from a HEAD with checksum mode, so no decrypt permission is needed. `putWithRetention` stays one single-part write with the lock mode, the date and a SHA-256 checksum.

### Patch Changes

- Updated dependencies [97e8524]
- Updated dependencies [e41c3bd]
- Updated dependencies [92706c4]
- Updated dependencies [92706c4]
- Updated dependencies [4a87754]
- Updated dependencies [d66ffad]
  - @infrabyx/contracts@1.14.0
  - @infrabyx/tenancy@1.8.0
  - @infrabyx/config@1.5.2
  - @infrabyx/crypto@1.3.1

## 1.3.6

### Patch Changes

- Updated dependencies [32b53ee]
- Updated dependencies [cff2a02]
  - @infrabyx/crypto@1.3.0
  - @infrabyx/contracts@1.13.0
  - @infrabyx/config@1.5.1
  - @infrabyx/tenancy@1.7.2

## 1.3.5

### Patch Changes

- Updated dependencies [63c5ad2]
- Updated dependencies [63c5ad2]
  - @infrabyx/config@1.5.0
  - @infrabyx/contracts@1.12.0
  - @infrabyx/tenancy@1.7.1
  - @infrabyx/crypto@1.2.7

## 1.3.4

### Patch Changes

- Updated dependencies [2e3a2d3]
- Updated dependencies [2e3a2d3]
- Updated dependencies [3f20011]
- Updated dependencies [3f20011]
  - @infrabyx/contracts@1.11.0
  - @infrabyx/tenancy@1.7.0
  - @infrabyx/config@1.4.1
  - @infrabyx/crypto@1.2.6

## 1.3.3

### Patch Changes

- Updated dependencies [138ae44]
- Updated dependencies [138ae44]
- Updated dependencies [138ae44]
  - @infrabyx/config@1.4.0
  - @infrabyx/contracts@1.10.0
  - @infrabyx/tenancy@1.6.0
  - @infrabyx/crypto@1.2.5

## 1.3.2

### Patch Changes

- Updated dependencies [2b307e0]
- Updated dependencies [2b307e0]
  - @infrabyx/contracts@1.9.0
  - @infrabyx/tenancy@1.5.0
  - @infrabyx/config@1.3.2
  - @infrabyx/crypto@1.2.4

## 1.3.1

### Patch Changes

- Updated dependencies [cd25633]
- Updated dependencies [cd25633]
  - @infrabyx/contracts@1.8.0
  - @infrabyx/tenancy@1.4.0
  - @infrabyx/config@1.3.1
  - @infrabyx/crypto@1.2.3

## 1.3.0

### Minor Changes

- 94b706e: `@infrabyx/connectors/kyc`: `DigioKyc` (`digio-kyc`), the KYC reference adapter for DigiLocker and Aadhaar Offline e-KYC (owner answer #87, R1-D-24). It is off behind `int.kyc.digio.enabled` and `unproven` (#147) until the owner's Digio account exists. Every other KYC method, V-CIP included (#90), is `unsupported`.

### Patch Changes

- Updated dependencies [94b706e]
  - @infrabyx/config@1.3.0
  - @infrabyx/tenancy@1.3.5

## 1.2.0

### Minor Changes

- f5622c9: Retention of customer sign-in state (owner answer #86, R1-D-23). `CustomerSignInRetention` is a scheduled per-tenant job (`sweep(tenantSweep)`). It deletes a challenge 24 hours after it expired, a guard row once its lockout window has ended, and a device 12 months after its last use, each period a setting and each deletion ledgered. Unbinding a device (`revokeDevice`) or closing the account (`forgetDevices`) now deletes devices at once. Migration `connectors/0005` grants `app_rw` delete on the three tables, with restrictive policies that keep floors below the settings.

### Patch Changes

- Updated dependencies [f5622c9]
- Updated dependencies [f5622c9]
  - @infrabyx/config@1.2.0
  - @infrabyx/contracts@1.7.0
  - @infrabyx/tenancy@1.3.4
  - @infrabyx/crypto@1.2.2

## 1.1.1

### Patch Changes

- Updated dependencies [ceabe3b]
  - @infrabyx/contracts@1.6.0
  - @infrabyx/config@1.1.1
  - @infrabyx/crypto@1.2.1
  - @infrabyx/tenancy@1.3.3

## 1.1.0

### Minor Changes

- 849b8f9: Customer sign-in on the IDENTITY port (owner answer #84 (b), R1-D-19): `KeycloakCustomerIdentity` with `applyCustomerRealm` (needs the `ipb-customer-otp` extension image, `infra/keycloak/customer-otp`; DPoP-bound tokens) and `ZitadelCustomerIdentity` with `applyCustomerOrg` (session API with `returnCode`; platform binding); the `auth.otp` guard, challenges and devices in `PgCustomerAuthStore` (migration `connectors/0004`, forced RLS, ledgered); `RedisReplayStore` for DPoP `jti`s. The egress client can now read a redirect without following it (`redirect: "manual"`).

### Patch Changes

- Updated dependencies [849b8f9]
- Updated dependencies [849b8f9]
- Updated dependencies [849b8f9]
  - @infrabyx/config@1.1.0
  - @infrabyx/contracts@1.5.0
  - @infrabyx/crypto@1.2.0
  - @infrabyx/tenancy@1.3.2

## 1.0.10

### Patch Changes

- Updated dependencies [7e38652]
- Updated dependencies [7e38652]
  - @infrabyx/contracts@1.4.0
  - @infrabyx/crypto@1.1.0
  - @infrabyx/config@1.0.6
  - @infrabyx/tenancy@1.3.1

## 1.0.9

### Patch Changes

- 3a58947: Keycloak `applyRealm` gives each `amr` reference the realm profile's session lifetime as its maximum age instead of 0, so `otp` stays in the token when the code is exchanged after the TOTP step's second and after a refresh; the API no longer refuses MFA roles at random with `IPB-SEC-001`. Re-applying a realm updates the platform's own references (R1-D-16).

## 1.0.8

### Patch Changes

- Updated dependencies [b6058d3]
- Updated dependencies [b6058d3]
  - @infrabyx/contracts@1.3.0
  - @infrabyx/tenancy@1.3.0
  - @infrabyx/config@1.0.5
  - @infrabyx/crypto@1.0.3

## 1.0.7

### Patch Changes

- Updated dependencies [1c869a8]
  - @infrabyx/config@1.0.4
  - @infrabyx/tenancy@1.2.1

## 1.0.6

### Patch Changes

- Updated dependencies [75e9ea4]
- Updated dependencies [75e9ea4]
  - @infrabyx/contracts@1.2.0
  - @infrabyx/tenancy@1.2.0
  - @infrabyx/config@1.0.3
  - @infrabyx/crypto@1.0.2

## 1.0.5

### Patch Changes

- Updated dependencies [c0ce8ff]
- Updated dependencies [2724cd6]
  - @infrabyx/tenancy@1.1.3

## 1.0.4

### Patch Changes

- 900b070: The `openfga` AUTHZ adapter calls OpenFGA's HTTP API directly and no longer depends on `@openfga/sdk`, whose 0.9.7 pinned `axios` 1.19.0 with seven high advisories; products can drop their `axios` override (PR-FBX-05). Behaviour is unchanged: the same check, contextual tuples, model id, 3-second timeout and deny-on-failure.

## 1.0.3

### Patch Changes

- Updated dependencies [8a2587e]
- Updated dependencies [8a2587e]
  - @infrabyx/config@1.0.2
  - @infrabyx/tenancy@1.1.2

## 1.0.2

### Patch Changes

- 53a973c: Telemetry scrubber (PR-UDF-007, IPB-02-23): masks a bank account number under `account_number` and the other usual spellings of the IPB-02 masked fields (`accountNumber`, `bank_account_no`, `aadhaar_number`, `pan_no`, `card_number`, `phone`, `mobile_number`, `email_address`, `passport_number`, and keys ending in one of them such as `borrower_pan`); redacts one-time codes and card security codes under any key that contains `otp`, `totp`, `mpin`, `cvv`, `cvc` or `passcode`; and in free text redacts a code written next to its label (`otp=123456`, "OTP is 123456", "123456 is your OTP", `"otp":"123456"`), masks account numbers of 9 to 18 digits named as one ("A/c no. 1234 5678 901") and any other run of 9 to 11 digits, mobile numbers written as `98765 43210`, and passport numbers.
- Updated dependencies [53a973c]
  - @infrabyx/tenancy@1.1.1

## 1.0.1

### Patch Changes

- Updated dependencies [588b509]
- Updated dependencies [588b509]
  - @infrabyx/contracts@1.1.0
  - @infrabyx/tenancy@1.1.0
  - @infrabyx/config@1.0.1
  - @infrabyx/crypto@1.0.1

## 1.0.0

### Major Changes

- 9ec9a2c: 1.0.0, the platform baseline release (IPB-14 §14.5 item 1; owner answer #67(4), PL6-D-16). Every `@infrabyx/*` package moves to 1.0.0 together; the public API is unchanged from the 0.x set of the PL6 gate (`docs/phases/PL6-gate.md` §6), so a product upgrades by moving every dependency to 1.0.0 at once. From 1.0.0 on, semantic versioning holds: a breaking change to an export, a migration or a setting is a major release with an ADR (IPB-09-34/35).

### Patch Changes

- Updated dependencies [9ec9a2c]
  - @infrabyx/config@1.0.0
  - @infrabyx/contracts@1.0.0
  - @infrabyx/crypto@1.0.0
  - @infrabyx/tenancy@1.0.0

## 0.5.0

### Minor Changes

- 60db887: PL6 session 6a: `@infrabyx/connectors/exit` exports `PORT_EXIT`, the exit metadata of every port the package builds adapters for (IPB-01 §01.4.13): the reference primary, the alternative an exit moves to, the data-move method, the data volume class and the lock-in residue with its mitigation. `pnpm exit-runbook` turns it, the port catalogue's RTO tiers, a routing file and the drill records into `docs/exit/EXIT_RUNBOOK.md`.
- cb669ac: PL6 session 4c: `MinioStorage.ensureBuckets()` creates the class buckets that are missing on a local MinIO, with Object Lock (and so versioning) as `health` requires. `pnpm dev:up` calls it; deployed buckets still come from the OpenTofu modules.

### Patch Changes

- cb669ac: PL6 session 4c: `KeycloakIdentity` writes a display name Keycloak's person-name validator accepts (its prohibited characters removed) as the first name and keeps the display name whole in the `display_name` attribute, so a persona such as "Tenant auditor (RO)" provisions; `getUser` prefers that attribute. A 4xx from the admin API now names the field and validation message in the port error's detail. `ipbRealm` deduplicates the realm roles when `productRoles` repeats a platform role.
- Updated dependencies [9d8cd8c]
- Updated dependencies [b3934f9]
  - @infrabyx/tenancy@0.6.0
  - @infrabyx/config@0.5.1

## 0.4.0

### Minor Changes

- 1fecf45: Owner answer #53 (PL5-D-11): `@infrabyx/connectors/media` with the MEDIA reference adapter `SharpMedia` (libvips through `sharp`, under the owner's licence exception for the unmodified `@img/sharp-libvips-*` binaries) and the alternative `PassthroughMedia` (uploads served as uploaded). `sharp` 0.35.5 is an optional peer dependency: install it in the product to re-encode; without it the adapter reports `IPB-PORT-001` (`not_installed`). The package now ships a `NOTICE` naming libvips and its licence.

### Patch Changes

- Updated dependencies [de53086]
- Updated dependencies [de53086]
- Updated dependencies [f1a36a1]
- Updated dependencies [1fecf45]
- Updated dependencies [1fecf45]
- Updated dependencies [b0dc390]
- Updated dependencies [b0dc390]
- Updated dependencies [b0dc390]
- Updated dependencies [275d4ba]
- Updated dependencies [934355c]
- Updated dependencies [686d24b]
- Updated dependencies [686d24b]
- Updated dependencies [e8e83cb]
- Updated dependencies [275d4ba]
- Updated dependencies [36338c3]
- Updated dependencies [934355c]
- Updated dependencies [b7de3c6]
- Updated dependencies [e8e83cb]
- Updated dependencies [275d4ba]
  - @infrabyx/config@0.5.0
  - @infrabyx/contracts@0.5.0
  - @infrabyx/tenancy@0.5.0
  - @infrabyx/crypto@0.4.1

## 0.3.0

### Minor Changes

- ca72d67: `@infrabyx/connectors/ai` (PL4 session 3, PL4-D-04): LLM and EMBEDDING adapters on stubs, all `unproven`:

  - `bedrock_claude_in` (reference; Bedrock Converse and InvokeModel in ap-south-1 through `@aws-sdk/client-bedrock-runtime`; #63);
  - `gemini_vertex_asia_south1` (alternative; Vertex REST with an injected access token, no Google SDK; #64);
  - `self_hosted_vllm` (the SELF route for SECRET data; #65).

  Each adapter checks its region at boot, refuses cross-region inference profiles, maps 429/5xx/timeouts to retryable errors for the gateway, never logs bodies, and emulates streaming.

- f6e9a88: `googleServiceAccountToken` (C-24, PL4-C-01): exchanges a service-account assertion at Google's token endpoint and caches the access token until 5 minutes before expiry, with one shared exchange for concurrent callers. `fcm` uses it, and `vertexServiceAccountToken` gives `gemini_vertex_asia_south1` a cloud-platform token from a service-account key read through SECRETS. An injected workload-identity token provider still works for both.
- bfa324d: IMAGE_GEN adapters in `@infrabyx/connectors/ai` (PL4 session 5, PL4-D-07): `GeminiImagen` (`gemini_imagen`, Vertex AI asia-south1, PNG only, no people; #69) and `FluxSelfHosted` (`flux_self_hosted`, OpenAI-compatible images endpoint on our own host; #70), both `unproven`. `VertexBase` is shared with the Gemini adapters.

### Patch Changes

- Updated dependencies [2b07109]
- Updated dependencies [200b25a]
- Updated dependencies [f6e9a88]
- Updated dependencies [f6e9a88]
- Updated dependencies [200b25a]
- Updated dependencies [9af583a]
- Updated dependencies [288ae44]
- Updated dependencies [b205b1d]
- Updated dependencies [183c532]
- Updated dependencies [f6e9a88]
- Updated dependencies [183c532]
- Updated dependencies [200b25a]
- Updated dependencies [b205b1d]
  - @infrabyx/contracts@0.4.0
  - @infrabyx/config@0.4.0
  - @infrabyx/crypto@0.4.0
  - @infrabyx/tenancy@0.4.0

## 0.2.0

### Minor Changes

- 50093e9: ESIGN adapters (new subpath `@infrabyx/connectors/esign`): `leegality` (interim reference; the
  webhook `mac` checked with C-25) and `digio` (alternative; callbacks carry the C-19 URL token).
  Both read the PDF by reference with its SHA-256 checked, refuse any method they cannot provide as
  asked (no downgrade), return only the status read back from the vendor after a webhook, write the
  signed PDF to STORAGE, and stay `unproven` until their sandbox legs (#55, #56). `ESIGN` joins the
  port-contract matrix.
- 1ed0659: PUSH adapters (new subpath `@infrabyx/connectors/push`): `expo` (reference, Expo push API v2,
  `sendTopic` unsupported) and `fcm` (alternative, FCM HTTP v1, C-24 service-account assertion or a
  workload-identity access token, cached until 5 minutes before expiry; `receipts` unsupported).
  Both refuse anything beyond title, deep link and INTERNAL data (`IPB-NTF-006`), remove tokens the
  vendor reports unregistered, and stay `unproven` until their sandbox legs (#50, #51).
- 53697f5: RULES engine adapters (new subpath `@infrabyx/connectors/rules`): `zen` (reference,
  `@gorules/zen-engine` 2.1.7), `json-rules` (alternative, `json-rules-engine` 7.3.1) and the memory
  CEL row walk, all compiling the platform decision table through one CEL subset parsed and checked
  by `@marcbachmann/cel-js` 8.0.0; strict input checks, `UNDETERMINED` on any engine error or timeout,
  canary health, and `evaluateCel` (PL3-D-18).
- dd7a98b: `@infrabyx/connectors/workflow`: `TemporalTimers` (a `TimerEngine` over the WORKFLOW port), the
  `ipbTimer` workflow (`TIMER_WORKFLOWS_PATH`) and `timerActivities` for `@infrabyx/workflow` timers
  (PL3-D-19).

### Patch Changes

- Updated dependencies [50093e9]
- Updated dependencies [2725b6c]
- Updated dependencies [dd7a98b]
- Updated dependencies [50093e9]
- Updated dependencies [e268b60]
- Updated dependencies [1ed0659]
- Updated dependencies [2725b6c]
- Updated dependencies [1ed0659]
- Updated dependencies [53697f5]
- Updated dependencies [dd7a98b]
- Updated dependencies [e268b60]
- Updated dependencies [1ed0659]
- Updated dependencies [50093e9]
- Updated dependencies [53697f5]
- Updated dependencies [3951517]
- Updated dependencies [3951517]
- Updated dependencies [dd7a98b]
- Updated dependencies [e268b60]
- Updated dependencies [1ed0659]
- Updated dependencies [53697f5]
- Updated dependencies [dd7a98b]
  - @infrabyx/config@0.3.0
  - @infrabyx/contracts@0.3.0
  - @infrabyx/crypto@0.3.0
  - @infrabyx/tenancy@0.3.0

## 0.1.1

### Patch Changes

- 995639f: Fix `@infrabyx/connectors/workflow` and `./workflow/worker` failing to load in plain Node ESM
  ("The requested module '@temporalio/proto' does not provide an export named 'temporal'"). The
  CommonJS package is now imported through its default export. No API change.

## 0.1.0

### Minor Changes

- 2969424: AUTHZ adapters `cerbos` (Cerbos PDP over HTTP, Admin API policy loading, query plans) and
  `openfga` (contextual-tuple model, no stored tuples), with the platform policy pack in `policy/`:
  the PL1 role floor, maker ≠ checker, agents never decide, product-scoped operations staff. Deny by
  default; PDP failure denies with IPB-AUTHZ-001; allow-only cache of at most 5 s.
- 858a76a: First release:

  - the provider_routing runtime: router, circuit breaker, health registry, HTTPS egress client,
    idempotency store with pending records and vendor lookup, and inbound-webhook helpers;
  - the `connectors` schema migration;
  - the OBSERVABILITY `otel` adapter, with the IPB-02-23 scrubber and two exporter profiles;
  - the FEATURE_FLAG `unleash` adapter (with registry sync) and the `config-db` alternative.

- 2969424: IDENTITY adapters `keycloak` (Keycloak 26.x, realm as code, Admin API SCIM) and `zitadel`
  (Zitadel v4, settings and ES256 web key as code), with a shared ES256 token verifier, claim mapping,
  the `assertMfaForRoles` API guard (IPB-SEC-001) and a revocation store: `PgRevocationStore` on the
  new migration `0002_session_revocation` refuses revoked sessions and users on every replica within
  60 s. Impersonation (`issueToken` with an actor) is unsupported on both adapters.
- 9ac878e: KMS adapters `aws-kms` (encryption context per C-14, DIGEST signing, tenant CMKs with rotation,
  30-day deletion only) and `vault-transit` (associated data, version-aware verification). Both fail
  decryption closed with IPB-KMS-001.
- 9ac878e: SECRETS adapters `aws-sm` (AWS Secrets Manager with the platform CMK, CloudTrail audit) and `vault`
  (Vault/OpenBao KV v2, dynamic database leases), plus `CachedSecrets` (15-minute cache, not-ready on
  a failed refresh, never older than 24 h). AWS SDK clients 3.1152.0, loaded on demand.
- 9c774b9: STORAGE adapters `s3` and `minio` (Object Lock compliance, write-once retention, soft delete,
  SSE-KMS with class or tenant keys, presigned URLs bound to method and content type, SHA-256
  verified replication); QUEUE adapters `bullmq` (Redis or Valkey) and `pg-boss` (new migration
  `0003_pgboss`, no DDL at runtime) with dead-letter queues and replay; WORKFLOW adapters `temporal`
  and `temporal-cloud` with the C-16 payload codec, encrypted failures, the 32 KB reference path and
  a worker helper at `@infrabyx/connectors/workflow/worker`.
- 7a36249: KMS adapters refuse `generateDataKey` without a valid C-14 context (IPB-PORT-003) and use the registered `health` context for canaries (PL2-D-50).
- 13c7379: EMAIL adapters `ses` (SES v2 in ap-south-1, configuration set per brand, SNS events verified per C-13 with a timestamp window) and `brevo` (GLOBAL with a DPA reference, idempotencyKey and tag lookup, DKIM-checked failover target, shared-secret webhooks with Brevo's source ranges); SMS adapters `msg91` (Flow API v5, CRQID, bearer delivery reports, balance health) and `gupshup-sms` (Enterprise GatewayAPI as a POST form, rendered DLT text, URL-token delivery reports) with a shared DLT registry that refuses unregistered templates and headers before any request; WHATSAPP adapters `gupshup` (BSP API) and `meta-cloud` (Graph API v26.0, `X-Hub-Signature-256`, verify-token handshake) with the 24-hour window check, marketing templates off while `mkt.meta.enabled` is false, and a configuration rate card. New subpath exports `@infrabyx/connectors/email`, `/sms` and `/whatsapp`. `@aws-sdk/client-sesv2` 3.1152.0 (PL2-D-64).
- 0c4535d: PAYMENTS adapters `razorpay` (reference) and `cashfree` (alternative), test mode only, on the approved locked list P-01 to P-18 (PL2-D-66): live credentials refused outside prod/dr, exact integer paise, references derived from the idempotency key with vendor lookup, refunds gated by an approved R3 request and read against the PA's refund list, `kill.payments`, raw-body webhook signatures, read-only reconciliation. Router: `noFailover` method specs and `router.portFor(port, adapter)` so refunds, mandates and captures stay with their PA (P-08). Subpath `@infrabyx/connectors/payments`; P-18 manifests in `marketplace/`.

### Patch Changes

- 543c70d: Owner conditions for the Gupshup URL secret (PL2-D-65): an `ipb_token` shorter than 32 random bytes is refused; the telemetry scrubber redacts credential-named query parameters (`ipb_token`, tokens, secrets, keys, signatures, passwords); Gupshup SMS reports and WhatsApp events are passed on only after `confirmStatus` confirms them and are withheld (with `onWithheld`) without it.
- 2f29ec8: STORAGE: MinIO-server contract leg (presigned-URL expiry, method, content-type and signature
  enforcement; SSE-S3). `minio` stays unproven and refused outside dev and test (PL2-D-61).
- d7cb4fd: Ship `sandbox-status.json` in the package, so products can run `infrabyx-routing check --sandbox-status node_modules/@infrabyx/connectors/sandbox-status.json` and keep unproven adapters out of staging and above (IPB-DEV-04 gate B). Each unproven adapter now names its open `port-contract` issue (PL2-D-67).
- 5482043: WORKFLOW: the personal-data check on workflow ids, names and task queues now looks at whole tokens (split on `.` `_` `:` `-`), so a phone number or PAN used as an id part is still refused while a ULID or hex id that merely contains a PAN-shaped or long digit run is accepted (about 1 % of ULID ids were refused before).
- Updated dependencies [5482043]
- Updated dependencies [efd00ab]
- Updated dependencies [2969424]
- Updated dependencies [858a76a]
- Updated dependencies [9ac878e]
- Updated dependencies [ded1ae2]
- Updated dependencies [9c774b9]
- Updated dependencies [9ac878e]
- Updated dependencies [9ac878e]
- Updated dependencies [858a76a]
- Updated dependencies [7a36249]
- Updated dependencies [7a36249]
- Updated dependencies [7a36249]
- Updated dependencies [13c7379]
- Updated dependencies [13c7379]
- Updated dependencies [13c7379]
- Updated dependencies [0c4535d]
- Updated dependencies [0c4535d]
- Updated dependencies [858a76a]
  - @infrabyx/crypto@0.2.0
  - @infrabyx/config@0.2.0
  - @infrabyx/contracts@0.2.0
  - @infrabyx/tenancy@0.2.0
