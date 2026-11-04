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

## 5. Wave 1 (the release after version PR #204: `connectors` 1.8.0, `tenancy` 1.10.0, `contracts` 1.16.0, `testing` 1.8.0)

What changes for Finbyx with the wave 1 release (R1-D-66; owner answer #100's gap). Move every `@infrabyx/*` dependency to that release together. Wave 1 adds no migration.

1. **Mandate approvals are consumed by the approvals engine (guide §7x).** If you wire `DigioMandates`, raise each mandate's maker-checker request on `MANDATE_APPROVAL_ACTION` at R3 or above. Its payload is exactly the `MandateApprovalSubject`: register with the idempotency key and the ceiling in paise, or cancel with the mandate id and its current ceiling. Pass the adapter `approvals: engine.mandateVerifier(ctxFor)` and `tenantId`; both are now required. The adapter consumes the approval before Digio is called. A consumed approval never covers a second vendor call. **Shim removed:** any product-side "was this approval already used for a mandate" check. Your own maker-checker stays in front of the call.
2. **No change needed** for the chain lanes, PR-FBX-29's interfaces or the stub adapters. PR-FBX-33 (per-tenant SMS and WhatsApp templates) is wave 2 (M39); keep the AsyncLocalStorage `TenantSms`/`TenantEmail` wrappers until then.
