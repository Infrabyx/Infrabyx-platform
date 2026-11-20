# @infrabyx/config

## 1.22.2

### Patch Changes

- Updated dependencies [2cb5b3f]
- Updated dependencies [a38f921]
- Updated dependencies [f62dcaa]
- Updated dependencies [dbb08e6]
  - @infrabyx/contracts@1.42.0
  - @infrabyx/crypto@1.10.0

## 1.22.1

### Patch Changes

- Updated dependencies [98c9416]
  - @infrabyx/contracts@1.41.0
  - @infrabyx/crypto@1.9.2

## 1.22.0

### Minor Changes

- 053e16a: Borrower email with byte-identical attachments and a delivery receipt, and the verified email (Udofin PR-UDF-055; R1-D-224). `contracts`: `NotificationRequest.attachments` (`NotificationAttachment`: STORAGE key, SHA-256, file name, PDF, PNG or JPEG; at most 10), `DeliveryRecord.vendorRef` and `DeliveryRecord.attachments` (the receipt), `EmailMessage.files` (`EmailAttachment`: verified bytes, sent unchanged, only to an adapter with `attachments: "native"`), `EMAIL_ATTACHMENT_LIMITS`, `EMAIL_ATTACHMENT_MEDIA_TYPES`, `emailAttachmentTypeOf`, `attachmentExtensionFits`; optional `CustomerIdentityPort.startEmailVerification`, `confirmEmailVerification` and `verifiedEmail` (`VerifiedCustomerEmail`). `config`: the settings `ntf.email.attachments.enabled` (tenant), `ntf.email.attachments.confidential` and `int.identity.customer.email_capture.enabled` (platform), all off. `notify`: attachments read from STORAGE at send and checked (class, type, SHA-256, 10 MiB) before the adapter; the receipt in `deliveryStatus`; migration `0008_email_attachments` (two nullable columns; expand-only). `connectors`: `ses` and `brevo` take `files` and check each SHA-256 again; the verified-email capture in the customer IDENTITY adapters (`emailCapture` option, `readCustomerEmailCapture`, `CustomerAuthStore.saveVerifiedEmail` and `verifiedEmail`, optional); migration `0015_customer_verified_email` (expand-only). `testing`: the SES and Brevo stubs record each attachment's SHA-256. Everything is off by default; nothing existing changes. Apply `notify/0008` and `connectors/0015` before turning either feature on.

### Patch Changes

- Updated dependencies [053e16a]
- Updated dependencies [ce8ca22]
- Updated dependencies [b135555]
- Updated dependencies [48810fd]
- Updated dependencies [1ffb012]
  - @infrabyx/contracts@1.40.0
  - @infrabyx/crypto@1.9.1

## 1.21.0

### Minor Changes

- 3b57c29: The GRC port and the §6.15 GRC events (Finbyx PR-FBX-51; R1-D-220; ADR-0013). `contracts/events` adds the v1 data schemas `ControlTestResultPublishedData`, `ComplianceIssueRaisedData`, `ReturnStatusUpdatedData`, `PolicyAttestedData` and `SecurityIncidentNotifiedData` with their type constants (`in.infrabyx.grc.<Event>.v1`) and enums, `GRC_EVENTS` (type, schema, idempotency fields, direction, regulated; with `EvidenceSubmitted` and `ObligationPublished`), `grcIdempotencyKey`, `grcPersonalDataProblems` (every schema refuses an Aadhaar-like number or a PAN anywhere in the data), `GRC_MASKED_ID`, `RETURN_PERIOD` and `securityIncidentClockCopy` (the OH13 copy). `contracts/ports` adds `GrcPort` on the Ecosystem Spec §9.2 generic connector contract: `listObligations({ updatedSince?, cursor?, limit? }, call?)` → `{ items: GrcObligation[], nextCursor? }` and `publishControlTestResult`, `submitEvidence`, `raiseIssue`, `notifyIncident`, `updateReturnStatus`, `recordPolicyAttestation` (the event data, `call?`) → `GrcReceipt`, with `GRC_POST_METHODS`, `GRC_REFUSALS`, `grcRefusal`, `assertGrcClass`, `prepareGrcPost`, `prepareGrcObligationQuery` and the catalogue entry (tier 2, `int.grc.`, in `R1_PORTS`). Every POST is keyed (the caller's key, else the event's own); the same key and body answer the same receipt, another body is `IPB-PORT-004`; incident updates are taken in `update_seq` order (`out_of_order`); a call above CONFIDENTIAL and any personal data are `IPB-PORT-003`. `config` registers `int.grc.generic.enabled` (false) and `int.grc.generic.host` (empty). `connectors` adds `@infrabyx/connectors/grc`: `GenericGrc` (`generic-grc`), the §9.2 REST contract to one configured host with a bearer token from SECRETS, stub-shaped where §9.2 is silent, off and unproven; its router method table and exit entry. `fakes` adds `FakeGrc`, `GrcFixtures` and `grcFakeFixtures`; `testing` adds `grcContractCases`, `grcSamples`, `grcObligations` and `startGrcStub`. No migration; nothing existing changes.

### Patch Changes

- Updated dependencies [5fd012a]
- Updated dependencies [3b57c29]
- Updated dependencies [4d509e6]
  - @infrabyx/contracts@1.39.0
  - @infrabyx/crypto@1.9.0

## 1.20.1

### Patch Changes

- Updated dependencies [3c4b588]
  - @infrabyx/contracts@1.38.0
  - @infrabyx/crypto@1.8.0

## 1.20.0

### Minor Changes

- ff2a74b: The STATEMENT_ANALYSIS port, its adapters and its fake (Udofin PR-UDF-048; R1-D-202; ADR-0012). `contracts` adds `StatementAnalysisPort`: `analyse({ subjectRef, inputs: [{ fiType, storageKey, sha256 }], reportPrefix }, call?) → StatementAnalysis` (`analysisId` `sta_<ULID>`, `state` `COMPLETED`, `PENDING` or `FAILED`, `report?: { storageKey, sha256 }`, `failureReason?`, `adapter`, `method`, `vendorRef`, `checkedAt`), `status(analysisId, call?)` and `handleWebhook(rawBody, headers, meta?)`, with `StatementAnalysisRequest` (strict; STORAGE references and SHA-256s only, up to 24 inputs in the report prefix's tenant, no Aadhaar-like subject reference; every field REGULATED), `StatementAnalysisResult`, `statementAnalysisResultOnly`, `STATEMENT_ANALYSIS_FAILURES`, `STATEMENT_ANALYSIS_REFUSALS`, `assertStatementAnalysisClass`, `statementInputFormat`, the catalogue entry (tier 2, `int.statement_analysis.`, in `R1_PORTS`), the `sta` id prefix and `PORT_DEFAULT_DATA_CLASS.STATEMENT_ANALYSIS = "REGULATED"`. `config` registers `int.statement_analysis.platform.enabled`, `int.statement_analysis.http.enabled` (both false) and `int.statement_analysis.http.host` (empty). `connectors` adds `@infrabyx/connectors/statement-analysis`: `PlatformStatementAnalyser` (`platform-statement`, the reference: in-platform, no vendor or egress, a checksum-summary report and nothing from a statement's content) and `HttpStatementAnalyser` (`http-statement`, a vendor-neutral HTTP alternative, every vendor shape stub-shaped), both off and refusing `handleWebhook` `unsupported`; `StatementAnalysisStore`, `PgStatementAnalysisStore`, `MemoryStatementAnalysisStore` and the migration `0014_statement_analysis.sql` (`connectors.statement_analysis`, forced RLS, hashes and references only, 24 hours); keyed retries answer the same analysis with one analyser call and the key with another request is `IPB-PORT-004`; an input outside the REGULATED class, or a call class other than REGULATED, is `IPB-PORT-003` before any analyser call, and the router's method table refuses an instance that cannot carry REGULATED. `fakes` adds `FakeStatementAnalysis` (its webhook signed with the approved C-22 profile under a development key), `signFakeStatementAnalysisNotification`, `fakeStatementAnalysisWebhookKeys` and `StatementAnalysisFixtures`; `testing` adds `statementAnalysisContractCases`, `statementAnalysisFakeFixtures`, `contractStatement`, `startStatementAnalysisStub` and the ESLint plugin's port default. Run `infrabyx-migrate` for `connectors/0014` if you wire the adapters' PostgreSQL store.

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

## 1.19.0

### Minor Changes

- 4af2688: Owner answer #132 (4) and (5) (R1-D-187). A reveal names a purpose code (`RevealRequest.purposeCode`; `RevealRule.purposeCodes`, default `REVEAL_PURPOSE_CODES`; refused `purpose_code_invalid`), recorded as the business id `purpose:<code>`. Refused reveals are kept as security audit events in `audit.security_event` (migration `audit/0012`; `PgSecurityEvents`, `SecurityEventSink`), outside the business ledger, never with the value; the threshold-th refusal of one principal within the window raises `RevealRefusalsRepeated` (settings `rules.reveal.refusal_alert_threshold`, `rules.reveal.refusal_alert_window_minutes`). A `revealRule` now requires `securityEvents`, `refusalCounter` and `outbox`. `defineRulesRevealContract` sends a purpose code and checks its refusal.

### Patch Changes

- Updated dependencies [4af2688]
- Updated dependencies [955cc67]
  - @infrabyx/contracts@1.36.0
  - @infrabyx/crypto@1.6.2

## 1.18.1

### Patch Changes

- Updated dependencies [a6929eb]
  - @infrabyx/contracts@1.35.0
  - @infrabyx/crypto@1.6.1

## 1.18.0

### Minor Changes

- 3e69471: TallyPrime settings (PR-FBX-46, R1-D-178): `int.accounting.tally.enabled` (TENANT, off, R4), `int.accounting.tally.poll_timeout_seconds` (25, 1 to 55) and `int.accounting.tally.job_expiry_days` (7, 1 to 30).

### Patch Changes

- Updated dependencies [3e69471]
- Updated dependencies [3e69471]
  - @infrabyx/contracts@1.34.0
  - @infrabyx/crypto@1.6.0

## 1.17.0

### Minor Changes

- 34f5e49: Inbound mail replies (PR-LDC-50, R1-D-177): `ntf.reply.enabled` (TENANT, off, R4), `ntf.reply.domain` (TENANT, empty, R4) and `ntf.reply.token_days` (TENANT, 30, 1 to 90).

### Patch Changes

- Updated dependencies [34f5e49]
  - @infrabyx/contracts@1.33.0
  - @infrabyx/crypto@1.5.18

## 1.16.0

### Minor Changes

- 6bb68c1: Four settings for web snapshots (PR-LDC-40, R1-D-176): `int.egress.governed.enabled` and `int.web_snapshot.enabled` (PLATFORM, off, R4), `int.web_snapshot.allow_hosts` (TENANT, empty, ORG_ADMIN, R4) and `int.web_snapshot.per_hour` (PLATFORM, 60).

### Patch Changes

- Updated dependencies [6bb68c1]
  - @infrabyx/contracts@1.32.0
  - @infrabyx/crypto@1.5.17

## 1.15.2

### Patch Changes

- Updated dependencies [32097cb]
  - @infrabyx/contracts@1.31.0
  - @infrabyx/crypto@1.5.16

## 1.15.1

### Patch Changes

- Updated dependencies [c79fef5]
  - @infrabyx/contracts@1.30.0
  - @infrabyx/crypto@1.5.15

## 1.15.0

### Minor Changes

- 1089dc7: Registers `int.av.clamav.enabled` (PLATFORM, default off, R4) for the ClamAV AV adapter (PR-LDC-41).
- 1089dc7: List settings may declare `minItems`, `maxItems` and `uniqueItems` (`min_items`, `max_items`, `unique_items` in `settings-tree.yaml`; PR-LDC-56), checked on every write path and when a registry is built (`definitionErrors`).
- 1089dc7: `SettingsService.setIn(tx, key, target, value)`: a UNIT or TENANT write inside the caller's transaction with every check `set` makes; a maker-checker key still answers `pending` (PR-LDC-42).
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
  - @infrabyx/contracts@1.29.0
  - @infrabyx/crypto@1.5.14

## 1.14.0

### Minor Changes

- 15be78b: Registers `int.av.clamav.enabled` (PLATFORM, default off, R4) for the ClamAV AV adapter (PR-LDC-41).
- 15be78b: `SettingsService.setIn(tx, key, target, value)`: a UNIT or TENANT write inside the caller's transaction with every check `set` makes; a maker-checker key still answers `pending` (PR-LDC-42).

### Patch Changes

- Updated dependencies [15be78b]
- Updated dependencies [15be78b]
- Updated dependencies [15be78b]
  - @infrabyx/contracts@1.28.0
  - @infrabyx/crypto@1.5.13

## 1.13.4

### Patch Changes

- Updated dependencies [043a348]
- Updated dependencies [043a348]
- Updated dependencies [043a348]
  - @infrabyx/contracts@1.27.0
  - @infrabyx/crypto@1.5.12

## 1.13.3

### Patch Changes

- 0aa0f1d: Register `config.outbox` for the outbox relay (`config` migration `register_outbox`; LawDocsComply PR-LDC-35, R1-D-112). The outbox was never registered, so `OutboxRelay` neither found nor delivered its events; run `infrabyx-migrate` and the next relay pass delivers the backlog.
- Updated dependencies [0aa0f1d]
  - @infrabyx/contracts@1.26.0
  - @infrabyx/crypto@1.5.11

## 1.13.2

### Patch Changes

- Updated dependencies [496180e]
  - @infrabyx/contracts@1.25.0
  - @infrabyx/crypto@1.5.10

## 1.13.1

### Patch Changes

- Updated dependencies [e86dedf]
  - @infrabyx/contracts@1.24.0
  - @infrabyx/crypto@1.5.9

## 1.13.0

### Minor Changes

- d3888de: The Gotenberg DOCGEN adapter (OWNER-QUESTIONS #120, R1-D-100; R1-plan M71): `GotenbergDocgen` (`@infrabyx/connectors/docgen`) renders `renderHtml` requests to PDF or PDF/A (PDF/A-2b with PDF/UA) through an in-cluster Gotenberg's Chromium route, so Hindi, Punjabi and other Indic text is shaped with the Noto fonts in its image (`fonts-noto-core`); the PDF goes to the tenant's STORAGE under the request's output prefix with its SHA-256 and page count. It sends one `index.html` and nothing else, fails on console exceptions, talks HTTPS to its configured host only, and is off behind the new setting `int.docgen.gotenberg.enabled` (PLATFORM, default false, R4). The template methods are declared unsupported. `@infrabyx/testing` adds `docgenHtmlContractCases` and the pinned `gotenberg` test image (8.39.0); `port-contract` gains a DOCGEN leg; `PORT_EXIT` has the DOCGEN entry. With `renderPdf` from `@infrabyx/export`, vernacular KFS and notices render for every product.

## 1.12.1

### Patch Changes

- Updated dependencies [67be297]
- Updated dependencies [67be297]
- Updated dependencies [67be297]
  - @infrabyx/contracts@1.23.0
  - @infrabyx/crypto@1.5.8

## 1.12.0

### Minor Changes

- 3c9bb25: DPDP erasure of a person's USER settings (OWNER-QUESTIONS #110, R1-D-95): `SettingsService.eraseUser(ctx, userId, { requestRef, reason })` deletes the person's USER values and USER change history in the caller's tenant in one transaction, ledgered as `settings.user.erase` with the counts and the request reference (never a value). Callers: the product's erasure workflow (a service principal), ORG_OWNER or ORG_ADMIN; agents, externals and platform contexts are refused. Migration `config/0004` adds `config.setting_erasure` and the history's only delete path (USER rows of an erased person, in the caller's tenant); the history stays insert-only otherwise. `SettingsStore.eraseUser` is optional.
- 3c9bb25: UNIT setting scopes below ENTITY (PR-042; LawDocsComply PR-LDC-17; R1-D-95). A key opts in with `unit_override` in `settings-tree.yaml` (`SettingDef.unitOverride`; TENANT, ENTITY or USER keys only; off for every platform key). Reads resolve ENTITY → each of `ctx.unitIds` outermost first → USER, so the innermost unit wins; writes at UNIT need the key's change role and the unit in the caller's own chain, stay tighten-only against the outer units, and go to the change history. Migration `config/0005` admits `UNIT` in the tier checks (a UNIT row belongs to one tenant). At most 8 units of 1 to 64 of `[A-Za-z0-9_-]`.

### Patch Changes

- Updated dependencies [3c9bb25]
  - @infrabyx/contracts@1.22.0
  - @infrabyx/crypto@1.5.7

## 1.11.0

### Minor Changes

- 1dda4b2: Approval expiry from a product setting (OWNER-QUESTIONS #106; LawDocsComply PR-LDC-19; R1-D-89): the new registered key `mc.expiry_hours.{action}` (TENANT tier, 1 to 168 hours, tighten-only, R4) is read by `settingsApprovalPolicy` as `TenantApprovalPolicy.expiryHours`, and `ApprovalsEngine` uses it only to shorten the action's platform expiry, clamped to [1 hour, the platform period]; it never lengthens it. `expiryHoursFor(risk, financial, tenantHours?)` and `APPROVAL_MIN_EXPIRY_HOURS` are exported.

### Patch Changes

- Updated dependencies [1dda4b2]
- Updated dependencies [1dda4b2]
  - @infrabyx/contracts@1.21.0
  - @infrabyx/crypto@1.5.6

## 1.10.1

### Patch Changes

- Updated dependencies [b8c1f2c]
  - @infrabyx/contracts@1.20.0
  - @infrabyx/crypto@1.5.5

## 1.10.0

### Minor Changes

- c8b8f88: `SettingsService.history(ctx, key, scope, { limit?, cursor? })` lists each change of a setting at one scope, newest first and paged (1 to 100, default 50): who, when, the old and new value, the version and the approval request id, each linked to its `settings.setting.change` ledger entry. Migration `config/0003_setting_change.sql` adds the insert-only `config.setting_change` table under forced RLS (TENANT, ENTITY and USER rows follow `app.tenant_id`; PLATFORM, PLAN and BRAND rows a platform context; the actor is the context's own), written by `SettingsService` in the same transaction as the value and the ledger entry; history is kept from this migration on. A USER scope's history is its owner's alone; TENANT and ENTITY need a role that may change the key, `ORG_OWNER`, `ORG_ADMIN` or `ORG_AUDITOR_RO`; the platform tiers a platform role in a platform context. `SettingsStore` gains the optional `appendChange` and `history`, implemented by `PgSettingsStore` and `MemorySettingsStore` (PR-LDC-17 in part; R1-D-82).

### Patch Changes

- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
  - @infrabyx/contracts@1.19.0
  - @infrabyx/crypto@1.5.4

## 1.9.2

### Patch Changes

- Updated dependencies [9c368c7]
- Updated dependencies [9c368c7]
  - @infrabyx/contracts@1.18.0
  - @infrabyx/crypto@1.5.3

## 1.9.1

### Patch Changes

- Updated dependencies [714ad01]
  - @infrabyx/contracts@1.17.0
  - @infrabyx/crypto@1.5.2

## 1.9.0

### Minor Changes

- b3edda2: `SettingsService.setInitial(tx, key, value)`: a new tenant's initial tenant-tier value inside `TenantBootstrap`'s transaction, with `set`'s validation, tighten check and ledger entry; refused outside a tenant's creation and for settings under maker-checker (R1-D-67).

### Patch Changes

- Updated dependencies [b3edda2]
- Updated dependencies [b3edda2]
  - @infrabyx/contracts@1.16.0
  - @infrabyx/crypto@1.5.1

## 1.8.0

### Minor Changes

- fdd1f1a: `int.bureau.cibil.enabled` and `int.aa_fiu.setu.enabled` (default false): the switches of the `cibil` and `setu-aa` adapters (owner answer #97; R1-D-61).
- ed143e3: Two settings keys for the Digio mandate adapter and NeSL DDE, both off by default (owner answer #100; R1-D-62): `int.payments.digio_mandate.enabled` and `int.estamp.nesl_dde.enabled`.

## 1.7.0

### Minor Changes

- 2a95100: The DEVICE_ATTESTATION reference adapter `native` (Udofin PR-UDF-028; owner answer #99; R1-D-59). Exported from `@infrabyx/connectors/device-attestation`:

  - **Play Integrity:** `decodeIntegrityToken` with a C-24 token, the binding, package, signing certificate, licence, device level and age checked, and each token used once.
  - **App Attest:** verified locally with C-27; a key registers once.

  Both halves are off behind `int.device_attestation.play_integrity.enabled` and `int.device_attestation.app_attest.enabled` (`config`). `testing`: `startPlayIntegrityStub`, `nativeDeviceEvidence`, and `DeviceEvidence`, the minter the contract cases now take, so they run on `native` and on the fake. Exit map and port matrix: `DEVICE_ATTESTATION`.

### Patch Changes

- Updated dependencies [2a95100]
  - @infrabyx/crypto@1.5.0

## 1.6.0

### Minor Changes

- 1b99d7a: The CAPTCHA and DEVICE_ATTESTATION ports (Udofin PR-UDF-029 and PR-UDF-028; ADR-0004; R1-D-50). `contracts`: `CaptchaPort` (`verify` returns a verdict: `invalid`, `expired`, `duplicate`, `action_mismatch`, `hostname_mismatch`) and `DeviceAttestationPort` (Play Integrity, App Attest registration and assertions, bound to a nonce or the DPoP key), both catalogued in `R1_PORTS`. `connectors` (`@infrabyx/connectors/captcha`): `TurnstileCaptcha` (reference) and `HCaptchaCaptcha` (alternative), which send only the token and the secret, and `CaptchaGate`, which asks for a token only while `int.captcha.under_attack` is on and then fails closed with 429 IPB-SEC-019. `config`: `int.captcha.under_attack`, `int.captcha.turnstile.enabled`, `int.captcha.hcaptcha.enabled` (both adapters off by default). `testing`: `FakeCaptcha`, `startCaptchaStub`, `captchaContractCases`, `FakeDeviceAttestation`, `deviceAttestationContractCases`. The device-attestation vendor adapters wait for the owner (OWNER-QUESTIONS #99).
- 1e721cd: `int.kyc.idfy.enabled` (PLATFORM, default false, R4): the IDfy KYC adapter stays off until the owner's IDfy sandbox exists (R1-D-45).
- 854e309: The `livekit` VIDEO_MEET reference adapter (`@infrabyx/connectors/video-meet`; owner answer #88, R1-D-53): a self-hosted LiveKit server called over its HTTP server API with C-26 tokens, the room's policy (India only, no anonymised origin, the official from the official network) enforced before a token is issued, webhooks verified and read back, and recordings moved from the egress disk to the room's STORAGE target with one locked single-part write each before the disk copy is removed. Off behind `int.video_meet.livekit.enabled` (`config`); the egress path is `unproven` until a deployment runs the egress worker. `testing`: the `livekit` test image and `videoMeetContractCases({ signWebhook })`. Compose: the `video` profile.

### Patch Changes

- Updated dependencies [1b99d7a]
- Updated dependencies [c83e9e0]
- Updated dependencies [af2ae98]
- Updated dependencies [c4117e4]
- Updated dependencies [854e309]
  - @infrabyx/contracts@1.15.0
  - @infrabyx/crypto@1.4.0

## 1.5.2

### Patch Changes

- Updated dependencies [97e8524]
- Updated dependencies [92706c4]
- Updated dependencies [4a87754]
- Updated dependencies [d66ffad]
  - @infrabyx/contracts@1.14.0
  - @infrabyx/crypto@1.3.1

## 1.5.1

### Patch Changes

- Updated dependencies [32b53ee]
- Updated dependencies [cff2a02]
  - @infrabyx/crypto@1.3.0
  - @infrabyx/contracts@1.13.0

## 1.5.0

### Minor Changes

- 63c5ad2: Saved table views and column layouts (Finbyx PR-FBX-09; IPB-07-13; R1-D-32). Migration `config/0002` adds `config.saved_view` and `config.table_layout` under forced RLS (personal views and layouts are their owner's alone). `SavedViews` (`@infrabyx/config/views`) lists, saves, updates (with the version read), removes and resolves the default view, and keeps the column chooser state; views are personal or shared with a team, tenant roles or the tenant, following `ux.tables.saved_views_shared`, with roles and tenant views and the tenant default for ORG_ADMIN or ORG_OWNER; filter values search would refuse are refused; every change is ledgered. Run `infrabyx-migrate`.

### Patch Changes

- Updated dependencies [63c5ad2]
  - @infrabyx/contracts@1.12.0
  - @infrabyx/crypto@1.2.7

## 1.4.1

### Patch Changes

- Updated dependencies [2e3a2d3]
- Updated dependencies [3f20011]
  - @infrabyx/contracts@1.11.0
  - @infrabyx/crypto@1.2.6

## 1.4.0

### Minor Changes

- 138ae44: Registers `int.api.idempotency_ttl_hours` (default 24, never below 24; IPB-10 §10.7) for the inbound idempotency store (R1-D-27).

### Patch Changes

- Updated dependencies [138ae44]
  - @infrabyx/contracts@1.10.0
  - @infrabyx/crypto@1.2.5

## 1.3.2

### Patch Changes

- Updated dependencies [2b307e0]
  - @infrabyx/contracts@1.9.0
  - @infrabyx/crypto@1.2.4

## 1.3.1

### Patch Changes

- Updated dependencies [cd25633]
  - @infrabyx/contracts@1.8.0
  - @infrabyx/crypto@1.2.3

## 1.3.0

### Minor Changes

- 94b706e: Registers `int.kyc.digio.enabled` (default false; PLT_SUPER_ADMIN, maker-checker R4): the Digio KYC adapter stays off until the owner's credentials exist (R1-D-24).

## 1.2.0

### Minor Changes

- f5622c9: Registers the retention of customer sign-in state (owner answer #86, R1-D-23): `int.identity.customer.retention.challenge_hours` (default 24), `guard_grace_seconds` (default 0) and `device_unused_days` (default 365). Each is PLATFORM tier, set by PLT_SECURITY_OFFICER under maker-checker R4.

### Patch Changes

- Updated dependencies [f5622c9]
  - @infrabyx/contracts@1.7.0
  - @infrabyx/crypto@1.2.2

## 1.1.1

### Patch Changes

- Updated dependencies [ceabe3b]
  - @infrabyx/contracts@1.6.0
  - @infrabyx/crypto@1.2.1

## 1.1.0

### Minor Changes

- 849b8f9: Customer sign-in settings (R1-D-19): `int.identity.customer.otp.*` (code lifetime, tries per code, sends per window, resend interval, back-off and lockout, IPB-02 `auth.otp`), `int.identity.customer.session.*` (idle and absolute lifetime) and `int.identity.customer.dpop.*` (proof `iat` window), PLATFORM tier, tighten only.

### Patch Changes

- Updated dependencies [849b8f9]
- Updated dependencies [849b8f9]
  - @infrabyx/contracts@1.5.0
  - @infrabyx/crypto@1.2.0

## 1.0.6

### Patch Changes

- Updated dependencies [7e38652]
- Updated dependencies [7e38652]
  - @infrabyx/contracts@1.4.0
  - @infrabyx/crypto@1.1.0

## 1.0.5

### Patch Changes

- Updated dependencies [b6058d3]
  - @infrabyx/contracts@1.3.0
  - @infrabyx/crypto@1.0.3

## 1.0.4

### Patch Changes

- 1c869a8: `envVar` clones a schema that already carries metadata, so a shared schema (`ProductCode`, `AppEnv`) declared twice keeps each declaration's own (`required`, example, description); before, the later one replaced the earlier, which made the seed CLI's optional refusal-gate `APP_PRODUCT` required (PR-FBX-04 note).

## 1.0.3

### Patch Changes

- Updated dependencies [75e9ea4]
  - @infrabyx/contracts@1.2.0
  - @infrabyx/crypto@1.0.2

## 1.0.2

### Patch Changes

- 8a2587e: The `infrabyx-*` CLI entry points run when started through a `node_modules` symlink (`pnpm exec`, npm `.bin`, `node node_modules/@infrabyx/config/…`); before, they exited 0 without running (PR-UDF-005).

## 1.0.1

### Patch Changes

- Updated dependencies [588b509]
  - @infrabyx/contracts@1.1.0
  - @infrabyx/crypto@1.0.1

## 1.0.0

### Major Changes

- 9ec9a2c: 1.0.0, the platform baseline release (IPB-14 §14.5 item 1; owner answer #67(4), PL6-D-16). Every `@infrabyx/*` package moves to 1.0.0 together; the public API is unchanged from the 0.x set of the PL6 gate (`docs/phases/PL6-gate.md` §6), so a product upgrades by moving every dependency to 1.0.0 at once. From 1.0.0 on, semantic versioning holds: a breaking change to an export, a migration or a setting is a major release with an ADR (IPB-09-34/35).

### Patch Changes

- Updated dependencies [9ec9a2c]
  - @infrabyx/contracts@1.0.0
  - @infrabyx/crypto@1.0.0

## 0.5.1

### Patch Changes

- b3934f9: PL6 session 4a: registers `hello.greeting.max_length` (TENANT, default 280, ceiling 2000), the setting of the reference app's `hello` module (`apps/reference/api`), so the template reads it through `SettingsService` like every product setting. Products that do not keep the hello module ignore it.

## 0.5.0

### Minor Changes

- de53086: Owner answer #40 (PL4-D-13): governed, tighten-only TENANT keys `vidhi.qa.min_reviews` (20), `vidhi.qa.precision_floor` (0.8) and `vidhi.qa.recall_floor` (0.8), changed by `ORG_OWNER` through R2 maker-checker. A tenant may only raise them; the registry minimum is the platform floor (235 keys in the registry).
- 1fecf45: Owner answer #53 (PL5-D-11): `cms.media.reencode_enabled` now defaults to `true` (AVIF and WebP renditions and PNG favicons through the MEDIA port).
- 275d4ba: Settings `trust.request.ack_hours` (24, may only be lowered) and `trust.request.fulfil_days` (`{ default: 10, regulator_deadline: 3 }`) from IPB-08 §08.5, read by the trust request SLA.
- 934355c: PL5 session 1 (PL5-D-02): 165 website keys (400 in the registry) from IPB-04 (`web.*`, `cms.*`, `brand.*`, the launch `mkt.*` keys, `fb.*`), IPB-05 (`pol.*`), IPB-06 (`a11y.*`), IPB-08 (`trust.*` for the mirror and the Trust Centre) and IPB-13 (`res.*` and the off-by-default blocks), plus `eco.v12.emit_enabled` (false). Launch defaults: no tag manager and no analytics adapter (OWN-09), form payloads never stored, Investors off; GPC, self-hosted fonts and the Claims Register are locked on; the contrast minimums, the Lighthouse floor (95) and the consent-cookie lifetime are tighten-only.

### Patch Changes

- b0dc390: Setting notes for `cms.soft_delete.restore_days` (content is purged 90 days after soft delete, OWNER-QUESTIONS #48) and `cms.media.reencode_enabled` (off: `sharp` failed the licence check, #43 and #53).
- b7de3c6: PL5 session 7: `validateEnv` and `loadAndValidate` give an absent optional variable its schema default (`envVar(z.enum([...]).default("a"), …)`), as its type already promised; before, the value was left out.
- Updated dependencies [de53086]
- Updated dependencies [f1a36a1]
- Updated dependencies [1fecf45]
- Updated dependencies [b0dc390]
- Updated dependencies [686d24b]
- Updated dependencies [e8e83cb]
- Updated dependencies [275d4ba]
- Updated dependencies [36338c3]
- Updated dependencies [934355c]
  - @infrabyx/contracts@0.5.0
  - @infrabyx/crypto@0.4.1

## 0.4.0

### Minor Changes

- 200b25a: The `ai.*` and `vidhi.*` settings keys of IPB-03 §03.5 (232 keys in the registry), with content capture locked off, plus `trust.privacy.cross_border_ai_allowed` (default false) and the token caps used while model prices are unset (PL4-D-02).

  New settings field `mc_deactivate` (bool keys only): switching an explicit `true` to `false` needs maker-checker at that class, while every other change applies at once. The four `ai.kill.*` keys use it with `tighten: true`, so a kill switch turns on immediately, needs an R2 checker to turn off, and a lower tier can never switch off a higher one (IPB-03-48).

### Patch Changes

- f6e9a88: `ai.obs.run_retention_days`: the note now records the owner's approval of the 180-day run deletion (PL4-D-05).
- Updated dependencies [2b07109]
- Updated dependencies [f6e9a88]
- Updated dependencies [200b25a]
- Updated dependencies [9af583a]
- Updated dependencies [288ae44]
- Updated dependencies [b205b1d]
- Updated dependencies [183c532]
- Updated dependencies [f6e9a88]
  - @infrabyx/contracts@0.4.0
  - @infrabyx/crypto@0.4.0

## 0.3.0

### Minor Changes

- 50093e9: Settings `int.esign.provider` (`leegality` | `digio` | `memory`) and `int.esign.expire_in_days`
  (1–90, default 10), both PLATFORM tier and R4 (PL3-D-23).
- 2725b6c: PL3 session 1: settings for RULES (`rules.*`), PUSH (`int.push.*`), NOTIFY dedupe, workflow timers,
  export (`eng.export.*`) and the tighten-only maker-checker tenant keys `mc.*` (new tighten mode
  `subset`); exact `kill.msg.email|sms|whatsapp|push|inapp` switches; `FlagService.boot()` persists or
  loads the flag snapshot at startup, and `onAlert` raises `ops.flags.provider_unreachable`
  (throttled) whenever flags are served without the provider (PL3-D-13).
- dd7a98b: A maker-checker setting change carries the checker diff (`{ before, after }` at the target scope)
  in its approval request (IPB-07-15, @IPB-07-AT-06).
- 53697f5: `FlagService`: the `ops.flags.provider_unreachable` alert escalates when a provider outage passes
  1 hour and again at 12 hours (`ALERT_ESCALATIONS`; alert fields `outageS` and `escalation`), once
  each per outage, dated from the last provider contact so a restart does not reset it. The IPB-01
  24-hour snapshot limit is unchanged (OWNER-QUESTIONS #20, PL3-D-17).

### Patch Changes

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
- Updated dependencies [3951517]
  - @infrabyx/contracts@0.3.0
  - @infrabyx/crypto@0.3.0

## 0.2.0

### Minor Changes

- efd00ab: PL2 session 1: settings keys for the thirteen PL2 ports (IPB-01 §01.4.4.2; 156 keys in the
  registry), the provider_routing loader `loadRoutingFile` and the `infrabyx-routing check` CLI
  (IPB-01-20), including the IPB-DEV-04 gate-B check against `sandbox-status.json`.
- 13c7379: Settings `mkt.meta.enabled` (default false, OWN-08), `int.sms.low_balance_credits` (default 500) and `int.whatsapp.rate_card` (deployment configuration only) for the messaging adapters (PL2-D-64).

### Patch Changes

- 0c4535d: Env guard `payments-live-key`: a live Razorpay key (`rzp_live_`) in any variable refuses to start outside prod and dr (P-03).
- Updated dependencies [5482043]
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
- Updated dependencies [13c7379]
- Updated dependencies [13c7379]
- Updated dependencies [0c4535d]
  - @infrabyx/crypto@0.2.0
  - @infrabyx/contracts@0.2.0

## 0.1.0

### Minor Changes

- 542194d: PL1 config: typed environment schema helpers and boot loader with the IPB-11 guard table and supabase-guard (exit 78, names only, never values), secret:// resolution through the SECRETS port, schema-driven redaction and the `infrabyx-env example [--check]` generator; the settings registry generated from `settings-tree.yaml` with typed reads, scope precedence, tighten-only and locked enforcement, ledgered writes and maker-checker routing; the flag registry (`kill.*`, IPB-12 `fut.*`) with snapshot fallback and kill-switch safe state; migration `config/0001_init.sql`.

  Audience: developer · Reg: none · Notice class: standard

### Patch Changes

- c2cf60a: PL0 toolchain baseline: pnpm 9 lockfile, Turborepo pipeline, ESLint 10 flat config with the IPB
  rules `ipb/vendor-import`, `ipb/schema-boundary` and `ipb/no-process-env` (placeholders),
  Vitest, Prettier, Renovate per IPB-01 §01.4.1.2, SHA-pinned CI and release workflows, and the
  `ipb:check` structural checks. Released with the seven PL1 packages at 0.1.0 (PL1-D-02 / D-06); the fifteen later-phase packages stay unpublished scaffolds until their own phase.

  Audience: internal · Reg: none · Notice class: standard

- Updated dependencies [c2cf60a]
- Updated dependencies [a17086c]
- Updated dependencies [8f44a2c]
  - @infrabyx/contracts@0.1.0
  - @infrabyx/crypto@0.1.0
