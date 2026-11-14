# Adoption note — LawDocsComply (3 November 2026 release)

LawDocsComply has raised no platform request yet. Its repository is at Phase 0: tooling only, with no `@infrabyx/*` dependency installed. So it has nothing to bump and no shim to retire. This note says what to install first and which platform answers to use rather than rebuild.

## 1. First install

- Scaffold from this repository at the release commit (product guide §1), or add the packages by hand at the versions of the release that follows version PR "chore: version packages" of 3 November 2026 (STATUS, "Releases after 1.0.0"): `contracts` 1.15.0, `tenancy` 1.9.0, `connectors` 1.5.0, `crypto` 1.4.0, `config` 1.6.0, `audit` 1.5.1, `seed` 1.0.20, and `testing` 1.5.0 as a dev dependency. Then add each package you use at the same release.
- Run `infrabyx-migrate --require-all` from the package that depends on every platform package with migrations, then `infrabyx-rls-lint`.
- Call the platform CLIs by name (guide §2).

## 2. Use these rather than build them

- **Tooling.** Use `@infrabyx/testing/eslint` for the IPB lint rules instead of a copy. Generate each `.env.example` with `infrabyx-env example --product LDC` once your settings are registered in `@infrabyx/config`. Keep `pin-check`, `licence-check` and `pr-checklist` until the platform publishes them (Udofin PR-UDF-001); then retire them.
- **Public forms.** Use `TurnstileCaptcha` behind `CaptchaGate` (§7q).
- **DPDP consent to your own purposes.** Use `PurposeConsents` (§7j), not a ledger of your own.
- **Named functions such as a compliance officer.** Use `TenantFunctions` with `OFFICER_POLICY` (§7k).
- **Batches, idempotent APIs and timers.** Use `tx.unit` and `recordBatch` (§7n), `kernel.ambient` with `idempotent()` (§7g), and `WorkflowTimers` product kinds (§7c).

## 3. Raising requests

Record anything missing in your `docs/platform-requests.md`, with the shim you use meanwhile, as Finbyx and Udofin do. The platform works only on raised requests and security updates (maintenance mode).

## 4. Wave 1 (version PR #208, release run 184: `tenancy` 1.10.0, `connectors` 1.8.0, `contracts` 1.16.0, `config` 1.9.0, `testing` 1.8.0)

What LawDocsComply removes once the wave 1 release is published (R1-plan M37, M38; R1-D-67, R1-D-68). Move every `@infrabyx/*` dependency to that release together and run `infrabyx-migrate --require-all` (wave 1 adds no migration).

1. **PR-LDC-12, tenant creation (guide §7y).** Replace the tests' direct `insert into tenancy.tenant` rows and the local provisioning gap with `TenantBootstrap.bootstrap(platformCtx, { tenantId, product: "LDC", name, settings?, onCreated? })`. Pass `SettingsService` for initial tenant settings, and write your own first rows in `onCreated`. It is refused in `prod`, `dr` and `pre-prod`. **Shim removed:** the direct tenant inserts in tests and Compose.
2. **PR-LDC-11, the Operations Hub adapter (guide §7z).** Replace your inbox `TenantProvisioned` consumer and `TrialService.provisionIn` with `OperationsHubProvisioning` from `@infrabyx/connectors/provisioning`. Call `receive(event, jws)` from the webhook route and `drain()` from the worker. Move what `provisionIn` wrote into `onProvisioned(tx, tenant)`. Keep reporting `READY` by `PUT /v1/provisioning-requests/{id}`. **Shim removed:** the inbox consumer and `provisionIn`. **Kept:** your outbox `ProvisioningRequested`, until PR-040 (Ecosystem Spec v1.3) is signed off (OWNER-QUESTIONS #105). The platform then adds the request half and `ProvisioningFailed`.
3. **Mark met** PR-LDC-11 (the consumer half) and PR-LDC-12 in your `docs/platform-requests.md`. PR-LDC-01 is answered with no change: KYC and KYB go through `digio-kyc` and `idfy-kyc`, and DigiLocker through `digio-kyc`. PR-LDC-04 and PR-LDC-06 are planned for wave 4 and after it (M48, M49). PR-LDC-08 (a) and (b) are planned as tenant-consented support access (M50).

## 5. Wave 2 (version PR #209, release run 186: `contracts` 1.17.0, `notify` 1.2.0, patches of the rest)

What LawDocsComply removes once it moves to the wave 2 release (R1-plan M39; R1-D-69). Move every `@infrabyx/*` dependency to the run 186 versions together and run `infrabyx-migrate --require-all` (`notify/0003`).

1. **PR-LDC-15, delivery reports by vendor reference (guide §7aa).** In each vendor webhook controller, verify the event as now, then call `routeEmailEvents(adapter, events)`, `routeSmsReports(adapter, reports)` or `routeWhatsappEvents(adapter, events)`. The dispatcher's service reader finds each report's tenant (ledgered) and applies it there. Log the returned `{ routed, unknown, ambiguous }` counts. **Shim removed:** the webhook controller's platform-wide suppression-only handling, so deliveries now move past `sent` to delivered, bounced or read.
2. **Per-tenant templates.** Optional for LawDocsComply: pass `templates` to `NotifyService` only if a tenant needs its own DLT or WhatsApp template.
3. **Mark met** PR-LDC-15 in your `docs/platform-requests.md`.

## 6. Wave 3 (version PR #212, release run 188: `contracts` 1.18.0, `connectors` 1.9.0, `consent` 1.2.0, `tenancy` 1.11.0, `testing` 1.9.0, patches of the rest)

What LawDocsComply removes once it moves to the wave 3 release (R1-D-70 to R1-D-73). Move every `@infrabyx/*` dependency to the run 188 versions together and run `infrabyx-migrate --require-all` (`consent/0004`).

1. **PR-LDC-11, the request half and the failure path (Ecosystem Spec v1.3; guide §7z).** Give `OperationsHubProvisioning` your outbox, your ecosystem signing key and `onFailed`; call `request(tx, …)` in your sign-up's transaction and `signForDelivery(event)` in the relay. Purge a provisional tenant and its first-admin contact data by `purgeBy` (30 days after `failed_at`), ledgered, unless a retry is open. **Shim removed:** your own outbox `ProvisioningRequested` and your ad hoc handling of a refused request. Mark PR-LDC-11 met.
2. **PR-LDC-13, CEL string functions (guide §7ab).** Move the `classification.ts` rows into a `@infrabyx/rules` rule set with `startsWith`, `endsWith`, `contains` and `matches` on the raw string inputs, published through `RulesService` (maker-checker) with its explain trace. **Shim removed:** the `classificationInput` booleans worked out in code and the version history in `classification.ts`.
3. **PR-LDC-14, platform purpose notices and `latestByPrincipal` (guide §7ac).** Register the account purposes with `tier: "platform"`; the platform's PLT_DPO drafts and PLT_LEGAL_REVIEWER approves their notices; record with `grant(ctx, { subjectRef: "per_…", purpose, noticeId, method })` and read with `latestByPrincipal("per_…", { tenantId })`. **Shim removed:** account consents recorded as Ecosystem purposes on `PgConsentLedger` with `cid = per_…` (P1F-03).
4. **PR-LDC-16, field encryption over the KMS port (guide §7ad).** Create the tenant's key in `onCreated` or `onProvisioned` with `kms.createTenantKey(tenantId)` and seal each mobile with `fieldCryptoForTenant(kms, tenantId).encryptField(tenantId, "CONFIDENTIAL", mobile, at)`, keeping the blind token for search. **Shim removed:** mobiles stored masked with a blind token only (P1F-02).
5. **Mark met** PR-LDC-11, 13, 14 and 16 in your `docs/platform-requests.md`.

## 7. Wave 4 (version PR #214: `contracts` 1.19.0, `tenancy` 1.12.0, `connectors` 1.10.0, `testing` 1.10.0, `config` 1.10.0, `audit` 1.7.0, patches of the rest)

What LawDocsComply removes once it moves to the wave 4 release (R1-D-75 to R1-D-83). Move every `@infrabyx/*` dependency to that release together and run `infrabyx-migrate --require-all` (`tenancy/0016`, `tenancy/0017`, `config/0003`), then `infrabyx-rls-lint`.

1. **PR-LDC-07, PR-LDC-08 (c), grantee kinds and a scoped break-glass (guide §7af).** Request external grants with the new kinds (`nhb`, `nabard`, `ifsca`, `roc_inspector`, `rcs_inspector`, `crcs_inspector`, `secretarial_auditor`, `tax_auditor`, `concurrent_auditor`, `cooperative_auditor`), request break-glass with `{ tenantId, modules, access }`, and pass `audit` to `PgKernel`. **Shim removed:** the nearest-kind mapping.
2. **PR-LDC-08 (a), (b), PR-LDC-20, support access (guide §7ag).** Map `plt_support` onto `PLT_SUPPORT` with `supportContext`; run requests and consent through `SupportAccess` and reads through `SupportReads`; show `SupportAccess.reads` to tenant admins. **Shims removed:** PLT_SUPER_ADMIN break-glass for support, and `plt_support` acting through the module's service identity.
3. **PR-LDC-03, refresh with reuse detection (guide §7ah).** Call `identity.refreshSession({ refreshToken })`; treat `IPB-IDN-001` `refresh_reused` as a forced sign-out. **Shim removed:** direct token-endpoint calls.
4. **PR-LDC-09, IdP brokers (guide §7ai).** Recreate each hand-configured IdP with `upsertIdentityProvider` behind an R3 maker-checker request (the secret by `secret://` reference; `identityBrokers: true` on the Keycloak realm); route sign-in with `discoverIdentityProvider(email)`; provision each SSO user before their first brokered sign-in (linking only). Re-registering an alias configured by hand is refused (`alias_taken`): delete the old one first. **Shim removed:** hand-configured IdPs.
5. **PR-LDC-10, the external-read summary (guide §7al).** Build the daily report from `AuditService.externalReadSummary(ctx, day)` (read counts, not row counts). **Shim removed:** your own scan of `platform.external_read` entries.
6. **PR-LDC-02, company data (guide §7aj).** Code company lookup, director and charge checks against `CompanyDataPort` with `FakeCompanyData` below staging; keep the port refused above staging until an adapter exists (#102). No shim to retire yet.
7. **PR-LDC-17 (part), setting history (guide §7am).** Read history with `SettingsService.history(ctx, key, scope)`. **Shim removed:** the `cfg` module's change history (its migration 0010 stays for scopes below ENTITY until PR-042).
8. **PR-LDC-04, breached passwords (guide §7an).** Run Keycloak from the customer image and apply the realm with `passwordBlacklist: KEYCLOAK_PASSWORD_BLACKLIST`. **Shim removed:** the length-and-history-only policy.
9. **Mark met** PR-LDC-02 (interface), 03, 04, 07, 08, 09, 10, 17 (history) and 20. PR-LDC-18 needed no change (guide §7ae); PR-LDC-19 waits for OWNER-QUESTIONS #106; PR-LDC-21 and 22 are wave 5.

## 8. Wave 5 (`contracts`, `tenancy`, `connectors` and `rules` minors, patches of the rest)

What LawDocsComply removes once it moves to the wave 5 release (R1-D-86, R1-D-88; guide §7ap). Move every `@infrabyx/*` dependency to that release together and run `infrabyx-migrate --require-all` (`rules/0002`).

1. **PR-LDC-21 (a), rule parameters.** Declare each tenant-tunable threshold or switch as a parameter of the rule set (`name`, `type`, `setting`, `default`, bounds or allowed values), register each `setting` key in your `settings-tree.yaml`, and pass your `SettingsService` to `RulesService` as `settings`. Tenants change values through settings' maker-checker and history. **Shim removed:** per-tenant pack republishing.
2. **PR-LDC-21 (b), publish checkers (#109).** Build `RulesService` with `publishCheckerRoles: ["TEN_CCO", "TEN_ADMIN"]`. Keep your second sign-off for statute, regulator and SRO layers as it is. **Shim removed:** routing publish checks through ORG_CHECKER only.
3. **PR-LDC-22 (a), the publish event.** Pass `outbox` to `RulesService` and subscribe to `in.ldc.rules.RuleSetPublished.v1`, written when the publish executes (the cut-over). **Shim removed:** polling for the published version.
4. **PR-LDC-22 (b), as-of evaluation.** Evaluate past decisions with `evaluate(ctx, { ruleSetId, asOf }, input)`; parameters take current values and the decision records the ones used. **Shim removed:** the version history in `classification.ts`.
5. **PR-LDC-25, compiling ahead.** Call `rulesService.prepare(ctx)` at start-up and on each `RuleSetPublished` from another instance; keep the 50 ms budget. **Shim removed:** the 2 s authoring instance for seed, publish and tests.
6. **Mark met** PR-LDC-21 and 22 and PR-LDC-25. PR-LDC-23 is spec request PR-043 (spec v1.4; keep `X-Infrabyx-JWS`); PR-LDC-24, 26, 27, 28 (XLSX, DOCX) and 29 are wave 6; PDF is wave 7.

## 9. Wave 6 (version PR #220: `contracts` 1.21.0, `tenancy` 1.14.0, `connectors` 1.12.0, `testing` 1.11.0, `notify` 1.3.0, `ai` 1.1.0, `brand` 1.1.0, `export` 1.3.0, `a11y` 1.1.0, `config` 1.11.0, `workflow` 1.3.0, patches of the rest)

What LawDocsComply removes once it moves to the wave 6 release (R1-D-89, R1-D-90; guide §7aq to §7av). Move every `@infrabyx/*` dependency to that release together and run `infrabyx-migrate --require-all` (`brand/0002`, `notify/0004`, `notify/0005`, `tenancy/0018`) before the new code starts, since `BrandStudio.resolve` reads `brand/0002`'s table; then `infrabyx-rls-lint`.

1. **PR-LDC-24, the form lint (guide §7aq).** Map your form config onto `FormLayout`, call `lintForm` in CI (fail on `severity === "error"`) and add `axeFormScan` to each form's Playwright test. **Shim removed:** `lintForm` in `cfg/form.rules.ts`.
2. **PR-LDC-26, the tenant brand layer (guide §7as).** Build `TenantBrandLayers` with your NOTIFY `emailIdentityVerified` hook, your EDGE `domainVerified` hook and, if you sell it by plan, `enabled`; move each tenant's colours, logo, favicon, letterhead, email identity, domain and login message into a layer through `propose` and a checker's approval (R3). **Shim removed:** `cfg.brand_layer`.
3. **PR-LDC-27, tenant notification templates (guide §7at).** Build `TenantTemplateStore`, pass its resolver to `NotifyService` as `templates`, call `registerApprovals` once, declare `variables` on your catalogue classes and move each tenant's override in through `requestChange` (R3). SMS and WhatsApp overrides select a registered template from your `TemplateRegistry`. Any EMAIL adapter of your own must declare `capabilities.content: "native"`, or tenant email overrides fail closed. **Shim removed:** `cfg.notification_template`.
4. **PR-LDC-28, XLSX and DOCX (guide §7ar).** Produce reports with `toXlsx` and explanations with `toDocx`; pass `{ neutraliseFormulas: true }` to `toCsv` for a CSV a person will open in a spreadsheet. **Shim removed:** the JSON and CSV in a ZIP, and the Markdown explanations. PDF follows in wave 7.
5. **PR-LDC-29, sandbox tenants (guide §7au).** Create sandbox tenants with `TenantBootstrap ... { sandbox: true }` and change the flag only through `TenantSandbox` (from wave 7 under maker-checker, §10); read it only as `isSandboxed(tx.ctx)`. A tenant without a `tenancy.tenant` row is not a sandbox, so no extra step is needed for the platform tenant. **Shims removed:** the `cfg.sandbox` guard and the wrapped senders.
6. **PR-LDC-19, a shorter approval expiry (guide §7av).** Register nothing new: set `mc.expiry_hours.<action>` per tenant (1 to 168 hours, through settings' R4 maker-checker); the engine never exceeds the action's platform period. **Shim removed:** your own expiry of approval requests.
7. **Mark met** PR-LDC-19, 24, 26, 27, 28 (XLSX, DOCX) and 29. PR-LDC-23 waits for spec v1.4 (keep `X-Infrabyx-JWS`); PDF is wave 7.

## 10. Wave 7 (version PR #226, release run 203: `contracts` 1.22.0, `config` 1.12.0, `export` 1.4.0, `tenancy` 1.15.0, patches of the rest)

What LawDocsComply removes once it moves to the wave 7 release (R1-D-95; guide §7aw to §7az). Move every `@infrabyx/*` dependency to that release together and run `infrabyx-migrate --require-all` (`config/0004`, `config/0005`), then `infrabyx-rls-lint`.

1. **PR-LDC-17, scopes below ENTITY (guide §7ax).** Declare `unit_override: true` on the keys you set per unit, build `ctx.unitIds` (outermost first) server-side from your organisation model, and move each unit's values in through `settings.set(ctx, key, { tier: "UNIT", scopeId }, value)`. **Shim removed:** the product `cfg` module (migration 0010; contract it in a later release).
2. **#110, history in the export and erasure (guide §7aw).** Add `setting_change` to your next export map version; call `settings.eraseUser` from your DPDP erasure workflow.
3. **PR-LDC-28, PDF (guide §7ay).** Render with `toPdf` from the same blocks you give `toDocx`; write "INR" or "Rs." where you used the rupee sign. **Shim removed:** your own PDF rendering.
4. **PR-LDC-29, sandbox changes (guide §7az).** Change a tenant's flag only through `request`, `decide` and `apply`; `TenantSandbox.set` is refused.
5. **Mark met** PR-LDC-17 and PR-LDC-28 (PDF). PR-LDC-23 waits for spec v1.4 (#116; keep `X-Infrabyx-JWS`).

## 11. Wave 8 (version PR #230, release run 207: `contracts` 1.23.0, `connectors` 1.13.0, `export` 1.5.0, `tenancy` 1.16.0, patches of the rest)

What LawDocsComply changes once it moves to the wave 8 release (R1-D-96, R1-D-97).

1. **PR-LDC-23, the JWS header (guide §7bd; Ecosystem Spec v1.4).** Use `deliveryHeaders` and `receiveHttp` on the Operations Hub adapter, or `regulatedJwsFromHeaders` for other regulated messages. LDC already sends `X-Infrabyx-JWS`, so nothing changes on the wire. **Shim removed:** your own header reading and writing. Mark PR-LDC-23 met.
2. **PDF (guide §7ay).** The rupee sign now renders; documents in Hindi or Punjabi go through `renderPdf` with a DOCGEN adapter (the platform's Gotenberg adapter follows in wave 9, #120).
3. **Sandbox changes (guide §7az).** Pass `appEnv` to `TenantSandbox`: in production a change waits 60 minutes after approval (#118).

## 12. Wave 9 (version PR #233, release run 210: `connectors` 1.14.0, `config` 1.13.0, `testing` 1.13.0, patches of the rest)

1. **Hindi and Punjabi documents (guide §7be, §7ay).** Bind `GotenbergDocgen` (in-cluster Gotenberg, `int.docgen.gotenberg.enabled`) as the `docgen` of `renderPdf`. **Shim removed:** any product-local HTML-to-PDF path for vernacular notices.

## Security patch: `tenancy` 1.14.1 (R1-D-92)

**Upgrade to the patched `tenancy` release (1.14.1 or later) before your next exit gate.** In `tenancy` 1.14.0 and earlier, a mutation joined to an ambient one (`kernel.ambient`, PR-UDF-033, PR-FBX-21) that was still running when the ambient mutation ended (a sibling of a refused concurrent call, or a call not awaited) could run its next statements on the pooled connection after it was returned, that is, in the next transaction on that connection, which may be another tenant's. The patch refuses any statement on a transaction that has ended (`KernelGuardError`), makes an ambient mutation wait for its joined calls and fail when one was still running, and refuses a joined call that starts after it ended. What to check: await every call inside `kernel.ambient` (no fire-and-forget, no `Promise.all` over joined mutations), and never keep a `tx` beyond its callback. No migration, setting or API change; code that already awaited its calls behaves as before.

## Wave 12 (PR-LDC-35 and PR-LDC-34)

- **PR-LDC-35:** take the wave 12 patches together and run `infrabyx-migrate`: every platform outbox (`rules` included) is registered, and the first relay pass delivers the backlog. No shim to remove (none was possible in the product).
- **PR-LDC-34:** call `rules.publish(ctx, ruleSetId, version, { effectiveFrom })` with the entity's 00:00 instant and remove `versionAsOf`; read `listRuleSets().scheduledVersion` and `scheduledFrom` for the pending cut-over.
- **PR-LDC-30 to PR-LDC-33:** planned in waves 13 and 14 (`docs/platform-requests.md`); PR-LDC-33 waits for the owner's sign-off of the v1.5 draft.

## Wave 13 (in progress)

- **PR-LDC-41 (`contracts`, `testing`, `connectors`, `config` minors):** scan every upload with `FileScanPort` (`@infrabyx/connectors/av`, `ClamavFileScan`) and act only on `scanDecision` (product guide §7bl): `CLEAN` releases, `INFECTED` rejects, `ERROR` stays quarantined. Run clamd in your cluster with daily `freshclam`, set `int.av.clamav.enabled` (R4). **Shim removed:** the local ClamAV client.
- **PR-LDC-37 (`tenancy` minor; migration `tenancy/0022`):** replace the second-transaction cancel with `approvals.cancelIn(tx, id, reason)` in your own transaction (product guide §7bm). **Shim removed:** the second-transaction cancel.
- **PR-LDC-42 (`config` minor):** replace the after-commit setting write with `settings.setIn(tx, …)` (product guide §7bn); your Appendix D roles authorise through the `change` roles registered for your keys. **Shim removed:** the after-commit setting write.
- **PR-LDC-30 (`audit`, `contracts` minors; migrations `audit/0010`, `audit/0011`):** pass `businessIds` to `audit.record` and read with `auditService.history(ctx, id)` (product guide §7bo). **Shim removed:** `core.bizid_history_index`.
- **PR-LDC-31 writer (`export` minor):** build your workbook templates with `toXlsx` column `width`, `validation`, `editable`, sheet `validationRows` and `protection`, and `namedRanges` (product guide §7bp). Re-check every value when a workbook comes back: protection is not a control. **Shim removed:** the ExcelJS writer half of `WorkbookPort` (the reader waits for wave 14).
- **PR-LDC-36 (`export` minor):** pass arrows to `toPdf` as they are (product guide §7bq). **Shim removed:** the arrow-to-ASCII replacement.
- **PR-LDC-53 (`contracts`, `testing` minors):** code your calendar feature against `CalendarPort` and `FakeCalendar` now (product guide §7bs), with a detail level per entry; register your console host's callback in the owner's application when it exists. The adapters stay off until the owner registers the OAuth applications (#126). Keep your ICS export until an adapter is proven.
- **PR-LDC-61 (`export`):** the map gate now reads every column of a multi-column `ALTER TABLE`; run `infrabyx-export map-gate --base origin/main` as a required CI job (add the `export:unchanged` label to a PR that touches a mapped table without changing what an export holds). **Shim removed:** your own call of the gate function in place of the CLI.

## Wave 14 (in progress)

- **PR-LDC-55 (`contracts`, `connectors` minors):** build your floor with `mfaFloor`, guard with `assertMfaForRoles(claims, floor, { stepUp })`, answer `stepUpChallenge` as a 401, and add `assertStepUpReachable` to a boot test (product guide §7bt). **Shim removed:** your product MFA floor.
- **#125 ordered approval levels (`contracts`, `tenancy`, `workflow` minors; migration `tenancy/0023`):** pass `levels` on one request instead of chaining a request per level (product guide §7bu). **Shim removed:** the per-level chaining.
- **PR-LDC-45, PR-LDC-51 (`contracts` minor):** validate `in.infrabyx.grc.EvidenceSubmitted.v1` and `in.infrabyx.platform.ProviderIncident.v1` payloads with `EvidenceSubmittedData` and `ProviderIncidentData` (`@infrabyx/contracts/events`). **Shim removed:** your own copies of these two payload types.
- **PR-LDC-49 (`rules` minor; migration `rules/0004`):** move your forecast rule sets to `purpose: "projection"` sets and call `rules.project` (product guide §7bv). **Shim removed:** the decision records your forecasts wrote.
- **PR-LDC-60 (`contracts`, `connectors`, `testing`, `config` minors):** store board papers and price-sensitive material with `compartment: "BOARD_CONFIDENTIAL"` and sealed material with `"SEALED"` (product guide §7cd); configure a bucket and a KMS key for each compartment (and a per-compartment key for tenants with their own CMK). You may store board papers once this release is installed and the compartment buckets and keys exist. **Shim removed:** none (board papers were not stored).
- **PR-LDC-32 (`ui` minor):** replace the row editor with `DataGrid` (typed columns with your validators; `onCellChange` gets valid values only) and the import mapping step with `ColumnMapper`, whose select lists and keyboard move map every column without dragging (product guide §7ce). Move your validators into each column's `validate` and keep running `checkCell` on the server for posted values. **Shim removed:** the server-rendered row editor.
