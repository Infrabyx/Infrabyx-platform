# IPB-09 — Engineering Governance, Release and Data Safety  (Infrabyx Platform Baseline Standard v1.0, 25 October 2026)

> **Status:** Binding for LD, LDC, EQ, FBX, UDF, OH unless a product records an `IPB-DEV` deviation.
> **Related:** IPB-01 (stack, environments, Dockerfiles, Helm, Supabase rules), IPB-02 (patch SLAs, security CI checks, incident runbook), IPB-10 (API versioning, breaking-change policy, webhooks for release notes), IPB-04 (public Changelog page, CMS), Ecosystem Spec v1.2 §3 (events). Owner decisions IPB-D-01, IPB-D-04, IPB-D-05 apply.

## 09.1 Purpose and scope

This file defines how code moves from a Claude Code plan to production and how it is kept safe once there. It covers the repository and branch model, required CI checks, per-PR preview environments, the environment catalogue and promotion rules, versioning and release trains, feature flags and kill switches, zero-downtime migrations, data-safety gates, change classes and the Change Advisory Board (CAB), patch management, the release-notes pipeline, tenant-side feature testing, rollback runbooks, the incident-to-backlog loop, GitHub rulesets and CODEOWNERS, the Claude Code operating rules, and the super-admin Engineering console.

The data-safety principle of this file is simple and non-negotiable: **a code change can never alter what customers download.** Exports, archives and documents are produced from canonical IDs through a versioned export map; folders, categories and views are projections over those IDs and never the source of truth.

Out of scope: control implementation detail (IPB-02), port and adapter design (IPB-01), API contract rules (IPB-10).

## 09.2 Definitions

| Term | Meaning |
|---|---|
| **Trunk** | The `main` branch. Always deployable. Protected by rulesets. |
| **Release branch** | `release/x.y`, cut from `main` for a release train; receives only cherry-picked fixes. |
| **Changeset** | A `.changeset/*.md` file describing a user-visible change and its semver bump, created with the Changesets tool. |
| **Release train** | A scheduled release (weekly by default) that carries every changeset merged to `main` since the last train. |
| **Ring** | A rollout stage: internal → canary tenants → 10 % → 50 % → all. |
| **Preview environment** | An ephemeral environment created per pull request with its own database branch and URLs, destroyed on PR close. |
| **Promotion** | Moving the same image digest from one environment to the next; never rebuilding. |
| **Flag** | An OpenFeature flag with a taxonomy prefix (`mod.`, `exp.`, `ops.`, `kill.`), an owner, an expiry and a lifecycle state. |
| **Kill switch** | A `kill.*` flag whose "on" state disables a capability; evaluates to on (safe) when the flag provider is unreachable. |
| **Expand → migrate → contract** | The three-phase schema change pattern: add new structures (expand), move data and dual-write (migrate), remove old structures (contract) only after code no longer depends on them. |
| **Export map** | `packages/export/maps/<PRODUCT>-EXPORT-<version>.json`: the declarative mapping from canonical entities to export files. |
| **Golden archive** | A frozen export produced from the `demo` seed by the last released version; CI diffs every build's export against it. |
| **Change class** | `standard` (pre-approved, low risk), `normal` (CAB review), `emergency` (expedited with retrospective CAB). |
| **CAB** | Change Advisory Board: `PLT_RELEASE_MANAGER`, `PLT_SECURITY_OFFICER`, product lead, plus `PLT_DPO` for data-affecting changes. |
| **Regulatory-impact tag** | A changeset tag (`reg:dpdp`, `reg:rbi`, `reg:sebi`, `reg:cert-in`, `reg:gst`) indicating a change made for a regulatory reason; drives notice periods and release-note sections. |
| **Phase** | A unit of Claude-Code-driven build work defined by a product phase file with an exit gate. |
| **Exit gate** | The checklist that must be green before a phase is complete: tests, IPB conformance checklist, threat model (where required), docs, owner approval. |

## 09.3 Requirements

### 09.3.A Repository and branch model

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-09-01 | Trunk-based development. `main` is protected: no direct pushes, no force-push, linear history (squash or rebase merge only), signed commits required, at least one approving review from a CODEOWNER, all required checks green, conversation resolution required. | PLATFORM | GitHub ruleset export matches the policy file `infra/policy/github/rulesets.json`. |
| IPB-09-02 | Branch names: `feat/<ticket>-<slug>`, `fix/<ticket>-<slug>`, `hotfix/<ticket>-<slug>`, `release/x.y`, `chore/<slug>`, `docs/<slug>`, and `cc/<phase>-<slug>` for Claude-Code-driven phase work. Any other prefix is rejected by the ruleset. | PLATFORM | Push of `wip/test` is rejected. |
| IPB-09-03 | Every PR uses the template `.github/PULL_REQUEST_TEMPLATE.md` (09.4.1.3) including the IPB conformance checklist; a PR with unchecked mandatory items cannot merge (checked by the `pr-checklist` action). | PLATFORM | PR with unchecked item blocked. |
| IPB-09-04 | `cc/*` branches additionally link the phase plan file (`docs/plans/<product>/<phase>.md`) and the exit-gate status; the PR body states which IPB files were read. | PRODUCT | `pr-checklist` validates the links. |
| IPB-09-05 | `release/x.y` receives only cherry-picks of commits already on `main` (fix-forward rule); hotfixes land on `main` first unless `main` is not releasable, in which case the hotfix PR targets `release/x.y` and a follow-up PR to `main` is opened automatically. | PLATFORM | `release-branch-guard` action checks commit ancestry. |
| IPB-09-06 | CODEOWNERS covers every path: `packages/contracts`, `packages/export`, `apps/api/drizzle`, `infra/`, `.github/` require `PLT_RELEASE_MANAGER` or `PLT_SECURITY_OFFICER` review; module folders require the module owner. | PLATFORM | CODEOWNERS lint (no unowned paths). |

### 09.3.B Required CI checks

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-09-07 | Required checks on every PR to `main` and `release/*`: `lint` (ESLint + Prettier + custom IPB rules), `typecheck`, `unit`, `contract` (Pact consumer/provider), `e2e` (Playwright against preview), `a11y` (axe on preview key pages), `rls-lint`, `migration-lint`, `sbom`, `semgrep`, `zap-baseline` (against preview), `licence`, `bundle-budget`, `lighthouse` (public and web key pages), `pin-check`, `vendor-import`, `schema-boundary`, `export-map-gate`, `golden-archive-diff`, `secret-scan`, `pr-checklist`. | PLATFORM | Ruleset lists exactly these as required; a PR with any red check cannot merge. |
| IPB-09-08 | Checks run on the merge commit (merge queue enabled) so `main` is tested as it will exist. | PLATFORM | Merge queue configured. |
| IPB-09-09 | Flaky tests are quarantined within 24 h with an owner and a 14-day fix SLA; quarantined tests still run and report. | PLATFORM | Quarantine list length and age in the Engineering console. |
| IPB-09-10 | Bundle budget: `apps/web` route JS ≤ 250 KB gzipped initial, `apps/public` ≤ 150 KB; Lighthouse performance ≥ 90 and accessibility = 100 on key pages; budgets live in `infra/policy/budgets.json`. | PRODUCT | `bundle-budget` and `lighthouse` checks. |

### 09.3.C Per-PR preview environments

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-09-11 | Every PR gets an ephemeral preview: a database branch (Neon or Supabase branch, or Testcontainers PostgreSQL for forks/untrusted PRs) seeded from profile `demo`, deployed `apps/api`, `apps/web` and `apps/public`, with URLs `pr-<n>.<product>.preview.infrabyx.dev` **[VERIFY: preview domain]** posted as a PR comment. | PLATFORM | PR open → comment with three URLs within 15 minutes. |
| IPB-09-12 | Previews never receive production secrets or live vendor credentials; all ports use fakes or sandbox keys from the `preview` secrets scope; outbound email goes to a catch-all. | PLATFORM | Secrets scope policy; outbound email check. |
| IPB-09-13 | Previews are destroyed on PR close/merge and after 7 days of inactivity; database branches are deleted; cost per preview is reported. | PLATFORM | Nightly orphan sweep report shows zero orphans older than 7 days. |
| IPB-09-14 | Preview URLs require authentication (GitHub SSO or a preview token) and are indexed `noindex`; previews run with `robots: disallow`. | PLATFORM | Unauthenticated fetch returns 401; robots check. |

### 09.3.D Environment catalogue and promotion

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-09-15 | Environments are exactly `local`, `dev`, `test`, `preview`, `staging`, `pre-prod`, `demo`, `prod`, `dr` with the properties in 09.4.3 (this list is binding; IPB-11's `APP_ENV` enum and IPB-01 §01.2 mirror it). No ad hoc environments. *(rev. 26 Oct 2026)* | PLATFORM | Terraform workspaces and Helm values match the catalogue. |
| IPB-09-16 | Promotion moves the same image digest: `staging` → `pre-prod` → `prod`. Rebuilding for an environment is forbidden. Config differs only by `values.<env>.yaml` and `<env>.routing.yaml`. | PLATFORM | Deploy job verifies digest equality across environments. |
| IPB-09-17 | `pre-prod` is restored from the latest production snapshot into an isolated network (no egress except to fakes) before every release train; migrations and the release are rehearsed there. | PLATFORM | Rehearsal record attached to the `rel_` record. |
| IPB-09-18 | Production refuses seed profiles, Supabase hosts and `.env` secrets (IPB-01, IPB-02). | PLATFORM | IPB-01 AT-12. |

### 09.3.E Versioning and release trains

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-09-19 | Conventional commits (`feat:`, `fix:`, `perf:`, `refactor:`, `docs:`, `chore:`, `test:`, `build:`, `ci:`, `revert:`) with scope = module or app; commit lint enforced; breaking changes marked `!` and require a changeset with `major` and a migration note. | PLATFORM | commitlint in CI. |
| IPB-09-20 | Changesets required for every user-visible change (checked by the `changeset-required` action unless the PR carries label `no-changeset` with a reason). Semver per package; the product version is the `apps/api` version. | PLATFORM | PR without changeset blocked. |
| IPB-09-21 | Release trains: weekly (Tuesday 11:00 IST cut, Wednesday rings begin) by default; no production deploys on Fridays, public holidays or during tenant-declared freeze windows unless `emergency`. | PLATFORM | Release calendar in Engineering console; deploy job checks freeze windows. |
| IPB-09-22 | Rollout rings: `internal` (Infrabyx tenants) → `canary` (opted-in tenants, ≤ 5 % of traffic) → `10%` → `50%` → `all`, with minimum bake times 2 h / 12 h / 12 h / 12 h and automatic rollback triggers (09.4.5.2). | PLATFORM | Ring controller tests; rollback drill. |
| IPB-09-23 | Every release has a `rel_` record: version, image digests, changesets, migrations included, rings and timings, approvals, BOM, SBOM, rehearsal evidence, release notes, rollback plan. | PLATFORM | Record complete before ring `10%`. |

### 09.3.F Flags and kill switches

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-09-24 | Flags use OpenFeature via FEATURE_FLAG_PORT and the taxonomy `mod.<module>.<feature>`, `exp.<experiment>`, `ops.<capability>`, `kill.<capability>`; flags are registered in `packages/config/flags.ts` with owner, created date, expiry, default and description before any code reads them. | PLATFORM | Unregistered flag read fails typecheck; registry lint. |
| IPB-09-25 | Flag lifecycle: `proposed` → `active` → `graduating` (default on, removal PR open) → `removed`; `exp.` flags expire in 60 days, `mod.` in 180 days, `ops.` reviewed quarterly, `kill.` never expire. Debt budget: ≤ 30 active `mod.`/`exp.` flags per product; exceeding blocks new flags until removal PRs land. | PLATFORM | Flag debt report in Engineering console; `flag-debt` check. |
| IPB-09-26 | Kill switches exist for the capabilities in IPB-02-83; flipping one requires `PLT_RELEASE_MANAGER` or `PLT_SECURITY_OFFICER`, is ledgered, alerts, and is reviewed within 24 h. | PLATFORM | IPB-02 AT-20. |
| IPB-09-27 | Per-tenant flag overrides are supported for `mod.` flags (beta programme, 09.3.J) and never for `kill.` flags. | TENANT | Override API test. |

### 09.3.G Zero-downtime migrations

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-09-28 | Every schema change follows expand → migrate → contract across at least two release trains; a single PR never contains both expand and contract for the same object. | PRODUCT | `migration-lint` rule `no-expand-contract-same-release`. |
| IPB-09-29 | Backfills are idempotent, batched (≤ 5,000 rows per transaction), resumable from a checkpoint table, rate-limited, run from `apps/worker`, and never inside a DDL migration. | PRODUCT | Backfill harness tests; re-run produces no changes. |
| IPB-09-30 | Migrations are rehearsed on the production snapshot in `pre-prod` (isolated network) before the release train; the rehearsal records duration, lock waits and row counts. | PLATFORM | Rehearsal record. |
| IPB-09-31 | `migration-lint` rules (09.4.6.2) run on every PR; forbidden operations (09.4.6.3) fail the check with no override; risky operations need the `migration:reviewed` label from `PLT_RELEASE_MANAGER`. | PLATFORM | Lint tests with fixture migrations. |
| IPB-09-32 | A migration already released to any environment beyond `preview` is never edited; corrections are new migrations. The checksum table detects edits and blocks deploy. | PLATFORM | Edited-migration fixture blocks deploy. |
| IPB-09-33 | Migrations run as `app_migrate` with `lock_timeout = 5s` and `statement_timeout = 60s` (DDL) and retry with backoff; the deploy job aborts the release if a migration fails, leaving the previous version running (expand-only on deploy guarantees compatibility). | PLATFORM | Failure injection test. |

### 09.3.H Data safety gates

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-09-34 | Export-map CI gate: any change to a canonical entity schema, an export template or `packages/export` requires a corresponding change to the export map version or an explicit `export:unchanged` attestation reviewed by `PLT_RELEASE_MANAGER`; the gate diffs the export map against the schema. | PLATFORM | `export-map-gate` check. |
| IPB-09-35 | Golden-archive diff: CI produces an export of the `demo` tenant with the PR build and diffs it byte-for-byte (after normalising timestamps and IDs) against the golden archive of the last release; any difference fails unless the PR carries a changeset bumping the export map version with a customer-facing note. | PLATFORM | `golden-archive-diff` check. |
| IPB-09-36 | Folders, categories, tags, workspaces and saved views are projections over canonical IDs; deleting or renaming a folder never deletes or alters a document, record or export; exports are organised by canonical ID with a `manifest.json` mapping to the folder view at export time. | PRODUCT | Delete folder → documents remain and export unchanged. |
| IPB-09-37 | Download integrity: every customer download (document, export archive, report) is produced through `packages/export` or `packages/docgen` with a SHA-256 recorded in the ledger; re-downloading the same version yields the same hash. | PRODUCT | Hash stability test across two builds. |
| IPB-09-38 | Data-affecting changes (`migration:data`, export map bumps, retention changes) are change class `normal` minimum and require `PLT_DPO` on the CAB. | PLATFORM | CAB record. |

### 09.3.I Change classes, CAB, patching

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-09-39 | Change classes: `standard` (pre-approved list in 09.4.8.1), `normal` (CAB review before ring `10%`), `emergency` (two approvers, deploy, retrospective CAB within 2 working days). The class is set by labels and validated by the `change-class` action. | PLATFORM | Mis-classified PR blocked. |
| IPB-09-40 | Patch SLAs (IPB-02-67): critical 72 h, high 7 d, medium 30 d, low next train. Security patches are `standard` class when they contain no behavioural change. | PLATFORM | Patch dashboard. |
| IPB-09-41 | Freeze windows: tenant-declared (e.g. quarter-end for NBFC clients) and platform-declared; `normal` changes do not deploy to ring `all` during a freeze that covers affected tenants; `emergency` may, with notice. | TENANT | Deploy job honours freeze calendar. |

### 09.3.J Release notes and tenant-side testing

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-09-42 | Release-notes pipeline: Changesets → generated draft → `PLT_CONTENT_EDITOR` edit → "What's new" in-app panel → tenant email digest (per tenant notice settings) → public Changelog page (`apps/public`, CMS) → `in.<product>.eng.ReleaseNotePublished.v1`. Regulatory-impact tags produce a separate "Regulatory changes" section. | PLATFORM | Pipeline e2e from changeset to Changelog page. |
| IPB-09-43 | Notice periods by change class (09.4.9.2) are enforced: the deploy job refuses ring `all` for a change whose notice period has not elapsed since the tenant notification was sent. | PLATFORM | Deploy refusal test. |
| IPB-09-44 | Beta programme: tenants opt in per product (Settings › What's new › Beta programme, IPB-07 node 19); opted-in tenants form the `canary` ring and may receive per-tenant `mod.` flag overrides; opt-out is immediate. | TENANT | Opt-in → tenant appears in canary list; override applies. |
| IPB-09-45 | Sandbox tenant: every tenant may create one sandbox tenant mirroring the production schema with anonymised copies of its own data (or the `demo` seed), isolated from production billing and messaging (fakes), refreshed on demand. | TENANT | Sandbox creation; outbound messaging suppressed. |
| IPB-09-46 | Feedback loop: in-app feedback from beta tenants (`fbk_` items, `packages/feedback`) is linked to the flag and the release; the product backlog shows feedback per flag; a flag cannot graduate with unresolved P1 feedback. | PLATFORM | Graduation check. |

### 09.3.K Rollback, incidents, Claude Code rules

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-09-47 | Rollback runbooks (09.4.10) exist for application, flag, migration (expand-phase safe), configuration and infrastructure changes; application rollback to the previous digest completes in ≤ 10 minutes. | PLATFORM | Quarterly rollback drill. |
| IPB-09-48 | Incident → postmortem → backlog: every P1/P2 incident produces a blameless postmortem within 5 working days with actions in the backlog tagged `postmortem:<INC id>`; action closure is tracked in the Engineering console. | PLATFORM | Open postmortem actions report. |
| IPB-09-49 | Claude Code operating rules (09.4.12) are binding for every `cc/*` branch: plan file per phase, owner approval before code, stop at exit gate, never force-push, never edit released migrations, never touch production, never commit secrets, never bypass checks. | PRODUCT | PR checklist; ruleset; audit of `cc/*` PRs. |
| IPB-09-50 | Engineering console (09.4.13) exists in `apps/console` for `PLT_RELEASE_MANAGER`, `PLT_SECURITY_OFFICER`, `PLT_SUPER_ADMIN` (read for `PLT_AUDITOR_RO`) with the screens listed. | PLATFORM | Screens present; RBAC test. |

## 09.4 Design

### 09.4.1 Repository and branch model

#### 09.4.1.1 Branch flow

```
main ──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──●──▶
        \        \                 \
         \        feat/LD-123-x     release/1.4 ──●──●(cherry-pick fix)──▶ tags v1.4.0, v1.4.1
          cc/p3-cms-blog ──●──●──●──▶ PR → main (squash)
```

- Feature work is short-lived (≤ 5 working days). Long work is split behind flags.
- `release/x.y` is cut by the release train job; tags `vX.Y.Z` are created from it.
- `hotfix/*` targets `main`; the release job cherry-picks to the open `release/x.y`.

#### 09.4.1.2 Conventions for Claude-Code-driven work

| Item | Rule |
|---|---|
| Branch | `cc/<phase>-<slug>` where `<phase>` matches the product phase file (e.g. `cc/p3-cms-blog`). |
| Plan file | `docs/plans/<product>/<phase>.md` committed before any implementation commit; sections: Scope, IPB files read, Settings keys to register, Events, Migrations (expand/migrate/contract plan), Tests, Exit gate, Risks, Owner approval (date). |
| Commits | Conventional commits; a trailer `Plan: docs/plans/<product>/<phase>.md` on every commit. |
| PR | One PR per phase or per exit-gate increment; the body contains the IPB conformance checklist. |
| Review | A human CODEOWNER reviews; Claude Code may respond to review comments but never approves. |

#### 09.4.1.3 PR template (binding content)

```
## Summary
<what and why>

## Plan
Plan file: docs/plans/<product>/<phase>.md   Phase exit gate: <link>   Change class: standard | normal | emergency
Regulatory impact: none | reg:dpdp | reg:rbi | reg:sebi | reg:cert-in | reg:gst

## IPB conformance checklist (mandatory)
- [ ] IPB files read for this change: IPB-01, IPB-02, IPB-09, IPB-10, <others>
- [ ] No vendor SDK outside packages/connectors (IPB-01-14)
- [ ] Module = schema = bounded context respected (IPB-01-09)
- [ ] All new tables tenant-scoped with RLS forced (IPB-02-12)
- [ ] All new columns tagged with data class (IPB-02-19)
- [ ] Settings keys registered before read (IPB-07 / brief §6)
- [ ] Flags registered with owner and expiry (IPB-09-24)
- [ ] Migrations: expand-only in this PR; contract tracked in <ticket> (IPB-09-28)
- [ ] Backfills idempotent and batched (IPB-09-29)
- [ ] Export map unchanged OR version bumped with changeset (IPB-09-34/35)
- [ ] Audit ledger written in the same transaction for every mutation
- [ ] Maker-checker applied for R2+ actions (IPB-02 §02.4.6.1)
- [ ] Error codes use RFC 9457 with code/help_key/trace_id (IPB-10)
- [ ] Events follow in.<product>.<module>.<Event>.v<n>; Ecosystem events proposed, not improvised
- [ ] Accessibility: axe clean on changed screens (IPB-06)
- [ ] Help keys added for new terms (IPB-07)
- [ ] Changeset added (or label no-changeset with reason)
- [ ] Threat model updated if CONFIDENTIAL+ data touched (IPB-02 §02.4.10)
- [ ] No secrets, no SEED_CREDENTIALS.md, no .env committed

## Tests
<unit / contract / e2e added>

## Rollback
<how to roll back: flag, digest, migration phase>
```

#### 09.4.1.4 GitHub rulesets and CODEOWNERS

Rulesets (exported to `infra/policy/github/rulesets.json` and reconciled by a nightly job):

| Target | Rules |
|---|---|
| `main` | Require PR; require 1 CODEOWNER approval; dismiss stale approvals; require signed commits; require linear history; block force-push and deletion; required checks (IPB-09-07); merge queue; require conversation resolution; restrict who can bypass (nobody; emergency path is a `hotfix/*` PR with two approvals). |
| `release/*` | Same as `main` plus `release-branch-guard`; creation restricted to the release job identity. |
| Tags `v*` | Creation restricted to the release job; immutable. |
| Branch naming | Allowed patterns per IPB-09-02. |

CODEOWNERS (excerpt):

```
*                                   @infrabyx/platform-reviewers
/packages/contracts/                @infrabyx/platform-arch @infrabyx/security
/packages/export/                   @infrabyx/platform-arch @infrabyx/dpo
/apps/api/drizzle/                  @infrabyx/platform-arch
/infra/                             @infrabyx/platform-infra @infrabyx/security
/.github/                           @infrabyx/platform-infra
/apps/api/src/modules/cases/        @infrabyx/eq-core
/apps/api/src/modules/loans/        @infrabyx/fbx-core
/packages/vidhi/                    @infrabyx/ai-core @infrabyx/security
```

Team handles are placeholders **[OWNER: confirm GitHub org and team names]**.

### 09.4.2 CI pipeline

```
PR opened/updated
 ├─ pin-check · secret-scan · lint · typecheck · commitlint · changeset-required · pr-checklist · change-class
 ├─ unit (Vitest/Jest) · contract (Pact) · rls-lint · migration-lint · schema-boundary · vendor-import · licence
 ├─ build images (api, worker, web, public, console) → trivy image → SBOM → cosign sign/attest
 ├─ preview deploy (DB branch from demo seed → migrations → apps) → comment URLs
 ├─ e2e (Playwright) · a11y (axe) · zap-baseline · lighthouse · bundle-budget  [against preview]
 ├─ export-map-gate · golden-archive-diff  [export of demo tenant from preview]
 └─ semgrep · idor-suite (generated from OpenAPI)
Merge queue → same checks on merge commit → merge
main → deploy dev → nightly: esm-dry-run, orphan sweep, flag-debt, dependency drift
Release train job (Tue 11:00 IST) → cut release/x.y → pre-prod restore + rehearsal → rings
```

`rls-lint` parses migrations and the live schema of the preview DB: every table in a module manifest's `rlsTables` and every table with a `tenant_id` column must have `ENABLE` + `FORCE` RLS and at least one policy referencing `app.tenant_id`; views over such tables must be `security_invoker`. `migration-lint` is specified in 09.4.6.

### 09.4.3 Environment catalogue and promotion rules

| Env | Purpose | Data | Secrets scope | Deploy trigger | Promotion to next | Access |
|---|---|---|---|---|---|---|
| `local` | Developer machine via Compose | `minimal` seed | SOPS `.env.local` | manual | n/a | developer |
| `dev` | Shared integration | `demo` seed | `dev` | every merge to `main` | automatic to `test` suites | engineers |
| `test` | CI ephemeral (Testcontainers) | `demo` seed | ephemeral | per CI run | n/a | CI |
| `preview` | Per-PR | `demo` seed on DB branch | `preview` (fakes/sandbox) | per PR | n/a | PR participants (SSO) |
| `demo` *(rev. 26 Oct 2026)* | Long-lived sales and training demo (IPB-D-04) | `demo` seed only; no customer or REGULATED data; reseeded on each train | `demo` (fakes/sandbox keys) | release train, after `staging` | n/a | sales, CS, prospects (invited) |
| `staging` | Release candidate validation; vendor sandboxes | `demo` + anonymised snapshot | `staging` (sandbox keys) | release train cut | manual gate: QA sign-off + `PLT_RELEASE_MANAGER` | engineers, QA, owner |
| `pre-prod` | Production snapshot rehearsal; isolated network | prod snapshot (REGULATED present; access restricted) | `preprod` (fakes only; no outbound) | before each train | automatic when rehearsal green | `PLT_RELEASE_MANAGER`, `PLT_SECURITY_OFFICER` |
| `prod` | Live | live | `prod` (workload identity) | ring controller | n/a | break-glass only |
| `dr` | Warm standby ap-south-2 | replicated | `prod` replica | DR promotion (maker-checker) | n/a | as prod |

Promotion rules: same digest; `values.<env>.yaml` reviewed under CODEOWNERS; `routing.yaml` change for `prod` is `normal` class; no environment may be skipped; `pre-prod` rehearsal is mandatory for any train containing a migration or export-map change.

### 09.4.4 Versioning

- Changesets: `.changeset/<name>.md` with `"@infrabyx/api": minor` style entries and front-matter tags: `audience: tenant | admin | developer | internal`, `reg: <tags>`, `export_map: <version>` when applicable, `notice_class: standard | normal | emergency`.
- Semver: `major` for breaking API or export-map changes (dual-run per IPB-10), `minor` for features, `patch` for fixes.
- Product version is shown in Settings › About and in `/v1/meta` (IPB-10).

### 09.4.5 Release trains and rings

#### 09.4.5.1 Train timeline (default)

| Day | Step |
|---|---|
| Tue 11:00 IST | Cut `release/x.y`; build is already signed; staging deploy; QA |
| Tue 15:00 | `pre-prod` restore from prod snapshot; migration + release rehearsal; record |
| Wed 10:00 | Ring `internal` (Infrabyx tenants) — bake 2 h |
| Wed 12:00 | Ring `canary` (beta tenants) — bake 12 h |
| Thu 00:00 | Ring `10%` — bake 12 h |
| Thu 12:00 | Ring `50%` — bake 12 h |
| Fri 00:00 | Ring `all` (not on Fridays for `normal` changes → moves to Mon 10:00 unless the train is `standard`-only) |

Products may choose a fortnightly train (`eng.release.train_cadence`). Mobile releases (UDF) follow store review timelines and use staged rollout percentages in the stores mapped to the same rings.

**Release (`rel_`) state machine** *(rev. 26 Oct 2026)*. One `rel_` per product may be in a ring state at a time; a second train waits in `CUT`.

```
PLANNED → CUT → REHEARSED → RING_INTERNAL → RING_CANARY → RING_10 → RING_50 → RING_ALL → COMPLETE
   any RING_* ──halt (trigger 09.4.5.2 or PLT_RELEASE_MANAGER)──▶ HALTED ──resume (PLT_RELEASE_MANAGER; bake timer restarts)──▶ same ring
   HALTED / any RING_* ──rollback (RB-REL-01)──▶ ROLLED_BACK (terminal; fix-forward is a new rel_)
   CUT / REHEARSED ──abandon──▶ ABANDONED (terminal)
```

| Transition | Guard |
|---|---|
| `CUT → REHEARSED` | rehearsal record green; mandatory when the train contains a migration or export-map change (IPB-09-17), otherwise `REHEARSED` is recorded as `not_required` |
| `REHEARSED → RING_INTERNAL` | `rel_` record complete except ring timings; CAB approval for `normal`/`emergency` classes |
| `RING_x → RING_y` | bake timer elapsed with no trigger firing; `PLT_RELEASE_MANAGER` may not shorten the bake below 50 % of the default |
| `→ HALTED` | automatic on any 09.4.5.2 signal or manual; the ring percentage freezes; flags unchanged |
| `HALTED → RING_x` (resume) | trigger cleared for 15 min; a second halt in the same ring forces rollback or CAB |
| `→ ROLLED_BACK` | RB-REL-01; if the train includes a `migrate`-phase change with `read_new` on, RB-REL-04 runs first; two rollbacks of the same product within 24 h freeze its next train until CAB |
| `ROLLED_BACK` | terminal; `in.infrabyx.eng.RolledBack.v1` emitted; release notes marked withdrawn; What's new cards retracted |

| Scenario | Expected behaviour |
|---|---|
| Happy path | Tue cut → Wed rings → Fri/Mon all → COMPLETE; one `rel_` per product in flight |
| Failure — 5xx at canary | HALTED within 5 min; auto-rollback at 10 min sustained; status page updated if customer-visible |
| Concurrency — hotfix during a train | hotfix is cut as its own `rel_` in `CUT`; it may jump the queue only as `emergency` class, which rolls the in-flight train back first (never two trains in rings) |
| Rollback — migrate phase live | RB-REL-04 (`read_new` off, backfill stopped) then RB-REL-01; expand structures stay |

#### 09.4.5.2 Automatic rollback triggers (evaluated continuously per ring)

| Signal | Threshold (vs previous ring/version baseline) | Action |
|---|---|---|
| HTTP 5xx rate | > 2× baseline and > 0.5 % for 5 min | Halt ring; auto-rollback if sustained 10 min |
| p95 latency on key routes | > 1.5× baseline for 10 min | Halt ring |
| Error-tracking new issue rate | > 5 new unique issues/hour | Halt ring |
| Auth failure spike | > 3× baseline | Halt + page security |
| Queue DLQ growth | > 100 jobs/10 min | Halt ring |
| Migration backfill lag | checkpoint not advancing 15 min | Halt backfill, alert |
| Payment success rate | < 95 % over 15 min (if traffic ≥ 50) | Rollback + `kill.payments` evaluation |
| Golden-archive drift in prod sample export | any | Rollback + incident |
| Manual | `PLT_RELEASE_MANAGER` button | Rollback |

Rollback = redeploy previous digest (Helm rollback) + flags to previous snapshot. Expand-only migrations make the previous version compatible by construction.

### 09.4.6 Zero-downtime migrations

#### 09.4.6.1 Pattern

| Phase | Train | Code | Schema |
|---|---|---|---|
| Expand | N | Reads old, writes old (and optionally new behind flag) | Add nullable column/table/index (`CREATE INDEX CONCURRENTLY`); add trigger-free dual-write via application |
| Migrate | N (worker) / N+1 | Dual-write old + new; backfill in batches; read from new behind `ops.migrate.<name>.read_new` | Backfill job; verification query counts |
| Contract | N+2 or later | Reads/writes new only | Drop old column/table; add NOT NULL via `NOT VALID` constraint then `VALIDATE` |

#### 09.4.6.2 `migration-lint` rules

| Rule | Severity | Description |
|---|---|---|
| `ext-whitelist` | error | Only whitelisted extensions (IPB-01-22) |
| `no-engine-specific` | error | No provider-specific syntax (IPB-01-23) |
| `rls-required` | error | New tenant-scoped tables enable and force RLS with a policy in the same migration |
| `data-class-tag` | error | New columns carry a data-class tag (via Drizzle helper comment) |
| `index-concurrently` | error | `CREATE INDEX` must be `CONCURRENTLY` outside a transaction block |
| `no-expand-contract-same-release` | error | A migration file may not both add and drop structures for the same object |
| `not-null-two-step` | error | Adding `NOT NULL` to an existing column must use `ADD CONSTRAINT … CHECK (… IS NOT NULL) NOT VALID` then `VALIDATE CONSTRAINT`, or `SET NOT NULL` only after a validated check constraint exists (PG12+ fast path) |
| `fk-not-valid` | error | New foreign keys on populated tables use `NOT VALID` + separate `VALIDATE` |
| `lock-timeout-set` | error | Each migration sets `lock_timeout` and `statement_timeout` |
| `no-data-in-ddl` | error | No `UPDATE`/`INSERT … SELECT` over tenant tables inside a DDL migration (backfills go to worker jobs) |
| `rename-forbidden` | error | No `RENAME COLUMN`/`RENAME TABLE` (use expand/contract with a view if needed) |
| `type-change-forbidden` | error | No `ALTER COLUMN TYPE` on populated tables except widening `varchar(n)`→`text` and numeric precision increases |
| `drop-requires-contract-label` | warn→error | `DROP` requires the PR label `migration:contract` and a link to the expand PR two trains earlier |
| `checksum-immutable` | error | Released migration files unchanged |
| `audit-ledger-untouched` | error | No DDL against `audit.ledger` except additive columns |
| `object-lock-untouched` | error | No change to retention settings via migration |

#### 09.4.6.3 Forbidden operations (no override)

`DROP DATABASE`; `DROP SCHEMA … CASCADE`; `TRUNCATE` on tenant tables; `ALTER TABLE … DISABLE ROW LEVEL SECURITY` / `NO FORCE ROW LEVEL SECURITY`; `GRANT BYPASSRLS`; `ALTER ROLE … SUPERUSER`; `DELETE FROM audit.ledger`; `UPDATE audit.ledger`; dropping a column tagged REGULATED without a retention decision reference; `REINDEX` without `CONCURRENTLY`; `VACUUM FULL` in a migration; `CLUSTER`; any statement touching `pg_catalog`; `SET session_replication_role = replica` (bypasses triggers).

### 09.4.7 Data safety gates

#### 09.4.7.1 Export map

```json
{
  "map_version": "LD-EXPORT-1.0",
  "entities": {
    "document": {
      "source": "documents.document",
      "id": "doc_id",
      "files": ["documents/{doc_id}/{version}.pdf", "documents/{doc_id}/metadata.json"],
      "fields": ["title", "created_at", "signed_at", "hash_sha256"],
      "views": ["folder_path", "tags"]        // projections, included in manifest only
    }
  },
  "manifest": "manifest.json",
  "normalisers": ["timestamps_iso8601", "ulid_stable_sort"]
}
```

Rules: `files` and `fields` changes bump `map_version` (minor for additive, major for removal/rename); `views` changes never bump (they are manifest-only); the tenant export always emits the newest map plus any map still in the 90-day dual-run (IPB-10 breaking-change policy).

#### 09.4.7.2 Golden-archive diff

1. `demo` seed is frozen per release; the golden archive is produced by the released version and stored in the AUDIT bucket class (Object Lock) with its hash.
2. Each PR exports the `demo` tenant from the preview and runs `export-diff --golden <release> --normalise`; the normaliser replaces run-time timestamps and job IDs; everything else must be identical.
3. A legitimate change bumps `map_version` and includes a changeset with `export_map:` and a customer note (what changes in downloads and when); the diff then runs against the new map's expectations and the release carries both maps for 90 days.
4. A production sample export (one synthetic tenant) is diffed after every ring; drift triggers rollback (09.4.5.2).

### 09.4.8 Change classes and CAB

#### 09.4.8.1 Standard (pre-approved) list

Dependency patches without behaviour change; copy/help-text edits; CMS content; flag targeting within an approved experiment; non-prod config; dashboards/alerts; documentation; test-only changes; adding indexes concurrently; additive API fields; new events.

#### 09.4.8.2 Normal

New features; schema expand/migrate/contract; routing YAML for prod; settings schema changes; export-map bumps; retention changes; new ports/adapters; IAM changes; anything with a regulatory-impact tag.

#### 09.4.8.3 Emergency

Security patch for an exploited vulnerability; incident remediation; kill-switch flips; rollback. Two approvers (`PLT_RELEASE_MANAGER` + `PLT_SECURITY_OFFICER`), deploy, retrospective CAB within 2 working days, postmortem if incident-related.

CAB meets weekly (Monday) and asynchronously in the Engineering console; decisions are ledgered against the `rel_` record.

### 09.4.9 Release-notes pipeline and notice periods

#### 09.4.9.1 Pipeline

Changesets (with `audience`, `reg`, `export_map`) → `release-notes-draft` job produces `docs/releases/vX.Y.Z.md` grouped by audience and regulatory section → `PLT_CONTENT_EDITOR` edits in the console (plain English; no marketing) → `PLT_LEGAL_REVIEWER` approves regulatory sections → published in three places: in-app "What's new" (per tenant, by audience), tenant email digest (per `eng.notices.*` settings, respecting notice classes), public Changelog page (CMS, `apps/public/changelog`) → event `in.<product>.eng.ReleaseNotePublished.v1` (and proposed Ecosystem `ReleaseNotePublished` so OH can aggregate across products).

#### 09.4.9.2 Notice periods by change class and effect

| Change effect | Class | Minimum notice to tenants before ring `all` | Channel |
|---|---|---|---|
| Fix, no UI change | standard | none | Changelog |
| UI change, no workflow change | standard/normal | 0 (What's new on release) | In-app |
| Workflow change (steps, roles, approvals) | normal | 7 days | In-app + email |
| Settings default change | normal | 14 days | In-app + email + settings banner |
| Export format change (map bump) | normal | 30 days (dual-run 90 days) | Email + Changelog + Developer portal |
| API deprecation | normal | 90 days (IPB-10) | Developer portal + headers |
| Pricing/plan change | normal | per contract; ≥ 30 days | Email + Pricing page |
| Regulatory-driven change | normal (`reg:*`) | as short as the regulation requires; explain the instrument in the note | All channels; "Regulatory changes" section |
| Emergency security fix | emergency | none; notice within 24 h after | Status page + email |

### 09.4.10 Rollback runbooks

| Runbook | Trigger | Steps | Target time |
|---|---|---|---|
| RB-REL-01 Application rollback | Ring trigger or manual | `helm rollback` to previous revision (digest); verify `/health/ready`; flags restored from previous snapshot; announce on status page if customer-visible | ≤ 10 min |
| RB-REL-02 Flag rollback | Feature misbehaving | Set `mod.`/`exp.` flag to previous value or off; confirm via evaluation audit; no deploy | ≤ 2 min |
| RB-REL-03 Migration (expand phase) | Expand migration caused issue | Application rollback (expand is backward-compatible); leave structures; open fix-forward | ≤ 10 min |
| RB-REL-04 Migration (migrate phase) | Backfill issue | Stop backfill job; set `ops.migrate.<name>.read_new` off; investigate; backfill is idempotent so rerun is safe | ≤ 5 min |
| RB-REL-05 Migration (contract phase) | Dropped structure needed | Not rollback-able by design; restore from pre-contract snapshot into `pre-prod` and reconstruct via forward migration; **this is why contract waits two trains** | hours; CAB |
| RB-REL-06 Routing/config rollback | Adapter or config regression | Revert `routing.yaml`/values PR via emergency class; redeploy config only | ≤ 15 min |
| RB-REL-07 Infrastructure rollback | Terraform change regression | `terraform apply` of previous tagged state; for stateful resources follow DR runbook | ≤ 1 h (stateless) |
| RB-REL-08 Mobile | Store release regression | Halt staged rollout; server-side `ops.mobile.min_version` to force update when fixed; feature flags off | ≤ 30 min |

### 09.4.11 Incident → postmortem → backlog loop

1. Incident closed (IPB-02 runbook) → postmortem template created automatically (`docs/postmortems/INC-<id>.md`): timeline, impact (tenants, data classes), detection, root cause(s), contributing factors, what went well, actions (owner, due date, class).
2. Actions become backlog items with label `postmortem:INC-<id>`; P1 actions due ≤ 30 days.
3. The Engineering console shows open postmortem actions and ages; overdue P1 actions block the next `normal` release train for that product until re-planned by CAB.
4. Quarterly review of recurring causes feeds IPB open items.

### 09.4.12 Claude Code operating rules

1. **Plan first.** Create or update `docs/plans/<product>/<phase>.md` before writing code. The plan lists scope, IPB files read, settings keys, events, migrations (expand/migrate/contract), tests, exit-gate criteria, risks.
2. **Approve before code.** Wait for the owner's written approval (PR comment or plan file sign-off) before implementation commits.
3. **Work on `cc/<phase>-<slug>` only.** Never commit to `main`, `release/*` or another engineer's branch.
4. **Stop at the exit gate.** When the phase exit gate is green, stop; do not start the next phase without a new plan and approval.
5. **Never force-push.** Never rewrite shared history; never delete branches that are not your own.
6. **Never edit released migrations.** Create new migrations; follow expand → migrate → contract; run `migration-lint` locally before pushing.
7. **Never touch production or `pre-prod`.** No kubectl, no SQL, no Terraform apply against `prod`/`dr`/`pre-prod`. Supabase MCP tools only against `dev`/`preview` (IPB-01 §01.4.11).
8. **Never commit secrets** or `SEED_CREDENTIALS.md`; use SOPS for `local`.
9. **Never bypass checks** or add `// eslint-disable` for IPB rules; if a rule is wrong, open an issue.
10. **Register before read.** Settings keys, flags, events, error codes and help keys are registered before code uses them.
11. **One implementation.** Use shared packages; never fork or copy a package into an app.
12. **Report honestly.** PR body states what was tested and what was not; mark unverified facts **[VERIFY]**.
13. **Human approval.** Claude Code never approves a PR, never flips a `kill.*` flag, never changes rulesets.

### 09.4.13 Engineering console (apps/console › Engineering)

| Screen | Content | Actions (role) |
|---|---|---|
| Releases | Trains calendar; `rel_` records; rings and bake timers; rollback triggers status; release notes status; freeze windows | Advance/halt ring, rollback (`PLT_RELEASE_MANAGER`); approve CAB items |
| Flags | Registry with taxonomy, owner, expiry, state, debt budget; evaluation counts; per-tenant overrides; graduation PRs | Toggle `mod./exp./ops.` (release manager); `kill.*` (release manager + security officer); set override |
| Environments | Catalogue with current digest per env, drift, preview list with age/cost, orphan sweep | Destroy preview; trigger `pre-prod` restore |
| Patches | Vulnerability register with SLA clocks; Renovate PR status; runtime pin status (Node 24.22.1) | Approve exception with expiry (security officer) |
| Backups | Last backup per tier; lock status; last restore drill and measured RTO/RPO; DR replication lag | Trigger restore drill (maker-checker) |
| Migrations | Pending/applied per env; phase (expand/migrate/contract) per change; backfill progress and checkpoints; rehearsal records | Pause/resume backfill; mark contract eligible |
| Audit evidence | Evidence collectors status; links to Vendor Assurance Room artefacts; CAB decisions; postmortem actions | Export evidence pack (auditor RO can view) |
| Beta programme | Opted-in tenants; feedback per flag; sandbox tenants and refresh status | Invite tenant; graduate flag (blocked if P1 feedback open) |
| Changelog | Draft release notes; audiences; regulatory sections; publish status per channel | Edit (content editor); approve regulatory (legal reviewer); publish |

## 09.5 Settings keys

| Key | Tier | Type | Default | Who may change | Maker-checker |
|---|---|---|---|---|---|
| `eng.release.train_cadence` | PLATFORM | enum | `weekly` | PLT_RELEASE_MANAGER | No |
| `eng.release.cut_time` | PLATFORM | string | `Tue 11:00 Asia/Kolkata` | PLT_RELEASE_MANAGER | No |
| `eng.release.no_deploy_days` | PLATFORM | string[] | `[Fri, Sat, Sun]` + holidays | PLT_RELEASE_MANAGER | No |
| `eng.release.ring_bake_hours` | PLATFORM | int[] | `[2, 12, 12, 12]` | PLT_RELEASE_MANAGER | Yes |
| `eng.release.rollback.error_rate_multiplier` | PLATFORM | number | 2.0 | PLT_RELEASE_MANAGER | No |
| `eng.release.freeze_windows` | TENANT | window[] | [] | ORG_OWNER | No |
| `eng.flags.debt_budget` | PLATFORM | int | 30 | PLT_RELEASE_MANAGER | No |
| `eng.flags.exp_ttl_days` | PLATFORM | int | 60 | PLT_RELEASE_MANAGER | No |
| `eng.flags.mod_ttl_days` | PLATFORM | int | 180 | PLT_RELEASE_MANAGER | No |
| `eng.flags.tenant_overrides_enabled` | PLAN | bool | true on plans with beta | PLT_SUPER_ADMIN | No |
| `eng.preview.ttl_days` | PLATFORM | int | 7 | PLT_RELEASE_MANAGER | No |
| `eng.preview.db_provider` | PLATFORM | enum | `neon` / `supabase` / `testcontainers` | PLT_RELEASE_MANAGER | No |
| `eng.migrations.lock_timeout_ms` | PLATFORM | int | 5000 | PLT_RELEASE_MANAGER | No |
| `eng.migrations.backfill_batch` | PLATFORM | int | 5000 | PLT_RELEASE_MANAGER | No |
| `eng.migrations.contract_min_trains` | PLATFORM | int | 2 (floor) | PLT_RELEASE_MANAGER | Yes |
| `eng.export.map_version` | PLATFORM | string | `<PRODUCT>-EXPORT-1.0` | release pipeline | Yes |
| `eng.export.dual_run_days` | PLATFORM | int | 90 (floor) | PLT_RELEASE_MANAGER | Yes |
| `eng.notices.email_digest` | TENANT | enum | `per_release` / `weekly` / `off` (regulatory always sent) | ORG_ADMIN | No |
| `eng.notices.recipients` | TENANT | contact[] | [ORG_OWNER, ORG_ADMIN] | ORG_ADMIN | No |
| `eng.notices.whats_new_enabled` | TENANT | bool | true | ORG_ADMIN | No |
| `eng.beta.opt_in` | TENANT | bool | false | ORG_OWNER | No |
| `eng.beta.sandbox_enabled` | PLAN | bool | true | PLT_SUPER_ADMIN | No |
| `eng.beta.sandbox_refresh_days` | TENANT | int | 30 | ORG_ADMIN | No |
| `eng.change.cab_required_labels` | PLATFORM | string[] | `[normal, migration:data, reg:*]` | PLT_RELEASE_MANAGER | Yes |
| `eng.postmortem.p1_action_due_days` | PLATFORM | int | 30 | PLT_RELEASE_MANAGER | No |
| `eng.cc.plan_required` | PLATFORM | bool | true (locked) | — | — |
| `ops.mobile.min_version` | PLATFORM | string | current | PLT_RELEASE_MANAGER | Yes |

## 09.6 Events and error codes

### 09.6.1 Internal events

| Event | Emitted when |
|---|---|
| `in.<product>.eng.ReleaseCut.v1` | `release/x.y` created |
| `in.<product>.eng.RingAdvanced.v1` / `.RingHalted.v1` / `.RolledBack.v1` | Ring controller actions (payload: release, ring, reason, trigger) |
| `in.<product>.eng.MigrationApplied.v1` | Migration applied in an environment (env, file, phase, duration) |
| `in.<product>.eng.BackfillProgress.v1` | Checkpoint advanced (every 1 %) |
| `in.<product>.eng.FlagChanged.v1` | Flag state/targeting change (flag, from, to, actor) |
| `in.<product>.eng.KillSwitchChanged.v1` | Alias of IPB-02 security event for `kill.*` |
| `in.<product>.eng.ExportMapBumped.v1` | New export map version released |
| `in.<product>.eng.GoldenArchiveDrift.v1` | Production sample export differs |
| `in.<product>.eng.ReleaseNotePublished.v1` | Notes published to any channel (release, channel, audiences) |
| `in.<product>.eng.PreviewCreated.v1` / `.PreviewDestroyed.v1` | Preview lifecycle |
| `in.<product>.eng.PostmortemPublished.v1` | Postmortem completed (incident, actions count) |
| `in.<product>.eng.BetaOptInChanged.v1` | Tenant beta status |
| `in.<product>.eng.SandboxRefreshed.v1` | Sandbox tenant refreshed |

### 09.6.2 Proposed Ecosystem events

| Proposed event | Purpose |
|---|---|
| `in.infrabyx.eng.ReleaseNotePublished.v1` | OH aggregates release notes across products for the group changelog and account managers |
| `in.infrabyx.eng.RolledBack.v1` | OH status page and support awareness |
| `in.infrabyx.eng.ExportMapBumped.v1` | OH client communications and LDC GRC evidence |

### 09.6.3 Error codes

| Code | Meaning | HTTP |
|---|---|---|
| `IPB-ENG-001` | Branch name violates convention | git |
| `IPB-ENG-002` | PR checklist incomplete | CI |
| `IPB-ENG-003` | Changeset missing | CI |
| `IPB-ENG-004` | Migration lint failure (rule named) | CI |
| `IPB-ENG-005` | Released migration edited (checksum mismatch) | deploy |
| `IPB-ENG-006` | Export map changed without version bump | CI |
| `IPB-ENG-007` | Golden-archive drift detected | CI / prod |
| `IPB-ENG-008` | Flag not registered | typecheck |
| `IPB-ENG-009` | Flag debt budget exceeded | CI |
| `IPB-ENG-010` | Ring advance refused: bake time or notice period not elapsed | console |
| `IPB-ENG-011` | Deploy refused: freeze window | deploy |
| `IPB-ENG-012` | Deploy refused: digest differs from staging | deploy |
| `IPB-ENG-013` | Rehearsal missing for migration-bearing train | deploy |
| `IPB-ENG-014` | Flag graduation blocked by open P1 feedback | console |
| `IPB-ENG-015` | Sandbox action attempted to reach live port | 403 |
| `IPB-ENG-016` | Kill switch change requires elevated role | 403 |
| `IPB-ENG-017` | Preview secrets scope violation | CI |

## 09.7 Product adoption notes

**LD (LawDocs).** Export map `LD-EXPORT-1.0` covers documents, versions, signatures, templates and folders (as views). The eSign artefact hash stability test (IPB-09-37) is critical because signed PDFs must re-download byte-identical. LD's weekly train is the default. Because LD's eSign is the reference ESIGN adapter for all products, LD's contract tests (Pact) are consumed by every other product's `contract` check.

**LDC (LawDocsComply).** Exports include evidence files, control mappings and audit trails; GRC clients expect `reg:*` release notes with instrument citations, so `PLT_LEGAL_REVIEWER` approval of regulatory sections is mandatory. LDC consumes `ExportMapBumped` and `PostmortemPublished` events as its own GRC evidence.

**EQ (Equator Resolution).** Hearing recordings, awards and case bundles are exported with hash manifests; the golden archive includes a sample recording manifest. Freeze windows align with hearing calendars (tenant-declared). Scheme changes (SEBI ODR thresholds) are data changes under `normal` class with `reg:sebi`.

**FBX (Finbyx).** NBFC clients declare quarter-end and month-end freeze windows; `normal` changes avoid them. Export map `FBX-EXPORT-1.0` covers loans, schedules, KFS, repayments and ledger entries; regulators may request exports, so the dual-run period is honoured strictly. Mobile collections app follows RB-REL-08. RBI IT Governance MD 2023 change-management expectations for clients are evidenced by `rel_` records and CAB minutes shared via the Vendor Assurance Room.

**UDF (Udofin).** Expo store releases: staged rollout maps to rings; `ops.mobile.min_version` forces updates for security fixes; white-label brands may require separate store listings and therefore separate release records per brand. KFS and consent-screen changes are `reg:rbi`/`reg:dpdp` with notice.

**OH (Operations Hub).** Hosts the group release calendar, aggregates `ReleaseNotePublished` across products, runs the status page, and owns the CAB tooling. OH8 billing changes are `normal` with 30-day notice for pricing effects. OH is in ring `internal` for every product (Infrabyx tenants) by definition.

## 09.8 Acceptance tests

```gherkin
@IPB-09-AT-01
Feature: Protected trunk
  Scenario: Direct push to main
    When a developer pushes a commit directly to main
    Then the push is rejected by the ruleset
  Scenario: Force-push to main
    When a force-push is attempted on main
    Then it is rejected

@IPB-09-AT-02
Feature: Branch naming
  Scenario Outline: Allowed and rejected names
    When a branch named <name> is pushed
    Then the result is <result>
    Examples:
      | name | result |
      | feat/LD-123-folder-views | accepted |
      | cc/p3-cms-blog | accepted |
      | hotfix/FBX-77-kfs-rounding | accepted |
      | wip/test | rejected IPB-ENG-001 |

@IPB-09-AT-03
Feature: PR checklist gate
  Scenario: Unchecked mandatory item
    Given a PR whose body leaves "RLS forced" unchecked
    When pr-checklist runs
    Then the check fails IPB-ENG-002 and merge is blocked

@IPB-09-AT-04
Feature: Preview environment
  Scenario: PR opened
    Given a PR against main
    When CI completes the preview stage
    Then a comment lists api, web and public preview URLs
    And the preview database is a branch seeded from demo
    And no secret in the preview scope matches a prod secret value
  Scenario: PR closed
    When the PR is closed
    Then the preview and its database branch are destroyed within 30 minutes

@IPB-09-AT-05
Feature: Preview authentication
  Scenario: Anonymous fetch
    When an unauthenticated request hits a preview URL
    Then the response is 401 and the robots header disallows indexing

@IPB-09-AT-06
Feature: Digest promotion
  Scenario: Prod digest differs from staging
    Given staging runs digest D1
    When a deploy to prod is requested with digest D2 not promoted through staging and pre-prod
    Then the deploy is refused IPB-ENG-012

@IPB-09-AT-07
Feature: Rehearsal required
  Scenario: Migration-bearing train without rehearsal
    Given release/1.5 contains a migration
    And no pre-prod rehearsal record exists
    When ring internal is requested
    Then it is refused IPB-ENG-013

@IPB-09-AT-08
Feature: Ring bake and rollback
  Scenario: Automatic rollback on error rate
    Given ring 10% is active with baseline 5xx 0.1%
    When 5xx rises to 0.6% for 10 minutes
    Then the ring controller rolls back to the previous digest within 10 minutes
    And in.<product>.eng.RolledBack.v1 is emitted with trigger "error_rate"
  Scenario: Advance before bake
    Given ring canary started 3 hours ago with bake 12 hours
    When advance is requested
    Then it is refused IPB-ENG-010

@IPB-09-AT-09
Feature: Flag registry and debt
  Scenario: Unregistered flag
    Given code calling getBooleanValue("mod.cms.blog_v2") with no registry entry
    When typecheck runs
    Then it fails IPB-ENG-008
  Scenario: Debt budget exceeded
    Given 30 active mod./exp. flags
    When a PR registers a 31st
    Then flag-debt fails IPB-ENG-009

@IPB-09-AT-10
Feature: Kill switch safe default
  Scenario: Flag provider down
    Given FEATURE_FLAG provider unreachable and snapshot expired
    When kill.webhooks is evaluated
    Then it is on and outbound webhooks pause with a visible console banner

@IPB-09-AT-11
Feature: Migration lint
  Scenario Outline: Forbidden and risky statements
    Given a migration containing <statement>
    When migration-lint runs
    Then the result is <result>
    Examples:
      | statement | result |
      | ALTER TABLE cases.case DISABLE ROW LEVEL SECURITY | error IPB-ENG-004 (forbidden) |
      | CREATE INDEX idx ON cases.case(status) | error index-concurrently |
      | ALTER TABLE cases.case RENAME COLUMN status TO state | error rename-forbidden |
      | ALTER TABLE cases.case ADD COLUMN state text; ALTER TABLE cases.case DROP COLUMN status | error no-expand-contract-same-release |
      | ALTER TABLE cases.case ALTER COLUMN amount SET NOT NULL (no prior check) | error not-null-two-step |
      | CREATE INDEX CONCURRENTLY idx ON cases.case(status) with lock_timeout set | pass |

@IPB-09-AT-12
Feature: Released migration immutability
  Scenario: Edited file
    Given migration 0042 applied in staging
    When its file content changes in a PR
    Then deploy is refused IPB-ENG-005

@IPB-09-AT-13
Feature: Idempotent backfill
  Scenario: Rerun
    Given a backfill job completed for 1,000,000 rows
    When it is rerun from the start
    Then zero rows change and the checkpoint reports complete

@IPB-09-AT-14
Feature: Export map gate
  Scenario: Schema change without map bump
    Given a PR adding a field to documents.document that the export map includes in fields
    And no map version bump
    When export-map-gate runs
    Then it fails IPB-ENG-006

@IPB-09-AT-15
Feature: Golden archive
  Scenario: Refactor must not change downloads
    Given a PR refactoring the folder service
    When golden-archive-diff exports the demo tenant and compares to the last release
    Then the archives are identical after normalisation
  Scenario: Folder deletion
    Given a document inside folder F
    When F is deleted
    Then the document remains, its download hash is unchanged, and the export manifest shows no folder path for it

@IPB-09-AT-16
Feature: Change class and CAB
  Scenario: Routing change for prod without CAB
    Given a PR editing infra/routing/fbx/prod.routing.yaml labelled standard
    When change-class runs
    Then it fails and requires label normal and CAB approval before ring 10%

@IPB-09-AT-17
Feature: Notice period enforcement
  Scenario: Workflow change without notice
    Given a changeset tagged workflow-change with tenant notification sent 2 days ago
    When ring all is requested
    Then it is refused IPB-ENG-010 until 7 days have elapsed

@IPB-09-AT-18
Feature: Release notes pipeline
  Scenario: End to end
    Given changesets with audience tenant and reg:dpdp
    When the train publishes
    Then the in-app What's new shows the tenant items, the email digest is sent per tenant settings, the public Changelog page shows the release with a Regulatory changes section approved by PLT_LEGAL_REVIEWER, and ReleaseNotePublished is emitted

@IPB-09-AT-19
Feature: Beta programme and sandbox
  Scenario: Opt-in and override
    Given tenant T opts in to beta
    When release 1.6 reaches ring canary
    Then tenant T receives it and a per-tenant override of mod.cases.timeline_v2 applies only to T
  Scenario: Sandbox isolation
    Given tenant T's sandbox
    When a user triggers an SMS from the sandbox
    Then no SMS leaves; the fake adapter records it and IPB-ENG-015 is logged for any live-port attempt

@IPB-09-AT-20
Feature: Feedback blocks graduation
  Scenario: Open P1
    Given flag mod.cases.timeline_v2 has an open P1 fbk_ item
    When graduation is requested
    Then it is refused IPB-ENG-014

@IPB-09-AT-21
Feature: Claude Code rules
  Scenario: Plan missing
    Given a cc/p4-payments branch with implementation commits and no docs/plans/<product>/p4.md
    When pr-checklist runs
    Then it fails naming the missing plan
  Scenario: Released migration edit by agent
    Given a cc/* PR modifying an applied migration
    Then migration-lint fails checksum-immutable and the PR cannot merge

@IPB-09-AT-22
Feature: Postmortem loop
  Scenario: Overdue P1 action blocks train
    Given a P1 postmortem action overdue by 1 day for product FBX
    When the FBX normal train is cut
    Then the train is held with a console notice until CAB re-plans the action

@IPB-09-AT-24
Feature: Release state machine
  Scenario: Second halt forces a decision
    Given rel_ R is in RING_CANARY and was halted once by a 5xx trigger
    When the trigger fires again after resume
    Then R cannot be resumed by PLT_RELEASE_MANAGER alone
    And the console offers only Rollback or CAB decision
  Scenario: One train in rings per product
    Given rel_ R1 is in RING_10 for LDC
    When PLT_RELEASE_MANAGER tries to advance rel_ R2 for LDC into RING_INTERNAL
    Then the API returns 409 and R2 stays in CUT
  Scenario: Rollback with live migrate phase
    Given R includes migration M with ops.migrate.M.read_new=true
    When rollback is triggered
    Then read_new is set false and the backfill is stopped before helm rollback runs

@IPB-09-AT-23
Feature: Engineering console RBAC
  Scenario: Auditor read-only
    Given PLT_AUDITOR_RO views Releases
    When they attempt to advance a ring
    Then the action is hidden and the API returns 403
```

## 09.9 Open items

| ID | Item | Owner | Flag (default OFF) |
|---|---|---|---|
| IPB-OI-09-01 | Preview database provider choice (Neon vs Supabase branching vs Testcontainers-only) and preview domain. **[OWNER] [VERIFY: Neon India region]** | PLT_RELEASE_MANAGER | `eng.preview.neon` |
| IPB-OI-09-02 | GitHub organisation, team names and merge-queue availability on the current plan. **[OWNER]** | PLT_RELEASE_MANAGER | `eng.github.merge_queue` |
| IPB-OI-09-03 | Fortnightly vs weekly train for FBX given NBFC freeze windows. **[OWNER]** | FBX lead | `eng.release.fortnightly` |
| IPB-OI-09-04 | Public status page provider (self-hosted vs SaaS) and its connection to rollback events. **[OWNER]** | OH lead | `trust.status_page.auto_post` |
| IPB-OI-09-05 | Golden-archive normaliser edge cases (locale-dependent PDF rendering, font updates) — decide whether font changes count as download changes. **[OWNER]** | PLT_RELEASE_MANAGER | `eng.export.font_drift_allowed` |
| IPB-OI-09-06 | Automatic rollback for mobile via server-side feature gating granularity. **[REC]** | UDF lead | `ops.mobile.server_gating` |
| IPB-OI-09-07 | Whether CAB minutes are shared with regulated clients by default in the Vendor Assurance Room. **[OWNER] [COUNSEL]** | PLT_SECURITY_OFFICER | `trust.vendor_room.cab_minutes` |
| IPB-OI-09-08 | Contract-test (Pact) broker hosting. **[OWNER]** | PLT_RELEASE_MANAGER | `eng.ci.pact_broker` |
| IPB-OI-09-09 | Tenant-visible migration status (show "data maintenance in progress" banners) for long backfills. **[REC]** | Product leads | `eng.migrations.tenant_banner` |
