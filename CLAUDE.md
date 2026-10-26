# CLAUDE.md — infrabyx-platform

## What this repository is

The shared platform for all Infrabyx products. It implements the Infrabyx Platform Baseline Standard (IPB) v1.0 as publishable packages `@infrabyx/*` on GitHub Packages, plus a reference application and infrastructure modules. Products (Udofin, Finbyx, LawDocs, LawDocsComply, Equator, Operations Hub) install these packages instead of rebuilding tenancy, audit, config, rules, workflow, notify, connectors, AI gateway, Vidhi, CMS, brand, consent, help, trust, feedback, export, UI, accessibility and seed tooling.

## Spec of record (read-only)

- `docs/ipb/00_README.md` then IPB-01 … IPB-13; `docs/ipb/IPB-14_Platform_Build_Runbook.md` is the phase plan (PL0–PL6, §14.3) and package list (§14.2).
- `docs/ecosystem/infrabyx-integration-spec-v1.2.md` for cross-product contracts (prevails for events, identity, billing, consent).
- Precedence on conflict: IPB → Ecosystem Spec → this file → `docs/DECISIONS.md`.
- **Never edit anything under `docs/ipb/` or `docs/ecosystem/`.** A needed change is written to `docs/platform-requests.md` for the owner.

## Locked stack and conventions

Node.js 24.22.1 (`.nvmrc`, `engines`, Dockerfiles, CI; no other version without a dated ADR), pnpm 9 + Turborepo, TypeScript strict, ESM. NestJS 11 modular monolith patterns (module = PostgreSQL schema = bounded context), Next.js 16 for UI packages and the reference app, Expo SDK 57 where mobile is touched. PostgreSQL 16+ (18 preferred) with enforced RLS is the only database engine; Drizzle ORM; pgvector. Every external capability sits behind an IPB-01 port with a reference adapter and at least one alternative kept green in CI; vendor SDKs are imported only inside `packages/connectors/`. Secrets never in environment variables in production (SECRETS port). Settings are registered in `packages/config` before code reads them. Every mutation writes the hash-chained audit ledger in the same transaction. Vidhi agents are makers only; the IPB-03 locked-action list is enforced in the kernel, not by callers.

## Session rules

- Start: read `CLAUDE.md`, `docs/STATUS.md`, `docs/ipb/00_README.md`; then the IPB files the current phase names.
- Each phase: write `docs/phases/PLn-plan.md` (interfaces, data model, migrations, tests by IPB ID, stubs, exit-gate checklist, owner decisions needed) and **stop for the owner's approval before writing code**. Implement; commit after each package; one Changeset per changed package; stop at the exit gate (IPB-09 required checks + that package's `@IPB-..-AT-..` tests).
- End: update `docs/STATUS.md` (current phase, done, next, blocked).
- When the spec is silent on a small point: make the assumption most consistent with the IPB, log it in `docs/DECISIONS.md` (date, ID, decision, reason, spec section) and continue. **Stop and ask** for anything on a locked list: payments and money movement, cryptography choices, data deletion or retention changes, production configuration, Vidhi locked actions, anything that weakens an IPB-02 control.
- Never publish from a branch other than `main`; never force-push `main`; never edit a migration that has shipped.
- Seeds never run with `APP_ENV=production`; `SEED_CREDENTIALS.md` is never committed.

## Working on the Claude branch

Claude Code may work on a `claude/*` or `cc/PLn-<slug>` branch; open a PR using the template, let CI pass, then merge to `main` and delete the branch.

## Repository map

`packages/<name>` (see README table) · `apps/reference` · `infra/{docker,helm,terraform}` · `docs/{ipb,ecosystem,phases,STATUS.md,DECISIONS.md}` · `.github/workflows/{ci,release}.yml` · `scripts/ipb-check.mjs`.
