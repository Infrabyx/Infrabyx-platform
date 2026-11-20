# @infrabyx/testing

## 1.24.0

### Minor Changes

- 3c4b588: The origination contract of Ecosystem Specification §6.2 and §6.3 and a mock lender (Udofin PR-UDF-051; R1-D-217). `contracts/events`: `EligibilityCheckRequest` and `EligibilityCheckAnswer` for the synchronous `POST /v1/eligibility-checks` (3 s budget, `lender_unavailable` past it), the v1 data schemas of `ApplicationSubmitted`, `ApplicationStatusChanged`, `AdditionalInfoRequested`, `DecisionMade`, `KFSIssued`, `SanctionLetterIssued`, `BorrowerAccepted`, `CoolingOffExitRequested` and `LoanDisbursed`, `ORIGINATION_EVENTS` (type, schema, idempotency fields, direction, regulated), `ORIGINATION_REGULATED` and `originationIdempotencyKey`. `crypto`: `localRegulatedSigner(kid)`, an ES256 signer on an in-memory key for tests and fakes only. `fakes`: `FakeLender`, which answers the calls, emits the journey's envelopes and signs the regulated ones (`keys` to verify), with `script` and `outbox` hooks. `testing`: `lenderContractCases()` and `lspEvent()`. Nothing existing changes.

### Patch Changes

- Updated dependencies [3c4b588]
  - @infrabyx/contracts@1.38.0
  - @infrabyx/crypto@1.8.0
  - @infrabyx/fakes@1.2.0
  - @infrabyx/audit@1.11.2
  - @infrabyx/config@1.20.1
  - @infrabyx/seed@1.0.48
  - @infrabyx/tenancy@1.21.1

## 1.23.0

### Minor Changes

- 82dc7ef: The AA consent's FIU check, approval link and product reference (Udofin PR-UDF-050; R1-D-204). `contracts`: `AaConsentRequest.fiuId?` (the FIU the consent is for, `AA_FIU_ID_REGEX`) and `AaConsentRequest.consentArtefact?` (the product's own `{ kind, id }`, R1-D-203; `consentRef` is unchanged, the required `cpr_` string); `AaConsent.fiuId?` (the FIU the AA reports) and `AaConsent.approvalUrl?` (the AA's customer approval page, only while PENDING); `aaFiuMismatch`, `AA_FIU_MISMATCH` (`fiu_mismatch`), `aaApprovalUrlAllowed` (`https:`, no user information, an exact listed host, and no 12-digit run or Aadhaar-like number once every RFC 9562 UUID is set aside, so an id whose last group is all digits is accepted; owner answer #154), `RFC9562_UUID`, `isRfc9562Uuid` and `AA_APPROVAL_URL_REFUSED` (`approval_url_not_allowed`). When a request names a FIU, a consent the AA reports for another FIU, or for none, is refused `IPB-PORT-001` `fiu_mismatch` (definite) before anything is kept or returned, and so is every later read-back (`consentStatus`, `revoke`, `fetch`, `handleWebhook`); a request without `fiuId` is compared with nothing, as before. `connectors` (`SetuAccountAggregator`): reads the FIU from the consent read-back's `detail.FIU.id`, keeps the asked FIU in `SetuConsentRecord.fiuId`, answers Setu's link as `approvalUrl` while PENDING only after `aaApprovalUrlAllowed` against the new `approvalHosts` option (default Setu's two hosts), reads the consent back before keeping its record so a refused one leaves none, and deprecates `approvalUrl(consentId)`. `fakes` (`FakeAccountAggregator({ fiuId?, approvalHost? })`) reports its own FIU (`fake-fiu`) and a letters-only link while PENDING, with `reportFiu` and `consentsKept` test hooks; `AccountAggregatorFixtures` gains optional `fiuId` and `reportFiu`. `testing` adds the AA contract cases (calls with and without a consent artefact, the FIU refusals, the link only while PENDING, an Aadhaar-like sweep) and the Setu stub's `fiuId`, `reportFiu`, `linkBase` and `nextConsentId` hooks (its ids are any random UUID, an all-digit last group included).
- 1cdbf0f: Aadhaar offline verification names its form (Udofin PR-UDF-039; R1-D-190). `AadhaarOfflineCheck.kind` (`AADHAAR_OFFLINE_KINDS`: `xml_zip`, the default, or `secure_qr`): the ZIP needs its share code, a Secure QR is refused with one; `AadhaarOfflineResult.kind` echoes it. The contract states the stored-object SHA-256 check before any parse or vendor call (`hash_mismatch`) and that no field carries more than the last four digits. Digio refuses `secure_qr` as `unsupported` until its path is checked against UIDAI's Secure QR specification; the fake verifies both forms. `kycContractCases` gains the case.
- 2f9d3f8: Aadhaar OTP e-KYC for a notified reporting entity (Udofin PR-UDF-041; R1-D-194). `KycPort.aadhaarOtpRequest({ uid, uidKind, consent }, call)` returns `{ txn, expiresAt }` with the evidence and `aadhaarOtpVerify({ txn, otp }, call)` returns `{ ekyc, signatureValid, uidLast4 }` with the evidence; both optional on the interface, provided by `FakeKyc`, `DigioKyc`, `IdfyKyc` and `kycMethodRouter` (the new `aadhaar_otp` method). Every call is refused `not_configured` before any vendor call unless the adapter is built with `notifiedEntity: true`. `contracts` adds `AadhaarOtpRequest`, `AadhaarOtpVerify`, `AADHAAR_UID_KINDS`, `AADHAAR_OTP_REFUSALS` (`uid_invalid`, `mobile_not_linked`, `otp_invalid`, `otp_expired`, `not_configured`) and `aadhaarUidValid` (12-digit Aadhaar number with first digit 2 to 9, or 16-digit VID, each with the Verhoeff check; grouped forms refused). The e-KYC response is written to the adapter's STORAGE; one that carries a full number is refused `ekyc_holds_number`. `aadhaarOtpVerify` is idempotent on `call.idempotencyKey` for 24 hours: a retry gets the first answer, the same key with another code or transaction is `IPB-PORT-004`. `connectors` adds `AadhaarOtpVerifyStore`, `PgAadhaarOtpVerifyStore`, `MemoryAadhaarOtpVerifyStore` and the migration `0011_kyc_aadhaar_otp_verify.sql` (`connectors.kyc_aadhaar_otp_verify`, forced RLS); `IdfyKyc` gains `currentTenant`. `fakes` adds `FAKE_AADHAAR_OTP`, `syntheticUid`, `AadhaarOtpFixtures` and `KycFixtures.aadhaarOtp`; `testing` adds five contract cases and the Digio and IDfy stubs' Aadhaar OTP.
- b0e0b72: One no-Aadhaar rule, its scanner and a test-database sweep (Udofin PR-UDF-042; R1-D-195). `contracts` adds the subpath `@infrabyx/contracts/aadhaar`: `findAadhaarLike(text, { letters? })` returns `{ kind: "AADHAAR" | "VID", start, end, masked }` for each 12-digit Aadhaar number (first digit 2 to 9, Verhoeff) and 16-digit VID (Verhoeff), plain or grouped in fours, bounded by a non-digit (a letter or `+` is a boundary; `letters: "join"` makes a letter part of the run), masked to the last four digits; also `holdsAadhaarLike` and `AADHAAR_LIKE_KINDS`. `verhoeffValid` moves there and is re-exported unchanged from the root and `./search-refusal`. `testing` adds `startPostgres({ beforeDrop(admin) })` (run by `end()` before the drop; a throwing hook still drops the database, then `end()` rejects with its error), the `infrabyx-aadhaar-scan` bin (exit 1 on a find, 0 on none, 2 on a usage error; masked output only), and `scanTextForAadhaar`, `scanPathsForAadhaar` and `scanDatabaseForAadhaar` (also as `@infrabyx/testing/aadhaar-scan`). `ai`'s scrubber uses the shared rule for its AADHAAR detector: a 16-digit VID is now tokenised as `AADHAAR`, and twelve digits right after a `+` are no longer missed; `verhoeffValid` keeps its behaviour. `connectors`' e-KYC check (`holdsAadhaarNumber`) uses the shared rule with `letters: "join"` and now also refuses a grouped number.
- 9e626ef: Bank account checks by mode, keyed retries and the penny-drop funding statement (Udofin PR-UDF-043; R1-D-196). `BankAccountCheck` gains an optional `mode` (`"pennyless"` or `"penny_drop"`, `BANK_ACCOUNT_MODES`) and `BankAccountResult` an optional `mode` (the mode used; always set by the platform's adapters and the fake). An adapter that cannot honour the mode asked refuses `IPB-PORT-002` with `meta.reason: "mode_unsupported"` (`BANK_ACCOUNT_MODE_UNSUPPORTED`) before any vendor call, never falling back to another mode; omitted, the adapter's configured mode is used and reported. `bankAccountVerify` is idempotent on `call.idempotencyKey` for 24 hours: a retry gets the first answer with no vendor call, and the same key with another account, IFSC, name or mode is `IPB-PORT-004`; a keyed penny drop whose first call did not finish is never sent again (`pending_unresolved`). The status set is unchanged (`BANK_ACCOUNT_STATUSES`). `contracts` adds `KYC_ADAPTER_FUNDING` and `kycAdapterFunding(adapter)`: per adapter, who funds a penny drop (`provider`, `tenant` or `unknown`) and the source, a statement only; Digio and IDfy are `unknown` until verified. `DigioKyc` and `IdfyKyc` now provide pennyless bank account checks (stub-shaped, adapters off) and refuse a penny drop `mode_unsupported`; `connectors` adds `BankAccountVerifyStore`, `PgBankAccountVerifyStore`, `MemoryBankAccountVerifyStore`, `keyedBankAccountVerify` and the migration `0012_kyc_bank_account_verify.sql` (`connectors.kyc_bank_account_verify`, forced RLS); `kycMethodRouter` moves a check past an adapter that refuses `mode_unsupported`, but not a keyed check or a penny drop past an unavailable one; the router's breaker no longer counts `mode_unsupported`. `FakeKyc` honours both modes (options `bankAccountModes`, `bankAccountMode`) and counts `bankAccountVendorCalls`; `fakes` adds `KycFixtures.bankAccount` (`BankAccountFixtures`); `testing` adds four contract cases and the Digio and IDfy stubs' bank accounts.
- aac1c2c: A product's own consent artefact beside the bureau consent receipt (Udofin PR-UDF-049; R1-D-203, owner answer #153). `BureauPullRequest.consentRef` is unchanged (the required `cpr_<ULID>` string), so no caller or adapter outside the platform needs a change. New optional `BureauPullRequest.consentArtefact: { kind, id }`, the product's own purpose-consent artefact for the same pull, and `BureauReport.consentArtefact?`, echoed only when the request carried one (an answer to a pull without it is exactly as before). `contracts` adds `ports/consent-ref`: `ConsentReceiptRef` (the `cpr_` string), `ConsentArtefact` (strict `{ kind, id }`: `kind` one to four dot-separated `[a-z][a-z0-9_]*` segments, 3 to 64 characters, `cpr` and `cns` reserved; `id` 3 to 128 characters of `[A-Za-z0-9._-]`, not a platform `cpr_`/`cns_` id; neither may hold a standalone run of 10 or more digits, an Aadhaar-like number (`findAadhaarLike`) or a standalone PAN-shaped run; each refusal a fixed label from `CONSENT_ARTEFACT_REFUSALS`), `consentArtefactProblem`, `consentInForce` (the artefact as `<kind>:<id>` when present, else `consentRef`) and `consentEcho`. The platform checks an artefact's shape only; the product asserts the consent behind it. Neither is sent to the CIC. `fakes` (`FakeCreditBureau`) and `connectors` (`CibilBureau`, whose pull record keeps `consentArtefact?` beside `consentRef`) accept and echo both; `testing` adds contract cases for calls with and without an artefact and the refusals, `contractConsentArtefact` and `malformedConsentArtefacts`.
- d58d5f0: DigiLocker start, document evidence and idempotent pulls (Udofin PR-UDF-040; R1-D-193). `KycPort.startDigilocker({ docTypes, returnUrl }, call)` returns `{ consentSession, signInUrl, expiresAt }` with the evidence; optional on the interface, provided by `FakeKyc`, `DigioKyc` and `kycMethodRouter`, refused `unsupported` by `IdfyKyc`. The return address must pass `digilockerReturnUrlAllowed` (`https:`, no user information, no 12-digit run, a host on the adapter's `digilockerReturnHosts`), else `return_url_not_allowed`. `DigilockerDocument` gains `evidence` and `signatureValid` (`null` when the vendor does not report it). `digilockerPull` is idempotent on `call.idempotencyKey` for 24 hours: a retry returns the stored documents instead of `consent_used`, the same key with another session or other types is `IPB-PORT-004`. `connectors` adds `DigilockerPullStore`, `PgDigilockerPullStore` and `MemoryDigilockerPullStore` and the migration `0010_kyc_digilocker_pull.sql` (`connectors.kyc_digilocker_pull`, forced RLS); the Digio stub gains the start and `completeDigilocker`; `kycContractCases` gains three cases and `KycFixtures.digilockerReturnUrl`.
- 7d70042: CVE-2026-114938 ("Java4Shell", CRITICAL; owner answer #143, R1-D-192): every test image that carries an OpenJDK JVM now starts with `-XX:-UseBASE64Intrinsics`, the HotSpot Base64 intrinsic off on every host whatever its CPU. `startService` appends it last to Keycloak's `JAVA_OPTS_APPEND` and to `JAVA_TOOL_OPTIONS` for Gotenberg (pdftk) and LocalStack, after any value you pass. New exports: `JVM_BASE64_INTRINSIC_OFF`, `TEST_IMAGE_JVM_OPTIONS_VAR` and `withJvmMitigation(name, env)`, for products that start these images themselves.

  **Products, act now (product guide §7cp):** run the platform's mitigated Keycloak customer image (`infra/keycloak/customer-otp`, rebuilt from this release, entrypoint kept), or set the flag yourselves so that `JAVA_OPTS_APPEND` ends with `-XX:-UseBASE64Intrinsics` on every Keycloak node (cluster, failover and rolling-update nodes, and the `kc.sh build` step); set it for Gotenberg (`JAVA_TOOL_OPTIONS`) and OpenSearch (`OPENSEARCH_JAVA_OPTS`) too; check the live JVM with `jcmd <pid> VM.flags -all`; and check your own image scans. The platform's waiver OWNER-WAIVER-CRIT-01 covers only the pinned Keycloak 26.8.2-0 base's OpenJDK build, only while the mitigation test passes, and ends on 15 Dec 2026 at the latest.

- dbaecff: V-CIP webhooks verified without a vendor call (Udofin PR-UDF-046; R1-D-199). `KycPort.verifyWebhook(rawBody, headers, meta?) → { eventId, vcipId, receivedAt }` (`KycWebhookReceipt`), optional on the interface, checks a webhook's size, signature, window and replay only, with no vendor call and no read-back, so a product answers 401 to an unverified event, records `eventId` in its module inbox, acknowledges within 2 s and reads the session back with `vcipStatus` from its queue (IPB-10-27). `handleWebhook` keeps its signature and, where `verifyWebhook` exists, is `verifyWebhook` and then `vcipStatus`. `contracts` adds `verifyKycWebhookWith` (the order: the body's size, at most `KYC_WEBHOOK_MAX_BODY_BYTES` (64 KiB) before anything is read; the Standard Webhooks headers; the signature and `KYC_WEBHOOK_TOLERANCE_SECONDS` (300) window; the replay claim on the delivery's id and timestamp; then the session id), `KYC_WEBHOOK_REFUSALS` (`body_too_large`, `signature_invalid`, `timestamp_stale`, `event_replayed`; `IPB-API-018`, definite), `kycWebhookRefused`, `KYC_WEBHOOK_MALFORMED` (`IPB-PORT-001` for a verified event naming no session) and `KycWebhookReplayStore`. `crypto` adds `verifyStandardWebhook` (C-13: HMAC-SHA-256 over `<id>.<timestamp>.<body>` as IPB-10-21 defines it, constant time, ±5 minutes, `whsec_` secrets, rotation, `v1` only) and `signStandardWebhookForTest`; no new algorithm. `FakeKyc` verifies Standard Webhooks (`FAKE_KYC_WEBHOOK`, `signFakeKycWebhook`, option `webhook: { secrets, replay }`, `vcipStatusVendorCalls`), and its `handleWebhook` now refuses an unsigned event. `KycFixtures.webhook` (optional) drives two new contract cases. `connectors` adds `standardWebhookKycVerifier` for an adapter whose provider signs with Standard Webhooks; `DigioKyc` and `IdfyKyc` refuse `verifyWebhook` `unsupported`; `kycMethodRouter` routes it under `vcip`. **Products: `FakeKyc.handleWebhook` and `verifyWebhook` now refuse an unsigned delivery, so a test that posts an event to the fake must sign it with `signFakeKycWebhook(body)` (from `@infrabyx/fakes` or `@infrabyx/testing`) and pass the headers it returns.** C-13 covers Standard Webhooks v1 by the owner's approval (R1-D-210); RFC 9421 is not approved.
- 80a843a: Liveness by mode, applied thresholds, keyed retries and the template retention statement (Udofin PR-UDF-044; R1-D-197). `LivenessCheck` gains an optional `mode` (`"passive"`, `"active_gesture"` or `"active_voice"`, `LIVENESS_MODES`) and `ScoreResult` an optional `threshold` (the threshold the adapter applied, for liveness and face match) and `mode` (the liveness mode used); the platform's adapters and the fake always set them. An adapter that cannot honour the mode refuses `IPB-PORT-002` with `meta.reason: "mode_unsupported"` (`KYC_MODE_UNSUPPORTED`, which `BANK_ACCOUNT_MODE_UNSUPPORTED` now equals) before any vendor call, never falling back; omitted, the configured mode is used and reported. `livenessCheck` and `faceMatch` are idempotent on `call.idempotencyKey` for 24 hours, a key scoped to its method: a retry gets the first answer with no vendor call, and the same key with other frames, another mode or other images is `IPB-PORT-004`. `score` is a finite number from 0 to 1 (`kycScoreValid`): an adapter normalises a vendor score on its known scale and refuses any other `IPB-PORT-003` with `meta.reason: "score_out_of_range"` (`KYC_SCORE_OUT_OF_RANGE`), never clamping. `contracts` adds `KYC_ADAPTER_RETENTION` and `kycAdapterRetention(adapter)`: per adapter, whether the vendor keeps a face template or embedding beyond the call (`none`, `kept` or `unknown`) and the source, a statement only; Digio and IDfy are `unknown` until a written vendor statement. `IdfyKyc` honours `passive` liveness only (its photo liveness), reports its thresholds (now checked to be from 0 to 1), reads scores on the scale `IDFY_SCORE_SCALE` (1, or the option `scoreScale: 100`) and refuses one off it instead of guessing the scale and clamping; `DigioKyc` has no liveness or face-match path and still refuses both `unsupported`. `connectors` adds `KycScoreCheckStore`, `PgKycScoreCheckStore`, `MemoryKycScoreCheckStore`, `keyedScoreCheck`, `livenessMode`, `scoreOnScale` and the migration `0013_kyc_score_check.sql` (`connectors.kyc_score_check`, forced RLS; no image, template, embedding or storage reference in clear); `kycMethodRouter` moves any call past `mode_unsupported` and keeps a keyed liveness check or face match with an unavailable adapter. `FakeKyc` honours every liveness mode (options `livenessModes`, `livenessMode`, `livenessThreshold`, `faceMatchThreshold`), counts `livenessVendorCalls` and `faceMatchVendorCalls`, and `offScaleNext()` makes its next score off the scale; `fakes` adds `KycFixtures.scores` (`ScoreFixtures`); `testing` adds seven contract cases and the IDfy stub's `livenessChecks`, `faceMatches` and `scoreOnce`.
- ff2a74b: The STATEMENT_ANALYSIS port, its adapters and its fake (Udofin PR-UDF-048; R1-D-202; ADR-0012). `contracts` adds `StatementAnalysisPort`: `analyse({ subjectRef, inputs: [{ fiType, storageKey, sha256 }], reportPrefix }, call?) → StatementAnalysis` (`analysisId` `sta_<ULID>`, `state` `COMPLETED`, `PENDING` or `FAILED`, `report?: { storageKey, sha256 }`, `failureReason?`, `adapter`, `method`, `vendorRef`, `checkedAt`), `status(analysisId, call?)` and `handleWebhook(rawBody, headers, meta?)`, with `StatementAnalysisRequest` (strict; STORAGE references and SHA-256s only, up to 24 inputs in the report prefix's tenant, no Aadhaar-like subject reference; every field REGULATED), `StatementAnalysisResult`, `statementAnalysisResultOnly`, `STATEMENT_ANALYSIS_FAILURES`, `STATEMENT_ANALYSIS_REFUSALS`, `assertStatementAnalysisClass`, `statementInputFormat`, the catalogue entry (tier 2, `int.statement_analysis.`, in `R1_PORTS`), the `sta` id prefix and `PORT_DEFAULT_DATA_CLASS.STATEMENT_ANALYSIS = "REGULATED"`. `config` registers `int.statement_analysis.platform.enabled`, `int.statement_analysis.http.enabled` (both false) and `int.statement_analysis.http.host` (empty). `connectors` adds `@infrabyx/connectors/statement-analysis`: `PlatformStatementAnalyser` (`platform-statement`, the reference: in-platform, no vendor or egress, a checksum-summary report and nothing from a statement's content) and `HttpStatementAnalyser` (`http-statement`, a vendor-neutral HTTP alternative, every vendor shape stub-shaped), both off and refusing `handleWebhook` `unsupported`; `StatementAnalysisStore`, `PgStatementAnalysisStore`, `MemoryStatementAnalysisStore` and the migration `0014_statement_analysis.sql` (`connectors.statement_analysis`, forced RLS, hashes and references only, 24 hours); keyed retries answer the same analysis with one analyser call and the key with another request is `IPB-PORT-004`; an input outside the REGULATED class, or a call class other than REGULATED, is `IPB-PORT-003` before any analyser call, and the router's method table refuses an instance that cannot carry REGULATED. `fakes` adds `FakeStatementAnalysis` (its webhook signed with the approved C-22 profile under a development key), `signFakeStatementAnalysisNotification`, `fakeStatementAnalysisWebhookKeys` and `StatementAnalysisFixtures`; `testing` adds `statementAnalysisContractCases`, `statementAnalysisFakeFixtures`, `contractStatement`, `startStatementAnalysisStub` and the ESLint plugin's port default. Run `infrabyx-migrate` for `connectors/0014` if you wire the adapters' PostgreSQL store.
- d35f7e9: The RE-hosted V-CIP launcher and its signed hand-off (Udofin PR-UDF-045; R1-D-198). `KycPort.launchVcip({ context, jws }, call) → { vcipId, launchUrl, expiresAt }` (`VcipLaunch`, with the evidence), optional on the interface, lets an LSP hand a customer to an RE's V-CIP without hosting any V-CIP component. `contracts` adds `VcipHandoffContext` (tenant, RE, LSP, customer reference, journey id, issued-at, expires-at, nonce: ids and times only, strict, at most `VCIP_HANDOFF_MAX_LIFETIME_SECONDS` (900) from issue to expiry, no field with a 12-digit run or an Aadhaar-like number), `LaunchVcip`, `VCIP_HANDOFF_REFUSALS` (`handoff_invalid`, `handoff_replayed`, `handoff_expired`), `vcipHandoffFailure`, `vcipHandoffTimeRefusal`, `vcipLaunchUrlAllowed` (`https:`, the adapter's exact hosts, no user information, no number) and `VCIP_LAUNCH_URL_REFUSED`. The LSP signs the context with the existing `signRegulatedMessage`; the adapter verifies it with `verifyRegulatedMessage` and its replay store before any vendor call (nothing new in cryptography), and refuses `IPB-PORT-001` with a fixed label, definite. `vcipStatus(vcipId, call?)` takes an optional `PortCall` and reads under its tenant. `VcipManifest` gains `reasonCode` (`VCIP_REASON_CODES`) and `liveness.mode` (`LIVENESS_MODES`); the free-text `reason` stays, deprecated, never to be shown. `VcipSession` gains an optional `vcipId` to start a launched session. `FakeKyc` implements the launcher (`FAKE_VCIP_HANDOFF`, `signFakeVcipHandoff`, `fakeVcipHandoffKeys`, `fakeVcipHandoffContext`, `vcipLaunchVendorCalls`); `KycFixtures.vcipLaunch` (optional) drives three new contract cases. `VcipConductor` takes hand-offs (`handoff: { reId, issuers, replay, launchBaseUrl, launchHosts? }`), schedules the session the RE's official starts with `startVcip({ …, vcipId })`, expires it with its hand-off (`launch_expired`), takes a `reasonCode` on `complete` and `drop`, a liveness `mode` on `assess`, and a `PortCall` or tenant on `vcipStatus`. `DigioKyc` and `IdfyKyc` refuse `launchVcip` `unsupported`; `kycMethodRouter` routes it under `vcip` and never moves a launch past an unavailable adapter.

### Patch Changes

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
  - @infrabyx/fakes@1.1.0
  - @infrabyx/tenancy@1.21.0
  - @infrabyx/crypto@1.7.0
  - @infrabyx/config@1.20.0
  - @infrabyx/audit@1.11.1
  - @infrabyx/seed@1.0.47

## 1.22.0

### Minor Changes

- 4af2688: Owner answer #132 (4) and (5) (R1-D-187). A reveal names a purpose code (`RevealRequest.purposeCode`; `RevealRule.purposeCodes`, default `REVEAL_PURPOSE_CODES`; refused `purpose_code_invalid`), recorded as the business id `purpose:<code>`. Refused reveals are kept as security audit events in `audit.security_event` (migration `audit/0012`; `PgSecurityEvents`, `SecurityEventSink`), outside the business ledger, never with the value; the threshold-th refusal of one principal within the window raises `RevealRefusalsRepeated` (settings `rules.reveal.refusal_alert_threshold`, `rules.reveal.refusal_alert_window_minutes`). A `revealRule` now requires `securityEvents`, `refusalCounter` and `outbox`. `defineRulesRevealContract` sends a purpose code and checks its refusal.

### Patch Changes

- Updated dependencies [4af2688]
- Updated dependencies [955cc67]
  - @infrabyx/contracts@1.36.0
  - @infrabyx/audit@1.11.0
  - @infrabyx/config@1.19.0
  - @infrabyx/crypto@1.6.2
  - @infrabyx/fakes@1.0.2
  - @infrabyx/seed@1.0.46
  - @infrabyx/tenancy@1.20.7

## 1.21.0

### Minor Changes

- 8afdde2: PR-FBX-48 (R1-D-181): the port fakes and their fixtures now live in the new `@infrabyx/fakes` package, which has no `vitest`, Testcontainers or database driver in its tree. `@infrabyx/testing` depends on it and re-exports every name unchanged (the same runtime and type exports as 1.20.0), so test files need no change. A product that wires fakes in a fixture environment at runtime imports them from `@infrabyx/fakes`, lists it in `dependencies`, and keeps `@infrabyx/testing` in `devDependencies` only; its production tree then no longer carries `vitest` and `picomatch` (GHSA-fc5q-39xc-vjpf).

### Patch Changes

- Updated dependencies [a6929eb]
  - @infrabyx/contracts@1.35.0
  - @infrabyx/audit@1.10.6
  - @infrabyx/config@1.18.1
  - @infrabyx/crypto@1.6.1
  - @infrabyx/fakes@1.0.1
  - @infrabyx/seed@1.0.45
  - @infrabyx/tenancy@1.20.6

## 1.20.0

### Minor Changes

- 3e69471: `AccountingScript.settle` may return a promise; the ACCOUNTING contract cases await it (PR-FBX-46, R1-D-178). The fake is unchanged.

### Patch Changes

- Updated dependencies [3e69471]
- Updated dependencies [3e69471]
- Updated dependencies [3e69471]
  - @infrabyx/config@1.18.0
  - @infrabyx/contracts@1.34.0
  - @infrabyx/crypto@1.6.0
  - @infrabyx/audit@1.10.5
  - @infrabyx/seed@1.0.44
  - @infrabyx/tenancy@1.20.5

## 1.19.0

### Minor Changes

- 34f5e49: Inbound mail replies (PR-LDC-50, R1-D-177): `FakeInboundEmail` (records sends with their reply address, and an inbound route) and `defineEmailInboundContract`, run against the fake and the SES adapter. The SES and Brevo stubs record the reply address they were sent.

### Patch Changes

- Updated dependencies [34f5e49]
- Updated dependencies [34f5e49]
  - @infrabyx/config@1.17.0
  - @infrabyx/contracts@1.33.0
  - @infrabyx/audit@1.10.4
  - @infrabyx/seed@1.0.43
  - @infrabyx/tenancy@1.20.4
  - @infrabyx/crypto@1.5.18

## 1.18.0

### Minor Changes

- 6bb68c1: `FakeWebSnapshot` and `defineWebSnapshotContract` (PR-LDC-40, R1-D-176): the web snapshot contract cases every `WebSnapshotPort` passes.

### Patch Changes

- Updated dependencies [6bb68c1]
- Updated dependencies [6bb68c1]
  - @infrabyx/config@1.16.0
  - @infrabyx/contracts@1.32.0
  - @infrabyx/audit@1.10.3
  - @infrabyx/seed@1.0.42
  - @infrabyx/tenancy@1.20.3
  - @infrabyx/crypto@1.5.17

## 1.17.1

### Patch Changes

- Updated dependencies [32097cb]
  - @infrabyx/contracts@1.31.0
  - @infrabyx/audit@1.10.2
  - @infrabyx/config@1.15.2
  - @infrabyx/crypto@1.5.16
  - @infrabyx/seed@1.0.41
  - @infrabyx/tenancy@1.20.2

## 1.17.0

### Minor Changes

- c79fef5: `defineRulesRevealContract(name, setup)`: the contract for an entitled reveal in `explain` (PR-LDC-59, R1-D-173). Names only without a grant; exactly one CONFIDENTIAL value with one, ledgered without the value; REGULATED, undeclared and INTERNAL inputs refused; agents, platform contexts, break-glass, impersonation and platform roles refused; another tenant's decision not found; grants single use, bound to their decision and principal, and look-alikes refused; purpose bounds.

### Patch Changes

- Updated dependencies [c79fef5]
  - @infrabyx/contracts@1.30.0
  - @infrabyx/audit@1.10.1
  - @infrabyx/config@1.15.1
  - @infrabyx/crypto@1.5.15
  - @infrabyx/seed@1.0.40
  - @infrabyx/tenancy@1.20.1

## 1.16.1

### Patch Changes

- 437e10c: `TEST_IMAGES.pgvector` (and `startPostgres`'s fallback, `PG_TEST_IMAGE`) moves to `pgvector/pgvector:0.8.6-pg18` (pinned by digest, pushed 13 Aug 2026), with CI's integration services and the Compose database (R1-D-169). pgvector 0.8.2 to 0.8.6 are fixes only, among them a buffer overflow in parallel HNSW index builds (0.8.2) and possible HNSW index corruption during vacuum (0.8.3).

## 1.16.0

### Minor Changes

- 1089dc7: `FakeAccountingSink` with `accountingContractCases` (PR-FBX-46) and `FakeCalendar` with `calendarContractCases` (PR-LDC-53).
- 1089dc7: AV port: `FakeFileScan`, `fileScanContractCases(storage)` and the `EICAR` test file; the pinned `clamav` test image (PR-LDC-41). A contract case checks that health reports signature freshness.
- 1089dc7: `FakePdf(storage)` gains `extractText` (PR-LDC-39), with `pdfFixture` to build test PDFs and `pdfTextContractCases` for adapters that offer the method.
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
- Updated dependencies [1089dc7]
  - @infrabyx/contracts@1.29.0
  - @infrabyx/tenancy@1.20.0
  - @infrabyx/audit@1.10.0
  - @infrabyx/config@1.15.0
  - @infrabyx/crypto@1.5.14
  - @infrabyx/seed@1.0.39

## 1.15.0

### Minor Changes

- 15be78b: `FakeAccountingSink` with `accountingContractCases` (PR-FBX-46) and `FakeCalendar` with `calendarContractCases` (PR-LDC-53).
- 15be78b: AV port: `FakeFileScan`, `fileScanContractCases(storage)` and the `EICAR` test file; the pinned `clamav` test image (PR-LDC-41). A contract case checks that health reports signature freshness.

### Patch Changes

- Updated dependencies [15be78b]
- Updated dependencies [15be78b]
- Updated dependencies [15be78b]
- Updated dependencies [15be78b]
- Updated dependencies [15be78b]
- Updated dependencies [15be78b]
- Updated dependencies [15be78b]
  - @infrabyx/contracts@1.28.0
  - @infrabyx/tenancy@1.19.0
  - @infrabyx/audit@1.9.0
  - @infrabyx/config@1.14.0
  - @infrabyx/crypto@1.5.13
  - @infrabyx/seed@1.0.38

## 1.14.5

### Patch Changes

- Updated dependencies [043a348]
- Updated dependencies [043a348]
- Updated dependencies [043a348]
  - @infrabyx/contracts@1.27.0
  - @infrabyx/audit@1.8.3
  - @infrabyx/config@1.13.4
  - @infrabyx/crypto@1.5.12
  - @infrabyx/seed@1.0.37
  - @infrabyx/tenancy@1.18.2

## 1.14.4

### Patch Changes

- 26c3035: `TEST_IMAGES.keycloak` pinned to Keycloak 26.8.2-0 by digest (R1-D-134): the same findings as 26.8.1-2, nothing new.

## 1.14.3

### Patch Changes

- Updated dependencies [0aa0f1d]
- Updated dependencies [0aa0f1d]
- Updated dependencies [0aa0f1d]
- Updated dependencies [0aa0f1d]
- Updated dependencies [0aa0f1d]
  - @infrabyx/audit@1.8.2
  - @infrabyx/config@1.13.3
  - @infrabyx/seed@1.0.36
  - @infrabyx/tenancy@1.18.1
  - @infrabyx/contracts@1.26.0
  - @infrabyx/crypto@1.5.11

## 1.14.2

### Patch Changes

- e1e85d5: The IDENTITY test image moves to Keycloak's 26.8.1-2 rebuild (`keycloak/keycloak@sha256:3f3c5f8e…`, pinned once 7 days old under PL2-D-32; R1-D-110). It clears CVE-2026-91415; products that run the IdP or the customer-otp image should rebuild on the same digest.

## 1.14.1

### Patch Changes

- Updated dependencies [496180e]
  - @infrabyx/contracts@1.25.0
  - @infrabyx/tenancy@1.18.0
  - @infrabyx/audit@1.8.1
  - @infrabyx/config@1.13.2
  - @infrabyx/crypto@1.5.10
  - @infrabyx/seed@1.0.35

## 1.14.0

### Minor Changes

- e86dedf: Wave 10 (R1-plan M72 to M74).

  - **`audit`: retire an empty capture table (OWNER-QUESTIONS #122, R1-D-102; Finbyx PR-FBX-39).** `audit/0008` adds `audit.retire_capture(regclass)`: for `app_migrate` only, only inside a migration applied by the platform runner, refused unless the registered table has no rows. It writes the retirement into the capture chain (`audit.capture_retirement`, itself captured, action `audit.capture.retire`), keeps every capture row, ends the registration, and lets the drop guard admit the drop of that one table in the same transaction only; the commit fails if the table is not dropped. Every other drop is still refused. Use: `select audit.retire_capture('<schema>.<table>'); drop table <schema>.<table>;` in one migration. Install `audit/0008` as the database owner, as `audit/0003`.
  - **`tenancy`: one tenant-id rule (Finbyx PR-FBX-40, R1-D-103).** `tenancy/0019` refuses a tenant id other than `tnt_` followed by 1 to 60 lower-case letters and digits, or a ULID; it first checks the existing tenants and stops, naming them, if one breaks the rule. The migration runner sets `ipb.migration` to the file it applies, for that file's transaction.
  - **`contracts`:** `TENANT_ID_REGEX`, `TENANT_ID_PATTERN`, `isTenantId`; every id they admit fits every port's storage prefix. Three new ports, interfaces only (R1-D-104): DISPATCH (`DispatchPort`, ADR-0008, Finbyx PR-FBX-41), COURT_DATA (`CourtDataPort`, ADR-0009, PR-FBX-42) and ODR (`OdrPort`, ADR-0010, PR-FBX-44; Ecosystem Spec 8.9), with catalogue rows.
  - **`testing`:** `FakeDispatch`, `FakeCourtData`, `FakeOdr`, `equatorOdrStub()` (with the group-company disclosure) and the three contract suites.
  - **`workflow`:** timer ids follow the tenant-id rule.

### Patch Changes

- Updated dependencies [e86dedf]
  - @infrabyx/audit@1.8.0
  - @infrabyx/tenancy@1.17.0
  - @infrabyx/contracts@1.24.0
  - @infrabyx/seed@1.0.34
  - @infrabyx/config@1.13.1
  - @infrabyx/crypto@1.5.9

## 1.13.0

### Minor Changes

- d3888de: The Gotenberg DOCGEN adapter (OWNER-QUESTIONS #120, R1-D-100; R1-plan M71): `GotenbergDocgen` (`@infrabyx/connectors/docgen`) renders `renderHtml` requests to PDF or PDF/A (PDF/A-2b with PDF/UA) through an in-cluster Gotenberg's Chromium route, so Hindi, Punjabi and other Indic text is shaped with the Noto fonts in its image (`fonts-noto-core`); the PDF goes to the tenant's STORAGE under the request's output prefix with its SHA-256 and page count. It sends one `index.html` and nothing else, fails on console exceptions, talks HTTPS to its configured host only, and is off behind the new setting `int.docgen.gotenberg.enabled` (PLATFORM, default false, R4). The template methods are declared unsupported. `@infrabyx/testing` adds `docgenHtmlContractCases` and the pinned `gotenberg` test image (8.39.0); `port-contract` gains a DOCGEN leg; `PORT_EXIT` has the DOCGEN entry. With `renderPdf` from `@infrabyx/export`, vernacular KFS and notices render for every product.

### Patch Changes

- Updated dependencies [d3888de]
  - @infrabyx/config@1.13.0
  - @infrabyx/audit@1.7.5
  - @infrabyx/seed@1.0.33
  - @infrabyx/tenancy@1.16.1

## 1.12.0

### Minor Changes

- 67be297: Whose return it is (Finbyx PR-FBX-36; the owner's table, OWNER-QUESTIONS #119; R1-D-97, R1-D-98). `ReturnCodeInfo.attribution` and `PresentationResult.returnAttribution`: `BORROWER` for NACH 04 (balance insufficient), NACH 01 (account closed), NACH 06 (payment stopped by drawer) and UPI Z9 (insufficient funds); `NOT_BORROWER` for NACH 07, 09, every other code and every unknown code (no charge). `bounceChargeable(info)` is true only for `BORROWER`. The table is a platform floor: `classifyReturnCode(channel, code, { borrowerCodes })` takes a tenant's list, which can only shrink the borrower's codes, never widen them. `[VERIFY]` against the sponsor bank's NPCI specification; the testing fake fills the new field.
- 67be297: The TELEPHONY port (Finbyx PR-FBX-38; ADR-0007; R1-D-97): `TelephonyPort` with `clickToCall` (a person or the product's service places it, never an agent; idempotent on its key), `callOutcome`, `storeRecording` (only when the request named a recording disclosure and the adapter reports it was played; stored in the tenant's STORAGE under the request's output prefix with its retention and `deleteAfter`) and `cancel`; catalogue row `TELEPHONY` (tier 2, `int.telephony.`). `@infrabyx/testing` adds `FakeTelephony` and `telephonyContractCases`. No adapter until a provider is chosen.

### Patch Changes

- Updated dependencies [67be297]
- Updated dependencies [67be297]
- Updated dependencies [67be297]
- Updated dependencies [67be297]
  - @infrabyx/contracts@1.23.0
  - @infrabyx/tenancy@1.16.0
  - @infrabyx/audit@1.7.4
  - @infrabyx/config@1.12.1
  - @infrabyx/crypto@1.5.8
  - @infrabyx/seed@1.0.32

## 1.11.2

### Patch Changes

- Updated dependencies [3c9bb25]
- Updated dependencies [3c9bb25]
- Updated dependencies [3c9bb25]
- Updated dependencies [3c9bb25]
  - @infrabyx/config@1.12.0
  - @infrabyx/tenancy@1.15.0
  - @infrabyx/contracts@1.22.0
  - @infrabyx/audit@1.7.3
  - @infrabyx/seed@1.0.31
  - @infrabyx/crypto@1.5.7

## 1.11.1

### Patch Changes

- Updated dependencies [bc2c301]
  - @infrabyx/tenancy@1.14.1
  - @infrabyx/audit@1.7.2
  - @infrabyx/seed@1.0.30

## 1.11.0

### Minor Changes

- 1dda4b2: EMAIL stubs (R1-plan M58; R1-D-90): the SES v2 stub accepts simple-content sends and records them (`simple`); the Brevo stub accepts sends without a template (`subject` and `htmlContent` required, `textContent` optional) and records them, so `BrevoStubMessage.templateId` is now optional.

### Patch Changes

- Updated dependencies [1dda4b2]
- Updated dependencies [1dda4b2]
- Updated dependencies [1dda4b2]
  - @infrabyx/tenancy@1.14.0
  - @infrabyx/config@1.11.0
  - @infrabyx/contracts@1.21.0
  - @infrabyx/audit@1.7.2
  - @infrabyx/seed@1.0.29
  - @infrabyx/crypto@1.5.6

## 1.10.1

### Patch Changes

- Updated dependencies [b8c1f2c]
- Updated dependencies [b8c1f2c]
  - @infrabyx/contracts@1.20.0
  - @infrabyx/tenancy@1.13.0
  - @infrabyx/audit@1.7.1
  - @infrabyx/config@1.10.1
  - @infrabyx/crypto@1.5.5
  - @infrabyx/seed@1.0.28

## 1.10.0

### Minor Changes

- c8b8f88: BUREAU and ESTAMP DDE for PR-FBX-35 (R1-D-84): the bureau fake and the CIBIL stub report an EMI on one tradeline and none on another, with a contract case for both; the ESTAMP fake keeps each signer's evidence and takes a not-stampable registration; the NeSL DDE stub records signing evidence (`execute(ddeId, ref, evidence?)`) and non-stampable registrations; `estampDdeContractCases` gains the signer-trail and not-stampable cases.
- c8b8f88: `FakeDisbursementRail` (a fake sponsor bank with a `respond()` response-file hook and statement lines) with `disbursementRailContractCases(fixtures)` and `DISBURSEMENT_RAIL_FAKE_FIXTURES`, and `FakeSettlements` with `settlementLineContractCases()`: replayed, repeated and reused idempotency keys, a missing approval, an agent principal, non-integer paise, return codes classed re-presentable or final, statement lines and settlements within the range (PR-FBX-34 (1), (2); R1-D-80).
- c8b8f88: `FakeCompanyData` with a fictional register (`FAKE_COMPANY_REGISTER`, `COMPANY_DATA_FAKE_FIXTURES`: a private company, a listed company and an LLP) and `companyDataContractCases(fixtures)`: malformed identifiers refused before the source, unknown CIN, master data, directors and charges in integer paise, and the register date on every result (PR-LDC-02; R1-D-79).
- c8b8f88: IDENTITY contract cases for identity-provider brokers, `identityBrokerContractCases(fixtures)` (create and update in place without a secret in any answer; a literal secret, a plain string for the reference, a bad alias or URL refused; another tenant can neither take over nor remove a broker; discovery by verified domain to enabled brokers only, one broker per domain; linking only: an unknown user signing in through a broker is refused and an existing account of the broker's tenant is linked, through the `brokerSignIn` fixture; a session of another tenant's account through the broker refused, where the leg provides `brokeredSession`; SAML when the leg serves metadata; removal frees the domain), and `FakeIdentityBrokers` with `FAKE_BROKER_SIGN_IN`, a fake that passes them (PR-LDC-09; R1-D-78).
- c8b8f88: IDENTITY contract cases for the refresh-token grant, `identityRefreshContractCases(fixtures, { pauseMs })` (rotation; a reused token is `refresh_reused` and revokes the session, its successor and access tokens then fail; an unknown token is `refresh_invalid`; no token in any error), and `FakeIdentitySessions`, a fake that passes them (PR-LDC-03; R1-D-77).

### Patch Changes

- c8b8f88: The BUREAU and COMPANY_DATA contract cases match a PAN only as a whole word, so a PAN-shaped run inside a random ULID (a consent id) no longer fails the "known subject" case at random.
- Updated dependencies [c8b8f88]
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
  - @infrabyx/audit@1.7.0
  - @infrabyx/config@1.10.0
  - @infrabyx/seed@1.0.27
  - @infrabyx/crypto@1.5.4

## 1.9.0

### Minor Changes

- 9c368c7: RULES contract cases for the CEL string functions and a refused `matches` pattern, with `RULES_STRING_FIXTURE` and `stringFixtureInput` (PR-LDC-13; R1-D-71).
- 9c368c7: `FakeConsentLedger.latestByPrincipal` and `recordPurposeConsent` (tenant-scoped by `call.tenantId`), and a CONSENT contract case for `latestByPrincipal` (PR-LDC-14; R1-D-72).

### Patch Changes

- Updated dependencies [9c368c7]
- Updated dependencies [9c368c7]
- Updated dependencies [9c368c7]
- Updated dependencies [9c368c7]
  - @infrabyx/tenancy@1.11.0
  - @infrabyx/contracts@1.18.0
  - @infrabyx/audit@1.6.5
  - @infrabyx/seed@1.0.26
  - @infrabyx/config@1.9.2
  - @infrabyx/crypto@1.5.3

## 1.8.1

### Patch Changes

- Updated dependencies [714ad01]
  - @infrabyx/contracts@1.17.0
  - @infrabyx/audit@1.6.4
  - @infrabyx/config@1.9.1
  - @infrabyx/crypto@1.5.2
  - @infrabyx/seed@1.0.25
  - @infrabyx/tenancy@1.10.1

## 1.8.0

### Minor Changes

- b3edda2: `MemoryMandateApprovals`: an in-memory mandate approval verifier with the engine's refusals, for adapter tests (`acceptAny` only for the shared contract cases).

### Patch Changes

- Updated dependencies [b3edda2]
- Updated dependencies [b3edda2]
- Updated dependencies [b3edda2]
- Updated dependencies [b3edda2]
- Updated dependencies [b3edda2]
  - @infrabyx/config@1.9.0
  - @infrabyx/tenancy@1.10.0
  - @infrabyx/contracts@1.16.0
  - @infrabyx/audit@1.6.3
  - @infrabyx/seed@1.0.24
  - @infrabyx/crypto@1.5.1

## 1.7.0

### Minor Changes

- fdd1f1a: `startCibilStub` and `startSetuAaStub`: stub-shaped TransUnion CIBIL and Setu FIU servers for the `cibil` and `setu-aa` adapters' hermetic contract legs (owner answer #97; R1-D-61).
- ed143e3: Stubs and contract cases for the Digio mandate adapter and NeSL DDE (owner answer #100; R1-D-62): `startDigioMandateStub`, `startNeslDdeStub`, `estampDdeContractCases` and `ESTAMP_DDE_FAKE_FIXTURES`.

### Patch Changes

- Updated dependencies [fdd1f1a]
- Updated dependencies [ed143e3]
  - @infrabyx/config@1.8.0
  - @infrabyx/audit@1.6.2
  - @infrabyx/seed@1.0.23
  - @infrabyx/tenancy@1.9.2

## 1.6.0

### Minor Changes

- 2a95100: The DEVICE_ATTESTATION reference adapter `native` (Udofin PR-UDF-028; owner answer #99; R1-D-59). Exported from `@infrabyx/connectors/device-attestation`:

  - **Play Integrity:** `decodeIntegrityToken` with a C-24 token, the binding, package, signing certificate, licence, device level and age checked, and each token used once.
  - **App Attest:** verified locally with C-27; a key registers once.

  Both halves are off behind `int.device_attestation.play_integrity.enabled` and `int.device_attestation.app_attest.enabled` (`config`). `testing`: `startPlayIntegrityStub`, `nativeDeviceEvidence`, and `DeviceEvidence`, the minter the contract cases now take, so they run on `native` and on the fake. Exit map and port matrix: `DEVICE_ATTESTATION`.

### Patch Changes

- Updated dependencies [2a95100]
- Updated dependencies [2a95100]
  - @infrabyx/config@1.7.0
  - @infrabyx/crypto@1.5.0
  - @infrabyx/audit@1.6.1
  - @infrabyx/seed@1.0.22
  - @infrabyx/tenancy@1.9.1

## 1.5.1

### Patch Changes

- Updated dependencies [bdcdbe4]
  - @infrabyx/audit@1.6.0
  - @infrabyx/seed@1.0.21

## 1.5.0

### Minor Changes

- 1b99d7a: The CAPTCHA and DEVICE_ATTESTATION ports (Udofin PR-UDF-029 and PR-UDF-028; ADR-0004; R1-D-50). `contracts`: `CaptchaPort` (`verify` returns a verdict: `invalid`, `expired`, `duplicate`, `action_mismatch`, `hostname_mismatch`) and `DeviceAttestationPort` (Play Integrity, App Attest registration and assertions, bound to a nonce or the DPoP key), both catalogued in `R1_PORTS`. `connectors` (`@infrabyx/connectors/captcha`): `TurnstileCaptcha` (reference) and `HCaptchaCaptcha` (alternative), which send only the token and the secret, and `CaptchaGate`, which asks for a token only while `int.captcha.under_attack` is on and then fails closed with 429 IPB-SEC-019. `config`: `int.captcha.under_attack`, `int.captcha.turnstile.enabled`, `int.captcha.hcaptcha.enabled` (both adapters off by default). `testing`: `FakeCaptcha`, `startCaptchaStub`, `captchaContractCases`, `FakeDeviceAttestation`, `deviceAttestationContractCases`. The device-attestation vendor adapters wait for the owner (OWNER-QUESTIONS #99).
- c4117e4: The `ESTAMP`, `PAYOUTS`, `DOCGEN` and `PDF` port interfaces and the PAYMENTS mandate lifecycle (Finbyx PR-FBX-29; IPB-01; R1-D-52), interfaces, fakes and contract cases only. `EstampPort` (`covers`, `quoteDuty`, `purchase`, `attach`, `verify`, `handleWebhook`) with NeSL Digital Document Execution as optional methods (`ddeRegister`, `ddeStatus`, `ddeDownloadExecuted`); `PayoutsPort` (`createBeneficiary`, `validateAccount` with the holder's name, `payout`, `getStatus` with the UTR and value date, `handleWebhook`, `balance`; "accepted" is never final); `DocgenPort` (`render`, `renderBatch`, `renderHtml` to PDF or PDF/A, `previewHtml`, `listTemplates`, `validateTemplate`) and `PdfPort` (IPB-01's operations over STORAGE references); `MandateLifecycle` (`registerMandate` for eNACH, UPI AutoPay and physical NACH with the UMRN, `mandateStatus`, `cancelMandate`), optional on `PaymentsPort`. Every money-moving call carries an idempotency key, an amount in integer paise and a `MoneyAuthorisation` (an approved request and a user or service initiator); `assertMoneyCall` refuses an agent (`IPB-SEC-004`) and a missing approval or key (`IPB-UX-004`). `SignatureRecord` gains the optional `espTransactionId` and `signerIp`. `@infrabyx/testing`: `FakeEstamp`, `FakePayouts`, `FakeMandates`, `FakeDocgen`, `FakePdf`, `FakeEsign` and their contract cases. No vendor adapter: payout and mandate adapters wait for the owner (money movement).
- 1e721cd: `startIdfyKycStub`: a hermetic stub of IDfy's task API (PAN, face compare, photo liveness) in its stub-shaped form, for the `idfy-kyc` contract leg (R1-D-45).
- 854e309: The `livekit` VIDEO_MEET reference adapter (`@infrabyx/connectors/video-meet`; owner answer #88, R1-D-53): a self-hosted LiveKit server called over its HTTP server API with C-26 tokens, the room's policy (India only, no anonymised origin, the official from the official network) enforced before a token is issued, webhooks verified and read back, and recordings moved from the egress disk to the room's STORAGE target with one locked single-part write each before the disk copy is removed. Off behind `int.video_meet.livekit.enabled` (`config`); the egress path is `unproven` until a deployment runs the egress worker. `testing`: the `livekit` test image and `videoMeetContractCases({ signWebhook })`. Compose: the `video` profile.

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
  - @infrabyx/audit@1.5.1
  - @infrabyx/seed@1.0.20

## 1.4.0

### Minor Changes

- 97e8524: The `BUREAU` and `AA_FIU` product ports of IPB-01 §01.4.4.3 (owned by FBX v1.6), with fakes and contract cases (Finbyx PR-FBX-28; R1-D-43; ADR-0003). `contracts`: `CreditBureauPort` (`pull` with a soft or hard enquiry to CIBIL, Experian, Equifax or CRIF, refused without the product's consent receipt; the raw report by STORAGE reference with its SHA-256, the CIC's format version and a normalised summary in integer paise; `status`; `handleWebhook` reads the pull back) and `AccountAggregatorPort`, the FIU side (`requestConsent` with the ReBIT template, `consentStatus`, `revoke` in full or by FI type, `fetch` only under an ACTIVE consent within its range and FI types, each payload by STORAGE reference with its ReBIT schema version and SHA-256, `handleWebhook`); both catalogued (tier 2, owner FBX v1.6, `int.bureau.`, `int.aa_fiu.`) and in `R1_PORTS`. `testing`: `FakeCreditBureau`, `FakeAccountAggregator`, `creditBureauContractCases` and `accountAggregatorContractCases`. Vendor adapters wait for the owner's sandbox documents and accounts.
- 4a87754: Per-object retention that is only ever extended (Finbyx PR-FBX-27; IPB-01-29; R1-D-42). `StoragePort.extendRetention(key, retainUntil)` (S3 `PutObjectRetention` in COMPLIANCE mode; an earlier or equal date, or an object without retention, is refused with `IPB-STOR-003`) and `retentionOf(key)`, on the `s3` and `minio` adapters and `MemoryStorage`, with a shared contract case. `assertImmutable` now also checks the stored SHA-256 checksum against the hash recorded at write, from a HEAD with checksum mode, so no decrypt permission is needed. `putWithRetention` stays one single-part write with the lock mode, the date and a SHA-256 checksum.

### Patch Changes

- Updated dependencies [92706c4]
- Updated dependencies [97e8524]
- Updated dependencies [e41c3bd]
- Updated dependencies [92706c4]
- Updated dependencies [92706c4]
- Updated dependencies [4a87754]
- Updated dependencies [d66ffad]
  - @infrabyx/audit@1.5.0
  - @infrabyx/contracts@1.14.0
  - @infrabyx/tenancy@1.8.0
  - @infrabyx/seed@1.0.19
  - @infrabyx/config@1.5.2
  - @infrabyx/crypto@1.3.1

## 1.3.7

### Patch Changes

- Updated dependencies [32b53ee]
- Updated dependencies [cff2a02]
  - @infrabyx/crypto@1.3.0
  - @infrabyx/contracts@1.13.0
  - @infrabyx/audit@1.4.4
  - @infrabyx/config@1.5.1
  - @infrabyx/seed@1.0.18
  - @infrabyx/tenancy@1.7.2

## 1.3.6

### Patch Changes

- 209c3ee: The IDENTITY test image moves to Keycloak's 26.8.1-1 rebuild (`keycloak/keycloak@sha256:a78d6b79…`, pinned once 7 days old under PL2-D-32; R1-D-35), the same digest as the customer one-time-code image and the Compose IdP. It clears one base-image finding (CVE-2026-114406), whose waiver is removed; three stay waived until a Keycloak or UBI release carries their fixes.

## 1.3.5

### Patch Changes

- Updated dependencies [63c5ad2]
- Updated dependencies [63c5ad2]
  - @infrabyx/config@1.5.0
  - @infrabyx/contracts@1.12.0
  - @infrabyx/audit@1.4.3
  - @infrabyx/seed@1.0.17
  - @infrabyx/tenancy@1.7.1
  - @infrabyx/crypto@1.2.7

## 1.3.4

### Patch Changes

- 3b74776: `startPostgres` migrates each fresh database under a server-wide advisory lock (`infrabyx:test-migrate`), so parallel test databases on one server never interleave their migrations. Roles are cluster-wide, and `tenancy/0003` grants `app_ro` a role that `0004` revokes: a test checking role grants could otherwise see another database's half-applied migration (R1-D-31).
- Updated dependencies [2e3a2d3]
- Updated dependencies [2e3a2d3]
- Updated dependencies [3f20011]
- Updated dependencies [3f20011]
- Updated dependencies [3f20011]
  - @infrabyx/contracts@1.11.0
  - @infrabyx/tenancy@1.7.0
  - @infrabyx/audit@1.4.2
  - @infrabyx/config@1.4.1
  - @infrabyx/crypto@1.2.6
  - @infrabyx/seed@1.0.16

## 1.3.3

### Patch Changes

- Updated dependencies [138ae44]
- Updated dependencies [138ae44]
- Updated dependencies [138ae44]
  - @infrabyx/config@1.4.0
  - @infrabyx/contracts@1.10.0
  - @infrabyx/tenancy@1.6.0
  - @infrabyx/audit@1.4.1
  - @infrabyx/seed@1.0.15
  - @infrabyx/crypto@1.2.5

## 1.3.2

### Patch Changes

- Updated dependencies [2b307e0]
- Updated dependencies [2b307e0]
- Updated dependencies [2b307e0]
  - @infrabyx/audit@1.4.0
  - @infrabyx/contracts@1.9.0
  - @infrabyx/tenancy@1.5.0
  - @infrabyx/seed@1.0.14
  - @infrabyx/config@1.3.2
  - @infrabyx/crypto@1.2.4

## 1.3.1

### Patch Changes

- Updated dependencies [cd25633]
- Updated dependencies [cd25633]
- Updated dependencies [cd25633]
  - @infrabyx/audit@1.3.0
  - @infrabyx/contracts@1.8.0
  - @infrabyx/tenancy@1.4.0
  - @infrabyx/seed@1.0.13
  - @infrabyx/config@1.3.1
  - @infrabyx/crypto@1.2.3

## 1.3.0

### Minor Changes

- 94b706e: `startDigioKycStub()` for the Digio KYC adapter's hermetic leg. The KYC contract cases now name a minimal call for each method, so an adapter that declares a method `unsupported` is checked to refuse it with the typed error (R1-D-24).

### Patch Changes

- Updated dependencies [94b706e]
  - @infrabyx/config@1.3.0
  - @infrabyx/audit@1.2.7
  - @infrabyx/seed@1.0.12
  - @infrabyx/tenancy@1.3.5

## 1.2.1

### Patch Changes

- Updated dependencies [f5622c9]
- Updated dependencies [f5622c9]
  - @infrabyx/config@1.2.0
  - @infrabyx/contracts@1.7.0
  - @infrabyx/audit@1.2.6
  - @infrabyx/seed@1.0.11
  - @infrabyx/tenancy@1.3.4
  - @infrabyx/crypto@1.2.2

## 1.2.0

### Minor Changes

- ceabe3b: `FakeKyc` and `FakeVideoMeet`, with `kycContractCases(fixtures)` and `videoMeetContractCases()`, the contract every KYC and VIDEO_MEET adapter will pass (PR-FBX-01, R1-D-21).

### Patch Changes

- Updated dependencies [ceabe3b]
  - @infrabyx/contracts@1.6.0
  - @infrabyx/audit@1.2.5
  - @infrabyx/config@1.1.1
  - @infrabyx/crypto@1.2.1
  - @infrabyx/seed@1.0.10
  - @infrabyx/tenancy@1.3.3

## 1.1.0

### Minor Changes

- 849b8f9: `startService` can build its image from a Dockerfile in the repository (`build: { context }`), for test images that extend a pinned one (Keycloak with the customer extension).

### Patch Changes

- Updated dependencies [849b8f9]
- Updated dependencies [849b8f9]
- Updated dependencies [849b8f9]
  - @infrabyx/config@1.1.0
  - @infrabyx/contracts@1.5.0
  - @infrabyx/crypto@1.2.0
  - @infrabyx/audit@1.2.4
  - @infrabyx/seed@1.0.9
  - @infrabyx/tenancy@1.3.2

## 1.0.8

### Patch Changes

- Updated dependencies [7e38652]
- Updated dependencies [7e38652]
  - @infrabyx/contracts@1.4.0
  - @infrabyx/crypto@1.1.0
  - @infrabyx/audit@1.2.3
  - @infrabyx/config@1.0.6
  - @infrabyx/seed@1.0.8
  - @infrabyx/tenancy@1.3.1

## 1.0.7

### Patch Changes

- Updated dependencies [b6058d3]
- Updated dependencies [b6058d3]
  - @infrabyx/contracts@1.3.0
  - @infrabyx/tenancy@1.3.0
  - @infrabyx/audit@1.2.2
  - @infrabyx/config@1.0.5
  - @infrabyx/crypto@1.0.3
  - @infrabyx/seed@1.0.7

## 1.0.6

### Patch Changes

- Updated dependencies [1c869a8]
- Updated dependencies [1c869a8]
  - @infrabyx/config@1.0.4
  - @infrabyx/seed@1.0.6
  - @infrabyx/audit@1.2.1
  - @infrabyx/tenancy@1.2.1

## 1.0.5

### Patch Changes

- Updated dependencies [75e9ea4]
- Updated dependencies [75e9ea4]
- Updated dependencies [75e9ea4]
  - @infrabyx/audit@1.2.0
  - @infrabyx/contracts@1.2.0
  - @infrabyx/tenancy@1.2.0
  - @infrabyx/seed@1.0.5
  - @infrabyx/config@1.0.3
  - @infrabyx/crypto@1.0.2

## 1.0.4

### Patch Changes

- c0ce8ff: `startPostgres` resolves platform packages from the current directory (the caller's package) and then from `@infrabyx/testing`, names any package whose migrations it skipped, and refuses with `requirePlatform: true` (PR-FBX-06).
- Updated dependencies [c0ce8ff]
- Updated dependencies [2724cd6]
  - @infrabyx/tenancy@1.1.3
  - @infrabyx/audit@1.1.1
  - @infrabyx/seed@1.0.4

## 1.0.3

### Patch Changes

- 8a2587e: The `infrabyx-*` CLI entry points run when started through a `node_modules` symlink (`pnpm exec`, npm `.bin`, `node node_modules/@infrabyx/testing/…`); before, they exited 0 without running (PR-UDF-005).
- Updated dependencies [8a2587e]
- Updated dependencies [8a2587e]
- Updated dependencies [8a2587e]
  - @infrabyx/config@1.0.2
  - @infrabyx/seed@1.0.3
  - @infrabyx/tenancy@1.1.2
  - @infrabyx/audit@1.1.1

## 1.0.2

### Patch Changes

- Updated dependencies [53a973c]
  - @infrabyx/tenancy@1.1.1
  - @infrabyx/audit@1.1.0
  - @infrabyx/seed@1.0.2

## 1.0.1

### Patch Changes

- Updated dependencies [588b509]
- Updated dependencies [588b509]
- Updated dependencies [588b509]
  - @infrabyx/audit@1.1.0
  - @infrabyx/contracts@1.1.0
  - @infrabyx/tenancy@1.1.0
  - @infrabyx/seed@1.0.1
  - @infrabyx/config@1.0.1
  - @infrabyx/crypto@1.0.1

## 1.0.0

### Major Changes

- 9ec9a2c: 1.0.0, the platform baseline release (IPB-14 §14.5 item 1; owner answer #67(4), PL6-D-16). Every `@infrabyx/*` package moves to 1.0.0 together; the public API is unchanged from the 0.x set of the PL6 gate (`docs/phases/PL6-gate.md` §6), so a product upgrades by moving every dependency to 1.0.0 at once. From 1.0.0 on, semantic versioning holds: a breaking change to an export, a migration or a setting is a major release with an ADR (IPB-09-34/35).

### Patch Changes

- Updated dependencies [9ec9a2c]
  - @infrabyx/audit@1.0.0
  - @infrabyx/config@1.0.0
  - @infrabyx/contracts@1.0.0
  - @infrabyx/crypto@1.0.0
  - @infrabyx/seed@1.0.0
  - @infrabyx/tenancy@1.0.0

## 0.5.1

### Patch Changes

- Updated dependencies [9d8cd8c]
- Updated dependencies [b3934f9]
  - @infrabyx/tenancy@0.6.0
  - @infrabyx/config@0.5.1
  - @infrabyx/audit@0.1.5
  - @infrabyx/seed@0.3.1

## 0.5.0

### Minor Changes

- 1fecf45: Owner answer #53 (PL5-D-11): `mediaContractCases()` for the MEDIA port, the `testPng` and `oversizedPngHeader` fixtures, and the `FakeMedia` fixture. The `vendor-import` lint treats `sharp` as a vendor SDK (connectors only).
- 934355c: Fakes and fixtures for the PL5 website ports (PL5-D-02): `FakeConsentLedger`, `FakeCrm`, `FakeHr`, `FakeOhDesk` (SUPPORT and BACKLOG with a status loop), `FakeTrustFeed` with `fixtureTrustDocuments` (no certification claimed), `FakeCatalogue` with `fixtureCatalogue` (placeholder amounts, no real prices), `NoneTagManager`, `NoneAnalytics`, `FakeEgress`, `FakeClaimsGate` and `FakeLawRegister`.

### Patch Changes

- 1e2fe19: PL5 gate: `infrabyx-at-report` reads `.tsx` and `.e2e.test.*` files, three-digit AT ids (`@IPB-04-AT-101`) and skips `.next` build output; the repository's `at:report` now scans the whole repository, apps included.
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
- Updated dependencies [b7de3c6]
- Updated dependencies [e8e83cb]
- Updated dependencies [275d4ba]
  - @infrabyx/config@0.5.0
  - @infrabyx/contracts@0.5.0
  - @infrabyx/tenancy@0.5.0
  - @infrabyx/seed@0.3.0
  - @infrabyx/audit@0.1.4
  - @infrabyx/crypto@0.4.1

## 0.4.0

### Minor Changes

- c0b6d38: Synthetic AI guardrail corpora (PL4 session 4): `piiGoldenCorpus()` (PAN, Aadhaar including the masked form, mobile, e-mail, UPI, bank account with IFSC, card, voter ID, passport, driving licence, GSTIN, date of birth, JWT, PEM and API keys; check digits computed at run time, nothing real committed), `PII_NEGATIVE_CORPUS`, `INJECTION_CORPUS` (English, Hindi and Hinglish) and `BENIGN_INPUT_CORPUS`, with `syntheticAadhaar`, `syntheticCard` and `syntheticGstin`.
- 200b25a: `FakeLlm` (scripted, records every request), `FakeEmbedding` (deterministic vectors) and `providerError` for AI tests. No test calls a paid provider (PL4-D-03).

  `startPostgres().end()` tolerates the server's expected "terminating connection due to administrator command" (57P01) from `drop database … with (force)` on a client that is still closing. This removes an intermittent unhandled error after the tests have passed. Any other error still surfaces.

  Bedrock Runtime, Vertex AI and vLLM stubs (`startBedrockStub`, `startVertexStub`, `startVllmStub`) and the LLM and EMBEDDING contract cases (`llmContractCases`, `embeddingContractCases`).

- bfa324d: Imagen (`:predict` on `imagen*` models of the Vertex stub) and FLUX (`startFluxStub`) stubs, `stubPng`, `imageGenContractCases`, and the fakes `FakeImageGen`, `FakeSpeech` and `FakeRerank` (PL4 session 5).
- c0b6d38: `startPostgres` falls back to `pgvector/pgvector:0.8.1-pg18` (pinned by digest, `TEST_IMAGES.pgvector`, `PG_TEST_IMAGE`) so AI retrieval migrations run; CI's integration job uses the same image. Point `IPB_TEST_PG_URL` at a PostgreSQL 18 server with the `vector` extension available.

### Patch Changes

- 200b25a: `ipb/port-data-class` knows the IMAGE_GEN default class (INTERNAL), mirroring `PORT_DEFAULT_DATA_CLASS` (PL4-D-02).
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
  - @infrabyx/audit@0.1.3
  - @infrabyx/seed@0.2.2

## 0.3.0

### Minor Changes

- 50093e9: Leegality and Digio stubs (`startLeegalityStub`, `startDigioStub`) and `MemoryEsignEnvelopeStore`
  for the ESIGN contract legs.
- 1ed0659: Expo push and FCM HTTP v1 stubs (the FCM stub checks the RS256 service-account assertion at its
  token endpoint with a throwaway key) and `MemoryPushTokenStore`.
- 53697f5: RULES engine contract cases (`RULE_ENGINE_CASES`, `RULES_FIXTURE`, `fixtureInput`) for
  `defineContractSuite("RULES", …)`.

### Patch Changes

- 2725b6c: `ipb/port-data-class`: PUSH payloads default to INTERNAL, mirroring `@infrabyx/contracts`.
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
  - @infrabyx/audit@0.1.2
  - @infrabyx/seed@0.2.1

## 0.2.0

### Minor Changes

- 13c7379: Vendor stubs for the messaging hermetic legs (PL2-D-64): a recording stub server with failure injection, stubs for SES v2, Brevo, MSG91, Gupshup Enterprise SMS, Gupshup WhatsApp and the Meta Graph API, and `createSnsSigner()` for SignatureVersion 2 test messages (throwaway certificate per run).
- 0c4535d: Razorpay and Cashfree PG stubs for the PAYMENTS hermetic legs (test mode only; random per-run credentials; Cashfree idempotency replay and conflicts).
- a4b9082: PL2 session 1: contract suites take a leg and honour adapter capabilities (unsupported methods
  must throw IPB-PORT-001); pinned test images with `startService`; the sandbox-leg gate
  (`IPB_TEST_SANDBOX_*`, required on nightly runs); a fault-injection proxy for failover tests; and
  the ESLint rule `ipb/port-data-class` (PL2-D-03).
- 2969424: Test images `keycloak` (26.8.1) and `zitadel` (v4.19.5, GHCR, CI only); `startNetwork()` for
  services that talk to each other; `startService({ readyHttp })` probes readiness over HTTP from the
  host for images without a shell.
- 2f29ec8: `existingServiceUrl(name)` for services that CI starts itself (the MinIO server, built from
  source in CI, PL2-D-61).
- 9ac878e: `TEST_IMAGES` adds OpenBao 2.7.1 (KV v2, Transit and database engines) for the SECRETS and KMS
  hermetic legs.
- 2969424: `TEST_IMAGES` adds OpenFGA v1.22.0 for the AUTHZ hermetic leg.
- 858a76a: `TEST_IMAGES` adds the OTel Collector (contrib 0.162.0) and Unleash 8.2.0; `startService` takes
  `files` (configuration copied in before start) and `configure` (bind mounts, networks).

### Patch Changes

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
- Updated dependencies [5482043]
  - @infrabyx/crypto@0.2.0
  - @infrabyx/config@0.2.0
  - @infrabyx/contracts@0.2.0
  - @infrabyx/tenancy@0.2.0
  - @infrabyx/seed@0.2.0
  - @infrabyx/audit@0.1.1

## 0.1.0

### Minor Changes

- 907cfae: PL1 test kit: `startPostgres` (IPB_TEST_PG_URL or Testcontainers postgres:18) with every platform migration, context builders, SECRETS/KMS/STORAGE/FEATURE_FLAG/IDENTITY fakes, the NN pattern suites (@NN-01, @NN-02/45, @NN-18, locked actions, seed refusal), the port contract harness, `infrabyx-migration-lint` over the real PostgreSQL parser with every IPB-09 §09.4.6 rule and checksum manifests, `infrabyx-at-report`, and the IPB ESLint plugin as `@infrabyx/testing/eslint`.

  Audience: developer · Reg: none · Notice class: standard

### Patch Changes

- c2cf60a: PL0 toolchain baseline: pnpm 9 lockfile, Turborepo pipeline, ESLint 10 flat config with the IPB
  rules `ipb/vendor-import`, `ipb/schema-boundary` and `ipb/no-process-env` (placeholders),
  Vitest, Prettier, Renovate per IPB-01 §01.4.1.2, SHA-pinned CI and release workflows, and the
  `ipb:check` structural checks. Released with the seven PL1 packages at 0.1.0 (PL1-D-02 / D-06); the fifteen later-phase packages stay unpublished scaffolds until their own phase.

  Audience: internal · Reg: none · Notice class: standard

- Updated dependencies [c2cf60a]
- Updated dependencies [7dc104c]
- Updated dependencies [542194d]
- Updated dependencies [a17086c]
- Updated dependencies [8f44a2c]
- Updated dependencies [c61454d]
- Updated dependencies [245318b]
  - @infrabyx/audit@0.1.0
  - @infrabyx/config@0.1.0
  - @infrabyx/contracts@0.1.0
  - @infrabyx/crypto@0.1.0
  - @infrabyx/seed@0.1.0
  - @infrabyx/tenancy@0.1.0
