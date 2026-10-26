# STATUS — infrabyx-platform

Updated: 2026-10-26

| Item                  | Value                                                                                                                                                                                                                        |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current phase         | **PL2 session 1 of 8** (D-11): spike done (`docs/phases/PL2-spike.md`); contracts, config keys, routing schema, testing harness and the port-contract CI job in review. Plan approved 26 Oct 2026 with conditions (PL2-D-05) |
| Spec of record        | `docs/ipb/` (IPB v1.0 + IPB-14 runbook), `docs/ecosystem/` (Spec v1.2)                                                                                                                                                       |
| Packages              | Published to GitHub Packages: 0.1.0 of contracts, crypto, config, tenancy, audit, seed, testing; the 15 later-phase scaffolds (0.0.0, kept) are now private until their phase (PL1-D-20)                                     |
| Last exit gate passed | PL1 (2026-10-26): PR #8 (code) and PR #10 (release), CI green; release run 10 published                                                                                                                                      |
| Working branch        | `claude/funny-cori-6upyrr` (still on GitHub when PL2 started; fast-forwarded from the merged #11 head, not recreated)                                                                                                        |

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

- PL2 session 2: `connectors` core (router, circuit breaker, health registry, egress client, idempotency store and migration `connectors/0001_init.sql`), OBSERVABILITY (OTel) and FEATURE_FLAG (Unleash + config-db).

## PL2 session 1 (2026-10-26)

- Spike on every `[VERIFY]` item: Temporal, BullMQ and Cerbos SDKs work on Node 24.22.1; Valkey works; pg-boss works through a transaction pooler (explicit job ids, PL2-D-28); moto signs KMS `DIGEST` wrongly, so KMS uses LocalStack 4.12.0, and SES needs a small stub (PL2-D-29); Zitadel v4.20.0 has ES256 web keys, token exchange and SCIM Users; AWS KMS ML-DSA in ap-south-1 is unconfirmed and stays `planned`.
- `@infrabyx/contracts`: the thirteen PL2 port interfaces, payload data-class annotations (raise-only, PL2-D-03), delivery recipients (IPB-DEV-05), P-04 paise conversion, `checkRouting`, connector manifest schema (P-18).
- `@infrabyx/config`: 53 new port keys (156 in total), `loadRoutingFile`, `infrabyx-routing check`, reference `local` and `ci` routing files, `sandbox-status.json`.
- `@infrabyx/testing`: leg- and capability-aware contract suites, pinned `TEST_IMAGES`, the sandbox-leg gate, fault-injection proxy, ESLint `ipb/port-data-class`.
- CI: `port-contract.yml` (per-port path filters, nightly, before each release) and `routing-check` in `verify`.

## CI minutes (PL2-D-13)

Allowance: 2,000 a month on Free, 3,000 on Team. The owner is warned at 70 % (1,400 on Free, 2,100 on Team). Billing rounds each job up to whole minutes.

| Month   | Run                                           | Minutes (billed, approx.) | Month to date |
| ------- | --------------------------------------------- | ------------------------- | ------------- |
| 2026-10 | used before PL2 (owner, 26 Oct)               | 88                        | 88            |
| 2026-10 | PR #12, 4 pushes × (verify 3 + integration 2) | 20                        | 108           |

## Owner decisions

- 2026-10-26: owner decisions OWN-01…14 recorded in `docs/DECISIONS.md`; pending confirmation: intern stipend upper bound (₹4 LPA assumed).

## Blocked / waiting on owner

- Owner accounts for PL2 sandbox legs: none blocks the PL2 publish (IPB-DEV-04). Latest-by dates and steps in `docs/runbooks/README.md`: GitHub Team and the `sandbox` environment, Temporal Cloud (Mumbai), messaging vendors and DLT, Razorpay and Cashfree test accounts, the AWS Organization and sandbox account.
- After the next version PR runs CI by itself: I report whether the organisation setting "Allow GitHub Actions to create and approve pull requests" is still needed (PL2-D-07).
- Before production: replace `NPM_PUBLISH_TOKEN` in `release.yml` with a dedicated GitHub App token (PL1-D-21, IPB-02-08).
- Platform requests PR-002 to PR-014 open for the IPB editor (`docs/platform-requests.md`).
- `main` ruleset: apply after the GitHub Team upgrade with checks, signed commits and linear history only (PL2-D-12, `infra/policy/github/rulesets.json`).
