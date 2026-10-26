# STATUS — infrabyx-platform

Updated: 2026-10-26

| Item                  | Value                                                                                                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Current phase         | **PL2 session 2 of 8** (D-11): `connectors` core and migration, OBSERVABILITY (`otel`) and FEATURE_FLAG (`unleash`, `config-db`) in review. Session 1 merged (#13). Plan approved 26 Oct 2026 with conditions (PL2-D-05) |
| Spec of record        | `docs/ipb/` (IPB v1.0 + IPB-14 runbook), `docs/ecosystem/` (Spec v1.2)                                                                                                                                                   |
| Packages              | Published to GitHub Packages: 0.1.0 of contracts, crypto, config, tenancy, audit, seed, testing; the 15 later-phase scaffolds (0.0.0, kept) are now private until their phase (PL1-D-20)                                 |
| Last exit gate passed | PL1 (2026-10-26): PR #8 (code) and PR #10 (release), CI green; release run 10 published                                                                                                                                  |
| Working branch        | `claude/funny-cori-6upyrr` (still on GitHub when PL2 started; fast-forwarded from the merged #11 head, not recreated)                                                                                                    |

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

## Next

- PL2 session 3 (D-11 order): SECRETS, KMS and the crypto additions (JWT/JWS verification C-11, vendor HMAC C-13, SNS signatures), with the LocalStack and moto hermetic legs (PL2-D-29).

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

Allowance: 2,000 a month on Free, 3,000 on Team. The owner is warned at 70 % (1,400 on Free, 2,100 on Team). Billing rounds each job up to whole minutes.

| Month   | Run                                           | Minutes (billed, approx.) | Month to date |
| ------- | --------------------------------------------- | ------------------------- | ------------- |
| 2026-10 | used before PL2 (owner, 26 Oct)               | 88                        | 88            |
| 2026-10 | PR #12, 4 pushes × (verify 3 + integration 2) | 20                        | 108           |
| 2026-10 | PR #13, 3 pushes × (ci 5 + port-contract 1)   | 18                        | 126           |
| 2026-10 | main after #13 (ci 5, release 2)              | 7                         | 133           |
| 2026-10 | version PR #14 (ci 5, port-contract 1)        | 6                         | 139           |

## Owner decisions

- 2026-10-26: owner decisions OWN-01…14 recorded in `docs/DECISIONS.md`; pending confirmation: intern stipend upper bound (₹4 LPA assumed).

## Blocked / waiting on owner

- Owner accounts for PL2 sandbox legs: none blocks the PL2 publish (IPB-DEV-04). Latest-by dates and steps in `docs/runbooks/README.md`: GitHub Team and the `sandbox` environment, Temporal Cloud (Mumbai), messaging vendors and DLT, Razorpay and Cashfree test accounts, the AWS Organization and sandbox account.
- Before production: replace `NPM_PUBLISH_TOKEN` in `release.yml` with a dedicated GitHub App token (PL1-D-21, IPB-02-08).
- Platform requests PR-002 to PR-014 open for the IPB editor (`docs/platform-requests.md`).
- `main` ruleset: apply after the GitHub Team upgrade with checks, signed commits and linear history only (PL2-D-12, `infra/policy/github/rulesets.json`).
