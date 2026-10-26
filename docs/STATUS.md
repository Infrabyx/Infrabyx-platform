# STATUS — infrabyx-platform

Updated: 2026-10-26

| Item                  | Value                                                                                                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current phase         | **PL2 session 4 of 8** (IDENTITY and AUTHZ) in its PR; sessions 1–3 (#13, #15, #17), the working-mode PR (#16) and field-encryption v2 (#18) merged. Continuous build mode (PL2-D-41)    |
| Spec of record        | `docs/ipb/` (IPB v1.0 + IPB-14 runbook), `docs/ecosystem/` (Spec v1.2)                                                                                                                   |
| Packages              | Published to GitHub Packages: 0.1.0 of contracts, crypto, config, tenancy, audit, seed, testing; the 15 later-phase scaffolds (0.0.0, kept) are now private until their phase (PL1-D-20) |
| Last exit gate passed | PL1 (2026-10-26): PR #8 (code) and PR #10 (release), CI green; release run 10 published                                                                                                  |
| Working branch        | `claude/funny-cori-6upyrr` (GitHub deletes it after each squash merge; it is re-pushed from `main` for the next session)                                                                 |

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

## Handover (2026-10-26, end of the session that built PL2 sessions 2 and 3)

**Done.** PL2 sessions 1–3 are built:

- #13 (contracts, config, testing harness);
- #15 (connectors core, OBSERVABILITY, FEATURE_FLAG);
- #16 (working mode, threat model, CI budget);
- #17 (crypto C-11/C-13/C-19, SECRETS, KMS).

Nothing from PL2 is published yet. Version PR #14 collects every changeset and is merged only at gate A (PL2-D-31).

**Branch and PR state.**

- PR #17 (`claude/funny-cori-6upyrr`, head `b46ca93` before this handover commit) is open as a draft.
- Its first CI run finished at 16:58 UTC. This session lost its GitHub tools before it could read the result and merge.
- **First step next session:** read #17's checks on the current head. If every check is green, mark it ready and squash-merge under PL2-D-19; if any is red, fix and push.
- A check-in is armed for 17:44 UTC (`trig_019rvFoGxK6x5H3osTVR3Bfr`).
- After the merge: branch again from `main` as `claude/funny-cori-6upyrr`.

**Next: PL2 session 4.** IDENTITY (`keycloak`, `zitadel`) and AUTHZ (`cerbos`, `openfga`); plan §6.5 and §6.6, plus C-11 and C-12.

- **Verifier:** `verifyJwt` and `JwksCache` from `@infrabyx/crypto` are ready. Allow-lists per issuer: ES256 for both IdPs (C-12, spike row "Zitadel ES256").
- **Images:** Cerbos 0.57.0 is pinned. Keycloak (quay.io), Zitadel (GHCR) and OpenFGA (Docker Hub) still need images:
  - pin each by digest, at least 7 days old (PL2-D-32), and add it to `TEST_IMAGES` and `infra/docker/TEST_IMAGES.md`;
  - GHCR and quay.io are unreachable from the build sandbox but work on GitHub runners (PL2-D-30). If a Keycloak or Zitadel leg cannot be run locally, run it in CI and say so in the PR.
- **Contract cases:** plan §6.5 and §6.6, including @IPB-02-AT-02 (API half), @IPB-02-AT-11 (Cerbos policy leg), `IPB-SEC-005` no-disclosure, and PDP-down means deny.

**Local environment notes.**

- Docker Hub rate-limits anonymous pulls here. moto, LocalStack 4.12, OpenBao, Unleash and the Collector are cached locally.
- `startPostgres` pulls `postgres:18` by tag. Locally, set `IPB_TEST_PG_URL=postgres://postgres:pw@127.0.0.1:55433/postgres` (container `pgs2`).
- Downloaded binaries (e.g. gitleaks) are blocked by the sandbox policy; CI runs the secret scan.

**Open questions.** None. OWNER-QUESTIONS #1 was answered on 26 Oct 2026: field-encryption format v2 (PL2-D-50) has its own PR before session 4.

## Working mode (PL2-D-41)

Continuous build through PL2 sessions 3–8, gate A, then PL3–PL6. Defaults taken for the owner are listed in `docs/OWNER-QUESTIONS.md` (none open; #1 answered as PL2-D-50, #2 as PL2-D-55, #3 as PL2-D-56). Threat model: `docs/security/threat-model.md` (PL2-D-43). CI budget: under 1,000 minutes a month for this repository; the full port-contract matrix runs weekly and before releases, nightly only for changed ports (PL2-D-44).

## Next

- PL2 session 5 (D-11 order): STORAGE (`s3`, `minio`), QUEUE (`bullmq`, `pg-boss`), WORKFLOW (`temporal`, `temporal-cloud`).

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

Allowance: 2,000 a month on GitHub Free, shared by seven repositories; this repository's budget is **1,000 a month** (PL2-D-41). The owner is told before this repository passes 1,000, with a warning at 70 % (700). Billing rounds each job up to whole minutes.

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

## Owner decisions

- 2026-10-26: owner decisions OWN-01…14 recorded in `docs/DECISIONS.md`; pending confirmation: intern stipend upper bound (₹4 LPA assumed).

## Blocked / waiting on owner

- Owner accounts for PL2 sandbox legs: none blocks the PL2 publish (IPB-DEV-04). Latest-by dates and steps in `docs/runbooks/README.md`: GitHub Team and the `sandbox` environment, Temporal Cloud (Mumbai), messaging vendors and DLT, Razorpay and Cashfree test accounts, the AWS Organization and sandbox account.
- Before production: replace `NPM_PUBLISH_TOKEN` in `release.yml` with a dedicated GitHub App token (PL1-D-21, IPB-02-08).
- Platform requests PR-002 to PR-014 open for the IPB editor (`docs/platform-requests.md`).
- `main` ruleset: apply after the GitHub Team upgrade with checks, signed commits and linear history only (PL2-D-12, `infra/policy/github/rulesets.json`).
