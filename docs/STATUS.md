# STATUS — infrabyx-platform

Updated: 2026-10-26

| Item                  | Value                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------- |
| Current phase         | **PL1 — core kernel: implementation in progress** (`docs/phases/PL1-plan.md`, approved 2026-10-26)          |
| Spec of record        | `docs/ipb/` (IPB v1.0 + IPB-14 runbook), `docs/ecosystem/` (Spec v1.2)                                      |
| Packages              | 22 scaffolded at 0.0.0, none published; 0.1.0 of the seven PL1 packages at the PL1 exit gate (PL1-D-02)     |
| Last exit gate passed | PL0 (accepted by owner 2026-10-26)                                                                          |
| Working branch        | `claude/funny-cori-6upyrr` (PR #7 merged; branch reused for PL1 because the session cannot delete branches) |

## Done

- PL0 complete (PR #1); Renovate fixes (PR #6); PL1 plan approved and merged (PR #7) with decisions PL1-D-02 to PL1-D-06 and cryptography choices PL1-C-01.
- pnpm 10.34.7 (ADR-0002 accepted, IPB-DEV-02); `.npmrc` carries no credentials (PL1-D-01).
- `@infrabyx/contracts`: data classes, IDs, environments, roles, tiers, 99 error codes, CloudEvents envelopes, module manifest, kernel interfaces, five port contracts.
- `@infrabyx/crypto`: single cryptography call-site (IPB-12-05), enforced by `ipb/no-direct-crypto`.
- `@infrabyx/config`: env loader and guards (exit 78), settings registry from `settings-tree.yaml` (103 keys), settings service, flag registry (`kill.*`, 39 `fut.*`) with safe state, migration `config/0001_init.sql`. Unit tests tagged @IPB-11-AT-01/06/07, @IPB-01-AT-12, @IPB-07-AT-04/05/06, @IPB-02-AT-20, @IPB-09-AT-09/10, @IPB-12-AT-01.

## Next

- `@infrabyx/tenancy` (kernel, RLS, outbox, approvals, break-glass, impersonation, `infrabyx-migrate`), then audit, seed, testing (database integration tests for config run from testing), then the PL1 exit gate.

## Owner decisions

- 2026-10-26: owner decisions OWN-01…14 recorded in `docs/DECISIONS.md`; pending confirmations: CIN exact digits, Delhi office unit/PIN, intern stipend upper bound.

## Blocked / waiting on owner

- Platform requests PR-002 to PR-006 open for the IPB editor (`docs/platform-requests.md`).
- Branch `claude/funny-cori-6upyrr` could not be deleted from the session (GitHub returned 403); owner to delete after the PL1 PR merges.
- `main` ruleset enforcement waits on the GitHub plan upgrade (PL0-D-07).
