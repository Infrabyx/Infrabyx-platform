# @infrabyx/testing

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
