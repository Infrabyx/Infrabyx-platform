# Adoption note — Finbyx (3 November 2026 release)

What Finbyx bumps, migrates and retires to take the platform's answers to PR-FBX-13 and PR-FBX-20 to PR-FBX-31. The detail of each step is in the product guide section named.

## 1. Bump

Move every `@infrabyx/*` dependency together, in one change, to the versions of the release that follows version PR "chore: version packages" of 3 November 2026 (STATUS, "Releases after 1.0.0"): `contracts` 1.15.0, `tenancy` 1.9.0, `connectors` 1.5.0, `crypto` 1.4.0, `config` 1.6.0, `workflow` 1.2.0, `testing` 1.5.0, `audit` 1.5.1, `consent` 1.1.2, `notify` 1.1.11, and the rest at their patch.

Then run `infrabyx-migrate --require-all`. It applies `consent/0003`, `audit/0005`, `workflow/0003`, `tenancy/0011` to `0013`, the no-transaction `tenancy/0014`, and `tenancy/0015`. Run `infrabyx-rls-lint` after it.

**Temporal (PR-FBX-14).** The 3 November evening release moves `@temporalio/*` to 1.25.0 in `connectors`. Once you are on it, drop your SEC-01 override.

## 2. Retire these shims

| Request                  | Shim to retire                                                                              | Replacement                                                                                                                                                                                  | Guide |
| ------------------------ | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| PR-FBX-25                | the `localDevKey` blind-index derivation, and the refusal to create customers above staging | `BlindIndexer` with `loadBlindIndexRoot`. The labels match, so existing indexes stay valid. Lift the refusal once the secret exists                                                          | §7i   |
| PR-FBX-26                | `kyc.consent` and `kyc/notices.ts`                                                          | `PurposeConsents`. Import old rows with `method: "IMPORT"` once each notice is approved                                                                                                      | §7j   |
| PR-FBX-20                | the "any checker" vetting of OWNER-QUESTIONS #20                                            | `TenantFunctions`, with `checkerFunctions: ["FN:CRO"]` to vet and `["FN:CCO"]` to approve                                                                                                    | §7k   |
| PR-FBX-31                | `org.compliance_officer` (migration 0065)                                                   | `FN:COMPLIANCE_OFFICER` with `OFFICER_POLICY` and `registerRef` naming the `org.entity_officer` row                                                                                          | §7k   |
| PR-FBX-22, PR-FBX-10 (5) | AU7's `app_ro` reads                                                                        | `ExternalGrants.fromApproved` from the AU7 executor, and reads through `ExternalReads` as `app_external`. Closes your OWNER-QUESTIONS #24                                                    | §7l   |
| PR-FBX-27                | the write path of `kyc/retention.ts`                                                        | `putWithRetention`, `extendRetention`, `retentionOf` and `assertImmutable`. Keep your date rules                                                                                             | §7m   |
| PR-FBX-30                | COB pass A's one transaction per loan                                                       | `tx.unit` per loan and `recordBatch` per step                                                                                                                                                | §7n   |
| PR-FBX-28                | `los/ports.ts`                                                                              | `CreditBureauPort` and `AccountAggregatorPort`, with the platform's fakes                                                                                                                    | §7o   |
| PR-FBX-29                | `dms/ports.ts`, `dsb/ports.ts` and your `FakeEsign`                                         | the platform's `EstampPort`, `PayoutsPort`, `DocgenPort`, `PdfPort` and `MandateLifecycle`, with its fakes. Keep your Gotenberg renderer behind `DocgenPort` until a platform adapter exists | §7r   |
| PR-FBX-13 (1)            | the hourly `TenantSweep` that expires external grants                                       | a `WorkflowTimers` kind such as `fbx.extaccess.expire`                                                                                                                                       | §7c   |
| PR-FBX-21                | `FbxKernel`'s first-mutation claim, `respondFrom` and `IdempotentScope`'s path re-hash      | `kernel.ambient`, with the route parameters in the hash (`tenancy/0015`)                                                                                                                     | §7g   |
| PR-FBX-24 (3)            | —                                                                                           | `kycMethodRouter`, with Digio first and IDfy second. The IDfy adapter covers PAN, face match and liveness. It stays off and `unproven` until the sandbox exists                              | §7e   |

Then mark PR-FBX-13 (1), 20, 21, 22, 25 to 28, 30 and 31 met in `docs/platform-requests.md`. Mark PR-FBX-29 met for its interfaces. PR-FBX-24 stays open for Digio's missing methods.

## 3. Still open on the platform

| Request                                                                                                 | Recommendation                                                                                                         |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| PR-FBX-11 (`insertOnce` in the seed writer)                                                             | Small and safe; next platform patch. Not blocking: your seeds avoid append-only tables                                 |
| PR-FBX-12 (an OpenFGA product model; `mfaRoles`)                                                        | (2) next platform minor. (1) is larger, and Cerbos is your reference, so it does not block Phase P                     |
| PR-FBX-13 (2) (`person_name` and `din` mask rules)                                                      | Next `tenancy` minor; your `maskName` shim is enough until then                                                        |
| PR-FBX-15, 16, 17 (settings levels and effective dating, rule layers, `executeAt`, a workflow designer) | Each needs a plan and owner review (the settings tiers and maker-checker are on the locked list). Not blocking Phase P |
| PR-FBX-18 (national reference data)                                                                     | A new package; needs a plan and the owner's word. Per-tenant tables are enough for the pilot                           |
| PR-FBX-23 (`retainDays` on `IdempotencyExpiry`)                                                         | Small; next `tenancy` patch. Your `IdempotencyRetention` job is correct meanwhile                                      |
| PR-FBX-24 (Digio's other nine methods)                                                                  | Waits for the owner's Digio sandbox. IDfy covers PAN, face match and liveness now                                      |
| PR-FBX-02 (tenant-owned keys and buckets)                                                               | Deferred by the owner (#83) until before Phase 6                                                                       |

**Phase P.** Your runbook ties Phase P to these, and none needs a new platform request:

- live email and SMS: the platform has the SES, Brevo, MSG91 and Gupshup adapters, so this is your wiring and the owner's accounts;
- the payout rail: money movement, waiting for the owner (#46, platform OWNER-QUESTIONS #100);
- the COB load test: PR-FBX-30 is now met.

Stays product-local: your workspace catalogue, AU7's grantee types, the executor's three-different-people rule, the COB rules, the KYC date rules and the Gotenberg renderer until the platform's `DOCGEN` adapter exists.

## 4. PR-FBX-32: many COB writers per tenant (the release after `audit` 1.5.1)

What the close of business gains, and what Finbyx changes, once `@infrabyx/audit` carries chain lanes (ADR-0005, R1-D-58, guide §7u).

1. **Bump and migrate.** Move every `@infrabyx/*` together to that release and run `infrabyx-migrate --require-all`. `audit/0006` briefly locks the ledger and the capture, so run it outside the COB window. `audit/0007` builds two indexes concurrently. Nothing already written changes: each tenant's chains continue as lane 0.
2. **Use more workers.** A tenant's writing transactions no longer queue on one head row. Up to 32 COB transactions of a tenant append at once, so the partitions claimed by several workers (COB-PERF) now add throughput. If COB runs more than 32 concurrent writers per tenant, raise the lanes in a Finbyx migration: `select audit.set_chain_lanes('ledger', 64); select audit.set_chain_lanes('capture', 64);`.
3. **Batch per transaction.** Group loans into transactions of a few thousand `tx.unit` each, with one `recordBatch` per step (§7n), and drop the per-loan `update cob.run set loans = loans + 1` hot row (set the count at the step's end). In each transaction, write the loan's rows before its ledger entry.
4. **`seq` is not a count any more.** Anything that counts ledger or capture entries by `seq`, or pages by `afterSeq` expecting commit order, uses `count(*)` or a snapshot read instead. The Rule 11(g) pack and the auditor export verify with `verifyAgainstAnchor` and `verifyCaptureAgainstAnchor`, which accept the new format-3 anchors and the old ones.
5. **Prove it.** Re-run `load:cob-db` with several workers, then the 1,000,000-loan staging run (#38) with `FBX_COB_ASSERT_WINDOW=1`. Mark PR-FBX-32 met once the window holds.

## 5. Wave 1 (version PR #208, release run 184: `connectors` 1.8.0, `tenancy` 1.10.0, `contracts` 1.16.0, `testing` 1.8.0)

What changes for Finbyx with the wave 1 release (R1-D-66; owner answer #100's gap). Move every `@infrabyx/*` dependency to that release together. Wave 1 adds no migration.

1. **Mandate approvals are consumed by the approvals engine (guide §7x).** If you wire `DigioMandates`, raise each mandate's maker-checker request on `MANDATE_APPROVAL_ACTION` at R3 or above. Its payload is exactly the `MandateApprovalSubject`: register with the idempotency key and the ceiling in paise, or cancel with the mandate id and its current ceiling. Pass the adapter `approvals: engine.mandateVerifier(ctxFor)` and `tenantId`; both are now required. The adapter consumes the approval before Digio is called. A consumed approval never covers a second vendor call. **Shim removed:** any product-side "was this approval already used for a mandate" check. Your own maker-checker stays in front of the call.
2. **No change needed** for the chain lanes, PR-FBX-29's interfaces or the stub adapters. PR-FBX-33 (per-tenant SMS and WhatsApp templates) is wave 2 (M39); keep the AsyncLocalStorage `TenantSms`/`TenantEmail` wrappers until then.

## 6. Wave 2 (version PR #209, release run 186: `contracts` 1.17.0, `notify` 1.2.0, patches of the rest)

What changes for Finbyx with the wave 2 release (R1-plan M39; R1-D-69). Move every `@infrabyx/*` dependency to the run 186 versions together and run `infrabyx-migrate --require-all` (`notify/0003`, a column grant and a concurrently built index).

1. **PR-FBX-33, per-tenant templates (guide §7aa).** Pass `templates: (ctx, cls, channel, locale) => …` to `NotifyService`. Return the tenant's DLT entity id, sender id, DLT template id and positional `vars` for SMS, or the template name and language for WhatsApp; `undefined` uses the catalogue's; `null` fails that delivery closed (nothing is sent; `IPB-PORT-001`, `template_missing`). NOTIFY calls it at every delivery, so `dispatchDue` sends each tenant's own template too. **Shim removed:** the AsyncLocalStorage `TenantSms` and `TenantEmail` wrappers. WhatsApp can now be turned on per tenant.
2. **Delivery reports.** If your SMS or WhatsApp vendor's webhook carries no tenant, call `routeSmsReports(adapter, reports)` or `routeWhatsappEvents(adapter, events)` after verifying the webhook, instead of resolving the tenant yourself.
3. **Mark met** PR-FBX-33 in your `docs/platform-requests.md`.

## 7. Wave 3 (version PR #212, release run 188: `contracts` 1.18.0, `connectors` 1.9.0, `consent` 1.2.0, `tenancy` 1.11.0, `testing` 1.9.0, patches of the rest)

What changes for Finbyx with the wave 3 release (R1-D-72, R1-D-73). Move every `@infrabyx/*` dependency to the run 188 versions together and run `infrabyx-migrate --require-all` (`consent/0004`).

1. **#95, the purpose-consent purge (guide §7ac).** Schedule `ConsentPurge.sweepPurposes()` daily beside `sweep()`, and call `ConsentSubjects.endRelationship(ctx, subjectRef, closedAt)` when a loan relationship ends. Records go only once that end and any later withdrawal are both 8 years past, never under a legal hold (`ConsentSubjects.legalHold`); the reading of the two clocks is OWNER-QUESTIONS #108. No setting to change. **Shim removed:** none; this adds the approved retention sweep.
2. **Optional:** `fieldCryptoForTenant` (guide §7ad) if you seal fields per tenant; `latestByPrincipal` (guide §7ac) to read a borrower's latest consent per purpose.
3. **No change needed** for the v1.3 provisioning events (Finbyx is provisioned by the Operations Hub) or the CEL string functions.

## 8. Wave 4 (version PR #214: `contracts` 1.19.0, `connectors` 1.10.0, `testing` 1.10.0, patches and minors of the rest)

What changes for Finbyx with the wave 4 release (R1-D-80, R1-D-84). Move every `@infrabyx/*` dependency to that release together and run `infrabyx-migrate --require-all` (`tenancy/0016`, `0017`, `config/0003`; none is Finbyx-specific).

1. **PR-FBX-34 (1), (2), collection ports (guide §7ak).** Replace your product-local collection ports (presentation, response file, statement lines, settlement lines) with `DisbursementRailPort` and PAYMENTS `ReconcileReport.settlementLines`, using `FakeDisbursementRail` and `FakeSettlements`; keep the port refused above staging until a sponsor-bank adapter exists (the owner's word, money movement). Each debit item is a money call with its approval reference, idempotency key and integer paise. (3) is deferred until after the pilot.
2. **PR-FBX-35, bureau EMI, DDE signer trail and not-stampable DDE (guide §7ao).** (a) Use `Tradeline.emiPaise` in FOIR; impute or refer when it is `null`, never count it as 0. (b) Store `DdeRecord.signers` with your ESIGN evidence. (c) Register sanction letters and KFS acknowledgements with `ddeRegister({ …, notStampable: { reason } })` from your RULES' stampability decision. If you implement `EstampPort` yourself, add `signers` and `notStampableReason` to its `DdeRecord`. **Shims removed:** the fail-closed handling of each.
3. **Mark met** PR-FBX-34 (1), (2) (interfaces) and PR-FBX-35.

## 9. Wave 8 (version PR #230, release run 207: `contracts` 1.23.0, `connectors` 1.13.0, `consent` 1.3.0, `export` 1.5.0, `tenancy` 1.16.0, `testing` 1.12.0, patches of the rest)

What Finbyx removes once it moves to the wave 8 release (R1-D-96, R1-D-97; guide §7ba to §7bd). Move every `@infrabyx/*` dependency together and run `infrabyx-migrate --require-all` (`consent/0005`), then `infrabyx-rls-lint`.

1. **PR-FBX-36, whose return it is (guide §7ba).** Charge a bounce only when `bounceChargeable(result)`. **Shim removed:** `pay.return.borrower_codes` as the table (the owner's table is the floor, #119); a tenant's narrower list goes in as `borrowerCodes`.
2. **PR-FBX-37, the purge per tenant (guide §7bb).** Schedule `dryRunPurposes` then `purgePurposesFor` per tenant from `tenantsWithPurposesDue()`. **Shim removed:** Finbyx's dry-run table, per-record ledgering and the hold on relationship-end reports.
3. **PR-FBX-38, TELEPHONY (guide §7bc).** Program against `TelephonyPort`; `FakeTelephony` below staging. **Shim removed:** the product-local `TelephonyPort` and its fake.
4. **PDF (guide §7ay).** KFS and notices with the rupee sign render in process; those in the borrower's language go through `renderPdf` with your DOCGEN adapter.
5. **Mark met** PR-FBX-36, 37 and 38.

## 10. Wave 9 (version PR #233, release run 210: `connectors` 1.14.0, `config` 1.13.0, `testing` 1.13.0, patches of the rest)

1. **Vernacular KFS and notices (guide §7be, §7ay).** Run Gotenberg in your cluster, enable `int.docgen.gotenberg.enabled`, and render documents in the borrower's language with `renderPdf(doc, { docgen: new GotenbergDocgen(…), lang, outputPrefix })`. **Shim removed:** any product-local HTML-to-PDF path for Hindi or Punjabi.

## 11. Wave 10 (version PR #237, release run 214: `audit` 1.8.0, `contracts` 1.24.0, `tenancy` 1.17.0, `testing` 1.14.0, `workflow` 1.3.5 and patches of the rest)

1. **PR-FBX-40, the tenant-id rule (guide §7bg).** Before upgrading `tenancy`, check that no tenant id has an underscore after `tnt_` (`tenancy/0019` stops and names any). **Shim removed:** `COL_TENANT_PREFIX` in `col/calls.ts`.
2. **PR-FBX-39, retire `cif.consent_purge_run` (guide §7bf).** Upgrade `audit` (install `audit/0008` as the database owner) and `tenancy` (the runner's marker), then in one contract migration: `select audit.retire_capture('cif.consent_purge_run'); drop table cif.consent_purge_run;`. **Shim removed:** the retired, empty table.
3. **PR-FBX-41, 42, 44, the DISPATCH, COURT_DATA and ODR ports (guide §7bh).** Program against `DispatchPort`, `CourtDataPort` and `OdrPort`; `FakeDispatch`, `FakeCourtData`, `FakeOdr` and `equatorOdrStub()` below staging. **Shims removed:** the product-local `DispatchPort` and `CourtDataPort` with their fakes, and the product-local `OdrProvider` with its Equator stub (keep the CSV fallback as your own FILE-mode adapter).
4. **PR-FBX-43** is planned for wave 11, after OWNER-QUESTIONS #123. Meanwhile, sign `LegalNoticeIssued`, `OrderRecorded` and `RecoveryReceiptPosted` with `signRegulatedMessage` from `@infrabyx/crypto` (the C-22 profile, `X-Infrabyx-JWS`). **Shim removed now:** unsigned regulated events.
5. **Mark met** PR-FBX-39, 40, 41, 42 and 44 once adopted.

## 12. Wave 11 (version PR #240, release run 217: `contracts` 1.25.0, `tenancy` 1.18.0 and patches of the rest)

1. **PR-FBX-43, module lifecycle and entitlements (guide §7bi).** Replace `RecEntitlements` and `rec.entitlement` with `TenantEntitlements` (`tenancy/0020`; the same two-person rule, now with PLT_FINANCE as a requester and R4 in production); the guard's licence check becomes `assertWritableIn(tx, 'RECOVERY_CORE')` for writes, reads unrefused; keep `rec.module_state` on the platform's `MODULE_EDGES`; publish `ModuleAttached`, `ModuleDetached` and `LegalHoldChanged` with the platform schemas, signed with `signRegulatedMessage`. Carry existing versions over in a migration of your own (insert each version through the platform's approved path, or keep `rec.entitlement` read-only for history). **Shims removed:** the product-local entitlement and the licence half of the guard (P12-03).
2. **Mark met** PR-FBX-43 once adopted.

## Security patch: `tenancy` 1.14.1 (R1-D-92)

**Upgrade to the patched `tenancy` release (1.14.1 or later) before your next exit gate.** In `tenancy` 1.14.0 and earlier, a mutation joined to an ambient one (`kernel.ambient`, PR-UDF-033, PR-FBX-21) that was still running when the ambient mutation ended (a sibling of a refused concurrent call, or a call not awaited) could run its next statements on the pooled connection after it was returned, that is, in the next transaction on that connection, which may be another tenant's. The patch refuses any statement on a transaction that has ended (`KernelGuardError`), makes an ambient mutation wait for its joined calls and fail when one was still running, and refuses a joined call that starts after it ended. What to check: await every call inside `kernel.ambient` (no fire-and-forget, no `Promise.all` over joined mutations), and never keep a `tx` beyond its callback. No migration, setting or API change; code that already awaited its calls behaves as before.

## 13. Wave 12 (PR-LDC-35 and PR-LDC-34)

- **Bug fixed that affects Finbyx (PR-LDC-35, R1-D-112):** no platform outbox was registered for the relay, so `RuleSetPublished` (and every other platform event) never left its table. Take the wave 12 patches of all `@infrabyx/*` packages together and run `infrabyx-migrate`; the first relay pass then delivers the backlog, so keep the `RuleSetPublished` consumer (the rule-set cache reload) idempotent on the event id. No product change is needed beyond the migrate run. Finbyx's own module outboxes need `select tenancy.register_outbox('<schema>')` in a migration if they are not registered already.
- **New (PR-LDC-34):** `publish(..., { effectiveFrom })` for a future cut-over; `RuleSetPublished.effective_from` can now be in the future, so a consumer reloads at that instant, not on receipt.

## Wave 13 (PR-FBX-46)

- **PR-FBX-46 (`contracts`, `testing` minors):** replace your `AccountingSink` interface and fake with `AccountingSinkPort`, `assertBalancedBatch`, `FakeAccountingSink` and `accountingContractCases` (product guide §7br). A changed batch needs a new `journalId`. Keep your TallyPrime JSON file adapter until the platform's TallyPrime adapter ships (wave 15). **Shim removed:** the interface and fake.
