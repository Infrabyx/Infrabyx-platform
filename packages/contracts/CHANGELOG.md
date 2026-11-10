# @infrabyx/contracts

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
