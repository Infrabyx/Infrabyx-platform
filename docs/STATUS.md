# STATUS — infrabyx-platform

Updated: 2026-10-26

| Item                  | Value                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------- |
| Current phase         | **PL1 — core kernel: plan written, awaiting owner approval** (`docs/phases/PL1-plan.md`) |
| Spec of record        | `docs/ipb/` (IPB v1.0 + IPB-14 runbook), `docs/ecosystem/` (Spec v1.2)                   |
| Packages              | 22 scaffolded at 0.0.0, none published (version PR held until PL1, decision O7)          |
| Last exit gate passed | PL0 (accepted by owner 2026-10-26)                                                       |

## Done

- PL0 complete: toolchain, CI governance checks, policy files (PR #1). Owner accepted 2026-10-26.
- Renovate fixed after PR #5 (PR #6): node and pnpm majors only through an ADR, even from security alerts; neither automerged; patch automerge waits for CI (IPB-02-36); new versions wait 3 days (IPB-02-33). PR #5 closed unmerged with the advisory finding.
- ADR-0002 (pnpm 10) proposed: pnpm 9.15.4 and 9.15.9 (last 9.x) carry 25 advisories, 12 high, none fixed in 9.x.
- PL1 plan: IPB-01, IPB-02, IPB-07, IPB-11 read in full; `docs/phases/PL1-plan.md` covers the seven packages, data model, migrations, tests by IPB ID, stubs, exit gate, 19 decisions and 10 cryptography choices.

## Next

- Owner: approve `docs/phases/PL1-plan.md`, answer decisions D-01 to D-13 (§13) and approve cryptography choices C-01 to C-10 (§14).
- Owner: decide ADR-0002 (pnpm 10) before PL1 code, so lockfiles are built once (D-08).
- Then implement PL1 package by package in the plan's order: contracts, crypto, config, tenancy, audit, seed, testing.

## Owner decisions
- 2026-10-26: owner decisions OWN-01…14 recorded in `docs/DECISIONS.md`; pending confirmation: intern stipend upper bound (₹4 LPA assumed).

## Blocked / waiting on owner

- PL1 plan approval, including the locked-list cryptography choices.
- D-09: the source of the NN-01/02/45 test IDs named in IPB-14 §14.3.
- D-10: the role list in "brief §3", which is not in this repository.
- `main` ruleset enforcement waits on the GitHub plan upgrade (PL0-D-07).
