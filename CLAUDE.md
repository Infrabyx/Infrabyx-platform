# CLAUDE.md — infrabyx-platform

## What this repository is

The shared platform for all Infrabyx products. It implements the Infrabyx Platform Baseline Standard (IPB) v1.0 as publishable packages `@infrabyx/*` on GitHub Packages, plus a reference application and infrastructure modules. Products (Udofin, Finbyx, LawDocs, LawDocsComply, Equator, Operations Hub) install these packages instead of rebuilding tenancy, audit, config, rules, workflow, notify, connectors, AI gateway, Vidhi, CMS, brand, consent, help, trust, feedback, export, UI, accessibility and seed tooling.

## Spec of record (read-only)

- `docs/ipb/00_README.md` then IPB-01 … IPB-13; `docs/ipb/IPB-14_Platform_Build_Runbook.md` is the phase plan (PL0–PL6, §14.3) and package list (§14.2).
- `docs/ecosystem/infrabyx-integration-spec-v1.2.md` for cross-product contracts (prevails for events, identity, billing, consent).
- Precedence on conflict: IPB → Ecosystem Spec → this file → `docs/DECISIONS.md`.
- **Never edit anything under `docs/ipb/` or `docs/ecosystem/`.** A needed change is written to `docs/platform-requests.md` for the owner.

## Locked stack and conventions

Node.js 24.22.1 (`.nvmrc`, `engines`, Dockerfiles, CI; no other version without a dated ADR), pnpm 10 (exact pin in `packageManager`; ADR-0002, deviation IPB-DEV-02 from IPB-01-05's pnpm 9) + Turborepo, TypeScript strict, ESM. NestJS 11 modular monolith patterns (module = PostgreSQL schema = bounded context), Next.js 16 for UI packages and the reference app, Expo SDK 57 where mobile is touched. PostgreSQL 16+ (18 preferred) with enforced RLS is the only database engine; Drizzle ORM; pgvector. Every external capability sits behind an IPB-01 port with a reference adapter and at least one alternative kept green in CI; vendor SDKs are imported only inside `packages/connectors/`. Secrets never in environment variables in production (SECRETS port). Settings are registered in `packages/config` before code reads them. Every mutation writes the hash-chained audit ledger in the same transaction. Vidhi agents are makers only; the IPB-03 locked-action list is enforced in the kernel, not by callers.

## Session rules

- Start: read `CLAUDE.md`, `docs/STATUS.md`, `docs/ipb/00_README.md`; then the IPB files the current phase names.
- Each phase: write `docs/phases/PLn-plan.md` (interfaces, data model, migrations, tests by IPB ID, stubs, exit-gate checklist, owner decisions needed) and **stop for the owner's approval before writing code**. Implement; commit after each package; one Changeset per changed package; stop at the exit gate (IPB-09 required checks + that package's `@IPB-..-AT-..` tests).
- End: update `docs/STATUS.md` (current phase, done, next, blocked).
- When the spec is silent on a small point: make the assumption most consistent with the IPB, log it in `docs/DECISIONS.md` (date, ID, decision, reason, spec section) and continue. **Stop and ask** for anything on a locked list: payments and money movement, cryptography choices, data deletion or retention changes, production configuration, Vidhi locked actions, anything that weakens an IPB-02 control.
- Never publish from a branch other than `main`; never force-push `main`; never edit a migration that has shipped.
- Seeds never run when `APP_ENV` is `prod`, `dr` or `pre-prod` (`SEED_REFUSED_ENVS`, PL1-D-06); `SEED_CREDENTIALS.md` is never committed.

## Working mode — continuous build (owner standing instruction, 26 Oct 2026; PL2-D-41)

**Goal.** Finish the shared packages so the six product repositories can build on them. Work through PL2 sessions 3 to 8 and gate A, then PL3, PL4, PL5 and PL6 in order, without waiting for the owner between steps. Work only in this repository.

**Allowed without asking:**

- Write each phase plan, self-review it against the IPB, commit it and start implementing (the owner reviews plans in batches and may redirect at any time).
- Where the spec is silent, or a decision is the owner's but not blocking, take the most conservative reversible option (flag off, adapter unproven, feature disabled). Log it in `docs/DECISIONS.md` as `[ASSUMED – owner review]` and add it to `docs/OWNER-QUESTIONS.md` with the question, the default taken, the impact if the owner changes it, and how to reverse it.
- Open PRs, fix CI, and merge under the standing authority (PL2-D-19) when every required check is green.
- At each phase gate, once the gate checklist is green, publish the 0.x pre-releases through the version PR; then update STATUS with what products can now install and what they must change (migrations, environment variables, settings keys).
- Update dependencies within the 7-day policy (PL2-D-32).

**Stop and ask only for these.** Record the question in `docs/OWNER-QUESTIONS.md`, park only the blocked item and carry on with other unblocked work; end the session only when nothing unblocked remains.

1. A locked-list item not already approved: payments or money movement, cryptography beyond the approved C-items, data deletion or retention, approval or maker-checker policy, production configuration or deployment, live credentials.
2. Changing an approved owner decision or condition.
3. Anything that creates an external account, costs money or adds a recurring cost (cloud resources, paid services, GitHub plan changes).
4. Edits to `docs/ipb/` or `docs/ecosystem/` (raise them in `docs/platform-requests.md`), a Node or pnpm major, or any other ADR-only change.
5. Publishing 1.0.0, deprecating or deleting a published version, force-pushing `main`, or changing repository settings or secrets.
6. A security incident (exposed secret, suspicious package), or a check that cannot be made green after three honest attempts without weakening it.

**CI budget.** GitHub Free: 2,000 Actions minutes a month shared by seven repositories; this repository stays under **1,000 minutes a month**. The full port-contract matrix runs weekly and before a release; nightly legs run only for ports changed that day; sandbox legs stay off until their accounts exist. STATUS shows the month's total after each merge; tell the owner before going over.

**Reporting.** After each merged PR, five lines: what merged, checks, new assumptions, owner tasks, next step. `docs/OWNER-QUESTIONS.md` is the single numbered list the owner answers in one go.

**Context.** When the session's context gets long, or at each phase gate, write a handover in STATUS (done, next, open questions, branch and PR state) and end with the words **HANDOVER READY**.

**Threat model.** `docs/security/threat-model.md` is kept current with every PR that adds a port, adapter, package or data flow (PL2-D-43).

## Working on the Claude branch

Claude Code may work on a `claude/*` or `cc/PLn-<slug>` branch; open a PR using the template, let CI pass, then merge to `main` and delete the branch.

## Repository map

`packages/<name>` (see README table) · `apps/reference` · `infra/{docker,helm,terraform}` · `docs/{ipb,ecosystem,phases,STATUS.md,DECISIONS.md}` · `.github/workflows/{ci,release}.yml` · `scripts/ipb-check.mjs`.
