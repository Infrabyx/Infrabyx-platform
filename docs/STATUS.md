# STATUS — infrabyx-platform

Updated: 2026-10-26

| Item                  | Value                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Current phase         | **PL1 — core kernel: exit gate (PR open, awaiting CI and merge)** (`docs/phases/PL1-plan.md`, approved 2026-10-26) |
| Spec of record        | `docs/ipb/` (IPB v1.0 + IPB-14 runbook), `docs/ecosystem/` (Spec v1.2)                                             |
| Packages              | 22 scaffolded at 0.0.0, none published; 0.1.0 of the seven PL1 packages at the PL1 exit gate (PL1-D-02)            |
| Last exit gate passed | PL0 (accepted by owner 2026-10-26)                                                                                 |
| Working branch        | `claude/funny-cori-6upyrr` (PR #7 merged; branch reused for PL1 because the session cannot delete branches)        |

## Done

- PL0 complete (PR #1); Renovate fixes (PR #6); PL1 plan approved and merged (PR #7) with decisions PL1-D-02 to PL1-D-06 and cryptography choices PL1-C-01.
- pnpm 10.34.7 (ADR-0002 accepted, IPB-DEV-02); `.npmrc` carries no credentials (PL1-D-01).
- `@infrabyx/contracts`: data classes, IDs, environments, roles, tiers, 99 error codes, CloudEvents envelopes, module manifest, kernel interfaces, five port contracts.
- `@infrabyx/crypto`: single cryptography call-site (IPB-12-05), enforced by `ipb/no-direct-crypto`.
- `@infrabyx/config`: env loader and guards (exit 78), settings registry from `settings-tree.yaml` (103 keys), settings service, flag registry (`kill.*`, 39 `fut.*`) with safe state, migration `config/0001_init.sql`. Unit tests tagged @IPB-11-AT-01/06/07, @IPB-01-AT-12, @IPB-07-AT-04/05/06, @IPB-02-AT-20, @IPB-09-AT-09/10, @IPB-12-AT-01.

- `@infrabyx/tenancy`: context from verified claims, PgKernel (SET LOCAL, statement guard, ledger-required commit), outbox/inbox, approvals engine, break-glass, impersonation, field encryption, masking, `infrabyx-migrate`, `infrabyx-rls-lint`, Drizzle and NestJS adapters, migration `tenancy/0001_init.sql`. Unit tests and 16 PostgreSQL integration tests (@NN-01, @NN-45, @NN-18, @IPB-02-AT-04/08/10/11/12, @IPB-01-AT-16).

- `@infrabyx/audit`: trigger-computed hash chain (PL1-C-01), append-only for every role, verifier, corrections, signed anchors, migration `audit/0001_init.sql`. Tests @IPB-02-AT-15 (1,000-entry tamper), @NN-02, @NN-45 (20 concurrent writers), anchors verifiable with the public key alone.

- `@infrabyx/seed`: refusal-first CLI, deterministic idempotent framework, synthetic validator, platform seed, purge, credentials, lefthook pre-commit guard. Tests @IPB-11-AT-02/03/04/05, determinism across databases, idempotency, purge precision.

- `@infrabyx/testing`: `startPostgres`, context builders, port fakes, NN suites run against the PL1 packages, port contract harness, `infrabyx-migration-lint` (every IPB-09 §09.4.6 rule, @IPB-09-AT-11/12, @IPB-01-AT-11), `infrabyx-at-report`, ESLint IPB plugin moved to `@infrabyx/testing/eslint` (PL1-D-02).

- Exit gate: CI gains migration-lint, registry-check, dev-keys-check, env-example-check and an `integration` job (PostgreSQL 18 service: migrate, rls-lint, test:int, at-report). PL0 changeset narrowed to the seven PL1 packages so only they publish 0.1.0.

## Next

- Merge the PL1 PR; `release.yml` updates the held "chore: version packages" PR to 0.1.0 of the seven packages; merge that to publish (PL1-D-02 / D-06). Then PL2 plan.
- testing (database integration tests for config run from testing), then the PL1 exit gate (CI job for `test:int` with a PostgreSQL 18 service, rls-lint, migration-lint).

## Owner decisions

- 2026-10-26: owner decisions OWN-01…14 recorded in `docs/DECISIONS.md`; pending confirmation: intern stipend upper bound (₹4 LPA assumed).

## Blocked / waiting on owner

- Platform requests PR-002 to PR-006 open for the IPB editor (`docs/platform-requests.md`).
- Branch `claude/funny-cori-6upyrr` could not be deleted from the session (GitHub returned 403); owner to delete after the PL1 PR merges.
- `main` ruleset enforcement waits on the GitHub plan upgrade (PL0-D-07).
