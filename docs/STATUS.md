# STATUS — infrabyx-platform

Updated: 2026-10-26

| Item                  | Value                                                                                                    |
| --------------------- | -------------------------------------------------------------------------------------------------------- |
| Current phase         | **PL0 complete** (pending exit-gate confirmation on `main` after PR #1 merges) — next **PL1**            |
| Spec of record        | `docs/ipb/` (IPB v1.0 + IPB-14 runbook), `docs/ecosystem/` (Spec v1.2)                                   |
| Packages              | 22 scaffolded at 0.0.0, none published (first Changeset pending; version PR held until PL1, decision O7) |
| Last exit gate passed | PL0 — see `docs/phases/PL0-plan.md` §3.3                                                                 |

## Done

- Repository scaffold: monorepo, Node 24.22.1 pin, CI and release workflows, 22 package folders, docs.
- PL0 (branch `claude/funny-cori-6upyrr`, PR #1): `pnpm-lock.yaml`; ESLint 10 flat config with IPB placeholder rules (`vendor-import`, `schema-boundary`, `no-process-env`) under `infra/policy/eslint`; Vitest 4; Prettier; Turborepo inputs/outputs; Renovate per IPB-01 §01.4.1.2; SHA-pinned CI/release workflows with single-entry Node matrix; CI steps `pin-check`, `secret-scan` (gitleaks), `spec-readonly`, `commitlint`, `lint`, `typecheck`, `build`, `unit`, `policy-rules`, `licence`, `ipb-check`, `changeset-required`, `pr-checklist`; full IPB-09 PR template; `infra/policy/github/rulesets.json`; `infra/docker/BASE_IMAGES.md`; `docs/adr/` (ADR-0001 toolchain majors); `docs/platform-requests.md`; first Changeset. Owner: team `infrabyx/platform-owners`, environments, Renovate app and `NPM_PUBLISH_TOKEN` in place; `main` ruleset deferred (PL0-D-07).

## Next

- PL1 (IPB-14 §14.3): read IPB-01, IPB-02, IPB-07 (settings registry), IPB-11 in full; write `docs/phases/PL1-plan.md` for `contracts`, `config`, `tenancy`, `audit`, `crypto`, `seed`, `testing`; RLS lint; NN tests NN-01/02/45 pattern. Stop for approval before code.
- Owner: apply `infra/policy/github/rulesets.json` when the organisation moves to GitHub Team; merge Renovate's onboarding PR when it opens; leave the "chore: version packages" PR open until PL1 publishes 0.1.0 (O7).

## Blocked / waiting on owner

- None for PL1 planning. `main` ruleset enforcement waits on the GitHub plan upgrade (PL0-D-07).
