# STATUS — infrabyx-platform

Updated: 2026-10-27

| Item                  | Value                                                                                                                                                                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current phase         | **PL2 closed at gate A (2026-10-27); PL3 started.** PL3 plan `docs/phases/PL3-plan.md` written and self-reviewed (PL3-D-01); next is PL3 session 1 (spike, contracts, config). Continuous build mode (PL2-D-41)             |
| Spec of record        | `docs/ipb/` (IPB v1.0 + IPB-14 runbook), `docs/ecosystem/` (Spec v1.2)                                                                                                                                                      |
| Packages              | Published to GitHub Packages: contracts, crypto, config, tenancy, seed and testing 0.2.0; audit 0.1.1; connectors 0.1.0 (release run 29, `a09d13c`). The 15 later-phase scaffolds stay private until their phase (PL1-D-20) |
| Last exit gate passed | PL2 gate A (2026-10-27): report `docs/phases/PL2-gate-A.md`; PR #40 (gate fixes) and PR #14 (version), CI green; release run 29 published 8 packages                                                                        |
| Working branch        | `claude/sweet-maxwell-mv0qk2` (GitHub deletes it after each squash merge; push it again from `main` for the next session)                                                                                                   |

## What products can install (PL2 gate A, 2026-10-27)

| Package                | Version | shasum (SHA-1, reproduced; owner confirms against the registry, #17) |
| ---------------------- | ------- | -------------------------------------------------------------------- |
| `@infrabyx/contracts`  | 0.2.0   | `812119f57992b4a96a9a06ff5cc25235c6f9b6d1`                           |
| `@infrabyx/crypto`     | 0.2.0   | `d999360aa85318cf5835f9bc68cded9817b69d91`                           |
| `@infrabyx/config`     | 0.2.0   | `4e3ecaa978abc82d6133270d4ff23c6d280f9b6c`                           |
| `@infrabyx/tenancy`    | 0.2.0   | `740d4167d6b6b96dde549c5447b0fc29e2f6b194`                           |
| `@infrabyx/audit`      | 0.1.1   | `333771decdbab2ce0e5410efb3c4270d58c24b65`                           |
| `@infrabyx/seed`       | 0.2.0   | `378f258996e5c7d3c1941e786efd786e8afc276d`                           |
| `@infrabyx/testing`    | 0.2.0   | `25f5f0b4ddb12b243e8715173394a99acbb5fc27`                           |
| `@infrabyx/connectors` | 0.1.0   | `5e97dd5c6a6ed8a53a6f057fc8bf07388d5ad6d7`                           |

SHA-512 integrity values are in `docs/phases/PL2-gate-A.md` §6. To adopt this release, products must change the following (full list in §5 of that report):

- **Versions:** move all `@infrabyx/*` packages together and add `@infrabyx/connectors`.
- **Migrations:** `connectors/0001_init`, `0002_session_revocation` and `0003_pgboss` run through the existing `infrabyx-migrate` (tenancy 0.2.0), with no new command; run `infrabyx-rls-lint` afterwards.
- **Environment:**
  - `AUTH_SUPER_ADMIN_EMAIL`, in each private product repository's local environment only;
  - the port variables for the adapters routed to: `SECRETS_*`, `AUTH_*`, `FLAGS_*`, `OBS_*`, `STORAGE_*`, `QUEUE_*`, `WORKFLOW_*`, `MSG_*`, `PAYMENTS_*` (test mode only);
  - in production, `_REF` values are SECRETS paths.
- **Settings:** the `int.*`, `eng.otel.*`, `eng.logs.*` and `eng.flags.*` keys, plus `mkt.meta.enabled` (156 keys in the registry).
- **Routing:**
  - one `infra/routing/<env>.routing.yaml` per environment;
  - CI runs `infrabyx-routing check --sandbox-status node_modules/@infrabyx/connectors/sandbox-status.json`;
  - GLOBAL messaging entries need a `dpa_ref`;
  - staging and above may not name an unproven adapter (#28–#39).
- **Code:**
  - PAYMENTS: a `RefundApprovals` view, R3 refund requests, a Cashfree `customerContact` resolver, and `router.portFor` for refunds;
  - IDENTITY: PKCE `codeVerifier` and `assertMfaForRoles`;
  - field encryption v2;
  - `presign` options;
  - redaction of the Gupshup `ipb_token` in ingress logs.

## Done

- PL0 complete (PR #1); Renovate fixes (PR #6); PL1 plan approved and merged (PR #7).
- PL1 implemented (PR #8, merge commit e5d0a1d), one commit and one Changeset per package:
  - `@infrabyx/contracts`: data classes, IDs, environments, roles, tiers, 99 error codes, CloudEvents envelopes, module manifest, kernel interfaces, five port contracts.
  - `@infrabyx/crypto`: single cryptography call-site (IPB-12-05; PL1-C-01), enforced by `ipb/no-direct-crypto`.
  - `@infrabyx/config`: env loader and guards (exit 78), settings registry (103 keys), flag registry (`kill.*`, 39 `fut.*`) with safe state; migration `config/0001_init.sql`.
  - `@infrabyx/tenancy`: context from verified claims, PgKernel with ledger-required commit, outbox/inbox, approvals, break-glass, impersonation, field encryption, masking, `infrabyx-migrate`, `infrabyx-rls-lint`; migration `tenancy/0001_init.sql`.
  - `@infrabyx/audit`: trigger-computed hash chain, append-only for every role, verifier, corrections, signed anchors; migration `audit/0001_init.sql`.
  - `@infrabyx/seed`: refusal-first CLI, deterministic idempotent seeds, synthetic validator, purge, credentials; migration `seed/0001_init.sql`.
  - `@infrabyx/testing`: `startPostgres`, fakes, the five NN suites, port contract harness, `infrabyx-migration-lint`, `infrabyx-at-report`, `@infrabyx/testing/eslint`.
- Exit gate (PL1-plan §12): CI `verify` and `integration` (PostgreSQL 18: migrate, rls-lint, test:int, at-report) green; acceptance tests present and passing — IPB-01-AT-05/11/12/16, IPB-02-AT-04/07/08/10/11/12/15/20, IPB-07-AT-04/05/06, IPB-09-AT-09/10/11/12, IPB-11-AT-01…07, IPB-12-AT-01/03; @NN-01, @NN-02, @NN-18, @NN-45; @IPB-01-15 contract suites.
- Release (PR #10, PL1-D-18): 0.1.0 of the seven packages published by `release.yml` run 10, tags `@infrabyx/<pkg>@0.1.0` pushed.
- Commit subjects checked locally by lefthook `commit-msg` (installed by `pnpm install`, PL1-D-17).
- PL1 accepted by the owner (2026-10-26). Follow-ups: scaffolds private until their phase with an `ipb:check` rule (PL1-D-20); `release.yml` uses `NPM_PUBLISH_TOKEN` so the version PR triggers CI (PL1-D-21).

## Handover (2026-10-27, end of the session that closed PL2 gate A)

**Done.**

- **PL2 session 8 and gate A.** The gate-A walk (`docs/phases/PL2-gate-A.md`) found:
  - the §10 acceptance-test tags missing for five IDs;
  - no `port-contract` issues;
  - `sandbox-status.json` not shipped in the package.

  All three were fixed in #40 (PL2-D-67). Issues #28–#39 track the 12 unproven SaaS adapters.

- **Release.** Version PR #14 was merged, and release run 29 published the 8 packages, with tags (PL2-D-68). The checksums were reproduced locally, and the owner confirms them against the registry (#17). `release.yml` now records registry checksums after each publish.
- **PL3 plan.** `docs/phases/PL3-plan.md` is written and self-reviewed (PL3-D-01). It carries the owner's PL3 decisions: resend classes with default hold, the platform suppression list as the single source of truth, Brevo send-only, and no support-token work until a product needs it. It asks questions #7–#16, and the defaults are in use.

**Next.** PL3 session 1:

- spike on the [VERIFY] items: ZEN prebuilds on Node 24.22.1, the CEL library, the XLSX library licence, and the Expo, FCM, Leegality and Digio API shapes;
- then `contracts` (RULES, NOTIFY, PUSH, ESIGN, `HumanQueue`, catalogue and export schemas, IDs, events, `IPB-NTF-002..006`) and the `config` keys and `kill.msg.*` flags.

Then sessions 2–7 as in plan §12.

**Branch and PR state.** The PR with the PL3 plan and this handover is the only open PR. When it merges, `main` carries everything.

**Open questions.** OWNER-QUESTIONS #7–#17. Only #9 (signing and restricted exports), #13 (retention) and #14 (push accounts) park any work, and only the parts named there.

## Handover (2026-10-27, end of the session that built PL2 sessions 6 and 7)

**Done.** PL2 sessions 1–7 are built and merged:

- #13, #15–#21 (sessions 1–5, field-encryption v2, the MinIO-server leg);
- #23 (flaky base62 test fixed at the draw; public-repository rules, PL2-D-62; OWNER-QUESTIONS #5, PL2-D-63);
- #24 (session 6: EMAIL, SMS, WHATSAPP, PL2-D-64);
- #25 (OWNER-QUESTIONS #6 and the Gupshup conditions, PL2-D-65);
- #26 (session 7: PAYMENTS `razorpay` and `cashfree`, test mode only, PL2-D-66).

All thirteen PL2 ports now have both adapters with green hermetic contract legs in CI. Every SaaS adapter stays `unproven` until its sandbox leg runs (IPB-DEV-04).

Version PR #14 collects every changeset and was green after #23. It is regenerated after each merge, so check it again before gate A. It is merged only at gate A (PL2-D-31). Nothing from PL2 is published yet.

**Branch and PR state.** No PR is open. `claude/funny-cori-6upyrr` equals `main` (`0c4535d`). GitHub deletes it after each squash merge, so push it again from `main` before the next session's first commit.

**Next: PL2 session 8, then gate A** (plan §11, §14 of IPB-14):

1. Walk the PL2 exit-gate checklist in plan §11: the IPB-09 required checks, each port's `@IPB-..-AT-..` acceptance tests, `at-report`, the threat model, `sandbox-status.json`, and the owner tasks for sandbox accounts.
2. Write a short gate-A report with what passed, what is unproven and why, and the owner tasks.
3. When the checklist is green, merge version PR #14 so `release.yml` publishes the 0.x pre-releases.
4. Update STATUS with what products can install and what they must change: migrations `connectors/0002` and `0003`; the settings added in PL2; the env vars `AUTH_SUPER_ADMIN_EMAIL` and the `PAYMENTS_*`/`MSG_*` names; routing `dpa_ref` for GLOBAL messaging; `RefundApprovals` and `customerContact` for PAYMENTS; `router.portFor` for refunds.

Then PL3 (plan first). The owner's PL3 items so far:

- NOTIFY resend classes and the platform suppression list (PL2-D-65);
- the platform-issued support token, when a product first needs it (PL2-D-55).

**Local environment notes.**

- Start Docker with `nohup dockerd &`, then `docker start pgs2` (PostgreSQL 18 on 55433); use `IPB_TEST_PG_URL=postgres://postgres:pw@127.0.0.1:55433/postgres`.
- Docker Hub works; GHCR (Zitadel) and quay.io do not. Vendor documentation hosts are blocked, so vendor facts come from official SDKs on GitHub plus web search (PL2-D-64, PL2-D-66). Clones are in the session scratchpad.
- gitleaks 8.30.1 from GitHub releases, checked against the SHA in `ci.yml`. Run `gitleaks git --log-opts="origin/main..HEAD" .` before pushing. Build credential-shaped test values at run time; stubs use `stubCredential()`.
- Commit subjects are at most 100 characters (commitlint). Force-pushes are refused by the session's permission policy. Pass the exact 40-character head SHA to the squash merge.

**Open questions.** None. OWNER-QUESTIONS #1–#6 are answered (PL2-D-50, PL2-D-55, PL2-D-56, PL2-D-61, PL2-D-63, PL2-D-65).

## Working mode (PL2-D-41)

Continuous build: PL2 closed at gate A; now PL3, then PL4–PL6. Defaults taken for the owner are listed in `docs/OWNER-QUESTIONS.md` (#7–#17 open with defaults in use; #1–#6 answered). Threat model: `docs/security/threat-model.md` (PL2-D-43). CI: this repository is public, so its minutes are free (PL2-D-62); the budget rules bind the private product repositories. Public-content rules apply to everything written here.

## Next

- PL3 session 1: spike, then contracts and config (PL3 plan §12).

## PL2 session 7 (2026-10-27)

- `@infrabyx/connectors/payments`: `razorpay` (reference) and `cashfree` (alternative), test mode only, on the approved locked list P-01 to P-18 (PL2-D-66):
  - no live key outside prod/dr (P-03, adapters and env guard);
  - exact integer paise (P-04);
  - references derived from the idempotency key and vendor lookup before any retry (P-05);
  - refunds only with an approved R3 request for the same payload, read against the PA's refund list and never repeated (P-07);
  - unresolved pending refunds go to the human queue;
  - `kill.payments` (P-12);
  - raw-body webhook signatures (P-09);
  - read-only reconciliation (P-11).
- Router: `noFailover` method specs and `router.portFor(port, adapter)` so refunds, mandates and captures stay with their PA (P-08); `@IPB-01-AT-08` Razorpay → Cashfree proven on stubs.
- P-18 manifests `packages/connectors/marketplace/{razorpay,cashfree}.manifest.json` with a lint test.
- Hermetic legs: 29 PAYMENTS cases green on the Razorpay and Cashfree stubs; sandbox legs wait for the test accounts.
- Products: refunds need an approvals-engine view (`RefundApprovals`) and a maker request with payload `{ paymentId, amountMinor, reason }`; Cashfree needs a `customerContact` resolver; refunds of orders taken during failover go through `router.portFor("PAYMENTS", order.adapter)`.

## PL2 session 6 (2026-10-27)

- `@infrabyx/connectors` (subpaths `/email`, `/sms`, `/whatsapp`):
  - EMAIL `ses` (SES v2 ap-south-1, configuration set per brand, SNS events per C-13 with a timestamp window, reputation block as `IPB-PORT-002`) and `brevo` (GLOBAL with DPA reference, idempotencyKey and tag lookup, DKIM-checked failover target, bearer webhooks with Brevo's source ranges);
  - SMS `msg91` and `gupshup-sms` with a shared DLT registry (template, header, entity and variables checked before any request), CRQID, bearer or URL-token delivery reports, credentials never in URLs, failover msg91 → gupshup-sms through the router;
  - WHATSAPP `gupshup` and `meta-cloud`: 24-hour session window, marketing refused while `mkt.meta.enabled` is false (OWN-08), Meta `X-Hub-Signature-256` and handshake, rate card from configuration.
- `@infrabyx/contracts`: `IPB-API-018`; `WebhookRequestMeta` on messaging `verifyWebhook`; `WhatsappEvent.pricingCategory` and `errorCode`.
- `@infrabyx/crypto`: `verifyWebhookSecret` (C-19 in use). `@infrabyx/config`: `mkt.meta.enabled`, `int.sms.low_balance_credits`, `int.whatsapp.rate_card`.
- `@infrabyx/testing`: stub server and stubs for SES v2, Brevo, MSG91, Gupshup SMS and WhatsApp, Meta Graph; SNS test signer.
- Hermetic legs: EMAIL 32, SMS 23, WHATSAPP 27 cases green on the stubs and moto. All six adapters stay `unproven` until their sandbox legs run (IPB-DEV-04); vendor details marked [VERIFY] (PL2-D-64). Owner question #6 opened.
- Products: no migration; new settings above; WhatsApp and Brevo routing entries need a `dpa_ref`; Gupshup webhook URLs carry `ipb_token`, which ingress logs must redact.

## PL2 session 5 (2026-10-26)

- `@infrabyx/connectors`:
  - STORAGE `s3` and `minio`: Object Lock COMPLIANCE, write-once retention and refused overwrite or delete while retained (@IPB-01-AT-09), soft delete, AUDIT anchors survive a version delete (@IPB-02-AT-13), SSE-KMS with the class or tenant key (C-17), presigned URLs bound to method and content type, SHA-256 verified replication, cross-tenant keys refused; parity on moto 5.2.4 (@IPB-01-AT-10, S3-API level) (PL2-D-57);
  - QUEUE `bullmq` (Redis 7.4 and Valkey 8.1) and `pg-boss` (PostgreSQL 18, DML-only role): canary ≤ 5 s, idempotent enqueue, delay, backoff, DLQ and replay, cron, refusal of non-INTERNAL payloads (PL2-D-58, PL2-D-59);
  - WORKFLOW `temporal` and `temporal-cloud`: C-16 codec and encrypted failures, idempotent ids, deterministic replay, 32 KB reference path, input-class rule, worker helper (PL2-D-60).
- `@infrabyx/contracts`: `presign` options `{ bucketClass, contentType }`; KMS purpose `workflow`.
- New for products at gate A: migration `connectors/0003_pgboss.sql`; env `STORAGE_*`, `QUEUE_REDIS_URL`, `WORKFLOW_TEMPORAL_*` (plan §6.7–6.9); settings `int.storage.*`, `int.queue.*`, `int.workflow.*`.
- Owner answer (PL2-D-61): MinIO's last community release from quay.io by digest, else built from source. quay.io refused the pull from CI, so CI builds `RELEASE.2025-09-07T16-13-09Z` from source at a pinned commit and caches the binary; the MinIO-server leg proves presigned-URL enforcement; `minio` stays refused outside dev and test. PR-015 asks to replace MinIO in the catalogue; the production self-hosted alternative is a PL6 decision (SeaweedFS leading, Ceph RGW for bank on-premise).

## PL2 session 4 (2026-10-26)

- `@infrabyx/connectors`:
  - AUTHZ adapters `cerbos` (0.57.0) and `openfga` (v1.22.0) with the platform policy pack in `policy/`; one decision table proven on both engines, agents never decide (@IPB-02-AT-11), PDP failure denies (PL2-D-51, PL2-D-52);
  - IDENTITY adapters `keycloak` (26.8.1) and `zitadel` (v4.19.5) with a shared ES256 verifier, claim mapping, the `assertMfaForRoles` guard (IPB-SEC-001) and the revocation store on migration `0002_session_revocation` (PL2-D-53, PL2-D-54, PL2-D-56);
  - Keycloak leg walks the real login pages: first login forces a password change and TOTP enrolment (@IPB-02-31), the enrolment token is refused for ORG_ADMIN and the next TOTP login passes (@IPB-02-AT-02, API half), SCIM deactivation refuses old tokens (@IPB-02-05), back-channel logout, JWKS across an outage;
  - the Zitadel leg runs only in CI (GHCR).
- `@infrabyx/contracts`: `authenticate` takes the PKCE `codeVerifier`; id prefix `rvk`.
- `@infrabyx/testing`: Keycloak, OpenFGA and Zitadel images; `startNetwork()`.
- New for products at gate A: migration `connectors/0002_session_revocation.sql`; env `AUTH_ADAPTER`, `AUTH_ISSUER_URL`, `AUTH_CLIENT_ID`, `AUTH_ADMIN_CLIENT_ID` and the `AUTH_*` secrets from SECRETS (plan §6.5); settings `int.identity.*` and `int.authz.decision_cache_seconds`.
- Owner answers (26 Oct): impersonation stays off; a platform-issued, read-only, 60-minute, ledgered support token is planned in the phase that first needs it (PL2-D-55). Zitadel keeps MFA for every user; the API MFA guard stays on both IdPs (PL2-D-56).
- Field-encryption format v2 (OWNER-QUESTIONS #1, PL2-D-50) is already merged (#18, 7a36249), ahead of gate A.

## PL2 session 3 (2026-10-26)

- `@infrabyx/crypto`:
  - C-11 JWT/JWS verification on `node:crypto`, tested with RFC 7515 Appendix A and RFC 7520 §4 vectors, the negative cases and a `jose` differential test (`jose` is test-only and `ipb:check` enforces that);
  - C-13 Razorpay, Cashfree and Meta HMAC checks, plus Amazon SNS SignatureVersion 2 with pinned certificate hosts;
  - C-19 webhook secrets;
  - `LocalKms` honours the data-key AAD (PL2-D-48).
- `@infrabyx/contracts`: `KmsPort.generateDataKey(keyId, aad?)` (PL2-D-47).
- `@infrabyx/connectors`:
  - SECRETS adapters: `aws-sm` (platform CMK, CloudTrail audit) and `vault` (KV v2, dynamic PostgreSQL leases), plus `CachedSecrets` (PL2-D-46);
  - KMS adapters: `aws-kms` (encryption context, DIGEST signing, tenant CMKs, 30-day deletion) and `vault-transit` (PL2-D-47);
  - contract legs on moto 5.2.4 with a CloudTrail stub (PL2-D-45), LocalStack 4.12.0 and OpenBao 2.7.1; @IPB-01-AT-19 and @IPB-02-AT-15 re-run.
- `@infrabyx/testing`: OpenBao 2.7.1 test image.
- Open for the owner: OWNER-QUESTIONS #1, the field-envelope context (PL2-D-49).

## PL2 session 2 (2026-10-26)

- `@infrabyx/connectors` (first release at gate A, 0.1.0):
  - Router: data class raise-only, residency and recipient checks before any I/O; per-adapter circuit breaker (PL2-D-33); mode-aware failover with STORAGE writes failing fast; `AdapterFailedOver` and `AdapterRecovered` events; spans `port.<PORT>.<method>`.
  - Idempotency store: pending record first, vendor lookup, and a money call is never re-sent blind. It writes through `kernel.mutate` with ledger entries and seals results at CONFIDENTIAL and above (PL2-D-35).
  - Also: health registry (@IPB-01-AT-13), HTTPS egress client, inbound-webhook helpers.
  - Migration `connectors/0001_init.sql` (`idempotency_record`, forced RLS). `infrabyx-migrate` applies it whenever the package is installed, so products keep one migrate command (PL2-D-34; tenancy minor).
  - OBSERVABILITY `otel`: IPB-02-23 scrubber, C-21 hashed IDs, GenAI spans without content, and the `collector` and `otlp-direct` profiles proven identical against a Collector (PL2-D-38).
  - FEATURE_FLAG `unleash`: registry sync, governed boolean writes, and staleness-bounded freshness, so FlagService falls back to the snapshot and then the safe state (@IPB-02-AT-20 against Unleash). The `config-db` alternative wraps the PL1 provider (PL2-D-39).
  - `test:contract -- --port <PORT>` runs the port-contract legs (PL2-D-40).
- `@infrabyx/crypto`: `telemetryIdHasher` / `deriveSubKey` (C-21 HKDF label `ipb/telemetry-id/v1`, PL2-D-36).
- `@infrabyx/testing`: OTel Collector 0.162.0 and Unleash 8.2.0 test images; `startService` `files` and `configure`.
- OpenTelemetry pinned to the 6 October release set because of the 7-day rule (PL2-D-37).
- PL2-D-07 answered: version PR #14 was opened with `NPM_PUBLISH_TOKEN`, and its `ci` and `port-contract` runs started on their own and passed. The organisation setting "Allow GitHub Actions to create and approve pull requests" is therefore **not needed** for the release flow; it matters only when `GITHUB_TOKEN` opens the PR. The owner may switch it off. #14 stays open until gate A (PL2-D-31).

## PL2 session 1 (2026-10-26)

- Spike on every `[VERIFY]` item: Temporal, BullMQ and Cerbos SDKs work on Node 24.22.1; Valkey works; pg-boss works through a transaction pooler (explicit job ids, PL2-D-28); moto signs KMS `DIGEST` wrongly, so KMS uses LocalStack 4.12.0, and SES needs a small stub (PL2-D-29); Zitadel v4.20.0 has ES256 web keys, token exchange and SCIM Users; AWS KMS ML-DSA in ap-south-1 is unconfirmed and stays `planned`.
- `@infrabyx/contracts`: the thirteen PL2 port interfaces, payload data-class annotations (raise-only, PL2-D-03), delivery recipients (IPB-DEV-05), P-04 paise conversion, `checkRouting`, connector manifest schema (P-18).
- `@infrabyx/config`: 53 new port keys (156 in total), `loadRoutingFile`, `infrabyx-routing check`, reference `local` and `ci` routing files, `sandbox-status.json`.
- `@infrabyx/testing`: leg- and capability-aware contract suites, pinned `TEST_IMAGES`, the sandbox-leg gate, fault-injection proxy, ESLint `ipb/port-data-class`.
- CI: `port-contract.yml` (per-port path filters, nightly, before each release) and `routing-check` in `verify`.
- Supply chain (PL2-D-32, tightens IPB-02-33 to 7 days): pnpm `minimumReleaseAge` 7 days (`@infrabyx/*` exempt), `trustPolicy: no-downgrade`, `blockExoticSubdeps`; Renovate 7 days; lefthook pinned to 2.2.1 (npm provenance); too-new pins moved back (turbo 2.11.9, typescript-eslint 8.71.2, four transitive packages).

## CI minutes (PL2-D-13)

Since 27 Oct 2026 this repository is public and its Actions minutes are free (PL2-D-62); the budget rules now bind the six private product repositories. The table below is kept as history and is no longer updated. Before that: 2,000 a month on GitHub Free, shared by seven repositories, with a 1,000-minute budget here (PL2-D-41).

| Month   | Run                                                         | Minutes (billed, approx.) | Month to date |
| ------- | ----------------------------------------------------------- | ------------------------- | ------------- |
| 2026-10 | used before PL2 (owner, 26 Oct)                             | 88                        | 88            |
| 2026-10 | PR #12, 4 pushes × (verify 3 + integration 2)               | 20                        | 108           |
| 2026-10 | PR #13, 3 pushes × (ci 5 + port-contract 1)                 | 18                        | 126           |
| 2026-10 | main after #13 (ci 5, release 2)                            | 7                         | 133           |
| 2026-10 | version PR #14 (ci 5, port-contract 1)                      | 6                         | 139           |
| 2026-10 | PR #15 (ci 5, port-contract 2 legs 4)                       | 9                         | 148           |
| 2026-10 | main after #15 (ci 5, release 2)                            | 7                         | 155           |
| 2026-10 | PR #16 (ci 5, port-contract 2 legs 4)                       | 9                         | 164           |
| 2026-10 | main after #16 (ci 5, release 2)                            | 7                         | 171           |
| 2026-10 | PR #17, 2 pushes (ci 5, port-contract 4 legs ~10), estimate | 30                        | 201           |
| 2026-10 | main after #17 (ci 5, release 2)                            | 7                         | 208           |
| 2026-10 | PR #18 (ci 5, port-contract KMS ~3), estimate               | 8                         | 216           |
| 2026-10 | main after #18 (ci 5, release 2)                            | 7                         | 223           |
| 2026-10 | PR #19, 4 pushes (ci 6, port-contract 6 legs ~16), estimate | 88                        | 311           |
| 2026-10 | main after #19 (ci 5, release 2)                            | 7                         | 318           |
| 2026-10 | PR #20, 2 pushes (ci 6, port-contract 9 legs ~20), estimate | 52                        | 370           |
| 2026-10 | main after #20 (ci 5, release 2)                            | 7                         | 377           |
| 2026-10 | PR #21, 2 pushes (ci 6, port-contract 9 legs ~22), estimate | 56                        | 433           |
| 2026-10 | main after #21 (ci 5, release 2)                            | 7                         | 440           |

## Owner decisions

- 2026-10-26: owner decisions OWN-01…14 recorded in `docs/DECISIONS.md`.

## Blocked / waiting on owner

- Owner accounts for PL2 sandbox legs: none blocks the PL2 publish (IPB-DEV-04). Latest-by dates and steps in `docs/runbooks/README.md`: GitHub Team and the `sandbox` environment, Temporal Cloud (Mumbai), messaging vendors and DLT, Razorpay and Cashfree test accounts, the AWS Organization and sandbox account.
- Before production: replace `NPM_PUBLISH_TOKEN` in `release.yml` with a dedicated GitHub App token (PL1-D-21, IPB-02-08).
- Platform requests PR-002 to PR-014 open for the IPB editor (`docs/platform-requests.md`).
- `main` ruleset: apply after the GitHub Team upgrade with checks, signed commits and linear history only (PL2-D-12, `infra/policy/github/rulesets.json`).
