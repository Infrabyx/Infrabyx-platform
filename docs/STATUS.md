# STATUS — infrabyx-platform

Updated: 2026-10-26

| Item                  | Value                                                                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current phase         | **PL1 complete — PL2 next** (`docs/phases/PL1-plan.md`, exit gate passed 2026-10-26)                                                                            |
| Spec of record        | `docs/ipb/` (IPB v1.0 + IPB-14 runbook), `docs/ecosystem/` (Spec v1.2)                                                                                          |
| Packages              | Published to GitHub Packages: 0.1.0 of contracts, crypto, config, tenancy, audit, seed, testing; the 15 later-phase scaffolds also went out at 0.0.0 (PL1-D-19) |
| Last exit gate passed | PL1 (2026-10-26): PR #8 (code) and PR #10 (release), CI green; release run 10 published                                                                         |
| Working branch        | `claude/funny-cori-6upyrr` (reused; the session cannot delete branches)                                                                                         |

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

## Next

- PL2 — ports and reference adapters (IPB-14 §14.3): `connectors` for the Tier-0 ports (IDENTITY Keycloak, AUTHZ Cerbos, STORAGE S3 + MinIO, QUEUE Redis/BullMQ, WORKFLOW Temporal, SECRETS AWS SM + Vault, KMS, EMAIL SES + Brevo, SMS, WHATSAPP, PAYMENTS Razorpay + one alternative, FEATURE_FLAG Unleash, OBSERVABILITY OTel), `provider_routing`, contract tests green for the reference and one alternative each. First step: `docs/phases/PL2-plan.md` for owner approval, before any code. PAYMENTS is on the locked list.

## Owner decisions

- 2026-10-26: owner decisions OWN-01…14 recorded in `docs/DECISIONS.md`; pending confirmation: intern stipend upper bound (₹4 LPA assumed).

## Blocked / waiting on owner

- Confirm the seven 0.1.0 packages under the organisation's Packages tab (the session has no access to it; the release log reports each as published).
- PL1-D-19: decide whether to delete the fifteen 0.0.0 scaffold versions from GitHub Packages (harmless placeholders; deletion is an owner action).
- Repository Settings → Actions → General → Workflow permissions → "Allow GitHub Actions to create and approve pull requests", and a GitHub App token for the changesets action (PL1-D-18).
- Delete branch `claude/funny-cori-6upyrr` when convenient (the session gets 403).
- Platform requests PR-002 to PR-006 open for the IPB editor (`docs/platform-requests.md`).
- `main` ruleset enforcement waits on the GitHub plan upgrade (PL0-D-07).
