# IPB-14 — Platform Build Runbook: `infrabyx-platform` (Infrabyx Platform Baseline Standard v1.0 addendum, 26 October 2026)

> **Purpose.** Build the shared packages the IPB defines once, in their own repository, publish them as private npm packages under the `@infrabyx` scope, and have every product (Udofin, Finbyx, LawDocs, LawDocsComply, Equator, Operations Hub) install them instead of rebuilding tenancy, audit, CMS, Vidhi and the rest six times. Written for an owner who is new to GitHub and Claude Code; every step is a paste.
> **Precedence.** This runbook sits under IPB-01 to IPB-13. Where it names a package, the IPB file that specifies the package governs its behaviour.

---

## 14.1 Three ideas you need

**Package.** A folder of code with a name, a version and a published interface, installed by other projects with `pnpm add @infrabyx/tenancy`. The platform repository publishes ~20 of them; the products install them. When you fix a bug in `@infrabyx/audit`, you publish version 1.0.1 and every product picks it up by bumping one line — the fix is made once.

**Registry.** Where packages are published. We use **GitHub Packages** (npm registry built into GitHub) under your organisation, so the packages stay private and need no extra account. Products authenticate with one token stored as a repository secret.

**Ports and adapters.** The IPB rule that no product talks to a vendor directly. The platform publishes the *port* (interface) and the *reference adapter* (e.g., `STORAGE_PORT` with the S3 adapter and the MinIO adapter). Products just configure which adapter to use.

## 14.2 Repository layout to build

```
infrabyx-platform/
├─ CLAUDE.md, README.md, .nvmrc (24.22.1), .npmrc, pnpm-workspace.yaml, turbo.json, .changeset/
├─ docs/
│  ├─ ipb/                 ← the whole IPB folder (spec of record for this repo)
│  ├─ ecosystem/           ← Ecosystem Spec v1.2
│  ├─ STATUS.md, DECISIONS.md, phases/<plan files>
├─ packages/
│  ├─ contracts/      Port interfaces, Zod schemas, event catalogue types (IPB-01, IPB-10)
│  ├─ config/         Settings registry + tiers + env schema loader (IPB-07, IPB-11)
│  ├─ tenancy/        tenant/entity context, RLS helpers, RLS lint (IPB-02)
│  ├─ audit/          hash-chained audit ledger, correction entries, nightly anchor (IPB-02)
│  ├─ crypto/         the only crypto call-site; crypto-agility (IPB-02, IPB-12)
│  ├─ rules/          GoRules ZEN + CEL wrapper behind RULES_PORT (IPB-01)
│  ├─ workflow/       Temporal helpers, maker-checker, approvals (IPB-01, IPB-07)
│  ├─ notify/         NOTIFY_PORT fan-out: email, SMS, WhatsApp, push, in-app (IPB-01)
│  ├─ connectors/     all vendor adapters, one sub-folder per port (IPB-01 §01.4.4)
│  ├─ ai/             LLM/EMBEDDING/IMAGE_GEN/SPEECH gateway, model registry, data-class routing (IPB-03)
│  ├─ vidhi/          Vidhi kernel: skills, missions, schedules, autonomy, MCP server/client, notebooks (IPB-03)
│  ├─ cms/            headless CMS module: pages, blocks, blog, vlog, resources, redirects, SEO (IPB-04)
│  ├─ brand/          brand packs, Brand Studio, host map, display name, contrast guard (IPB-04)
│  ├─ consent/        cookie CMP + consent ledger + marketing consent (IPB-04, IPB-05)
│  ├─ hlp/            "i" glossary registry, help keys, CI lint, tours, tutorials (IPB-07)
│  ├─ trust/          vendor assurance room mirror, Trust Centre, evidence packs (IPB-08)
│  ├─ feedback/       feedback widget + idea board client (IPB-04)
│  ├─ export/         <PRODUCT>-EXPORT-1.0 export map, golden-archive diff gate (IPB-09)
│  ├─ ui/             shared React components (Next.js), design tokens per product, a11y primitives (IPB-06, IPB-07)
│  ├─ a11y/           journey registry, axe/Pa11y CI gates, accessibility settings (IPB-06)
│  ├─ seed/           seed framework, profiles, SEED_CREDENTIALS loader, prod refusal (IPB-11)
│  └─ testing/        port contract tests, Testcontainers helpers, NN test harness
├─ apps/
│  └─ reference/      a tiny "hello tenant" NestJS + Next.js app that uses every package — the integration test and the template products copy
├─ infra/
│  ├─ docker/         Dockerfile standard, Compose for local
│  ├─ helm/           shared chart `infrabyx-app`
│  └─ terraform/      aws/, azure/, gcp/ modules with identical outputs (IPB-01 §01.4.9)
└─ .github/workflows/ ci.yml (lint, type, unit, contract, axe, RLS lint, migration lint, SBOM, Semgrep), release.yml (Changesets → publish to GitHub Packages)
```

## 14.3 Build phases (one Claude Code session block each; ~6–8 weeks)

| Phase | Name | Delivers | Sessions |
|---|---|---|---|
| PL0 | Repository and toolchain | Monorepo scaffold, Node 24.22.1, pnpm, Turborepo, Changesets, CI skeleton, `.npmrc` for GitHub Packages, CLAUDE.md, STATUS/DECISIONS | 2–3 |
| PL1 | Core kernel | `contracts`, `config`, `tenancy`, `audit`, `crypto`, `seed`, `testing`; RLS lint; NN tests NN-01/02/45 pattern | 4–6 |
| PL2 | Ports and reference adapters | `connectors` for Tier-0 ports (IDENTITY Keycloak, AUTHZ Cerbos, STORAGE S3+MinIO, QUEUE Redis/BullMQ, WORKFLOW Temporal, SECRETS AWS SM + Vault, KMS, EMAIL SES+Brevo, SMS, WHATSAPP, PAYMENTS Razorpay + one alternative, FEATURE_FLAG Unleash, OBSERVABILITY OTel); `provider_routing`; contract tests green for reference + one alternative each | 6–8 |
| PL3 | Rules, workflow, notify, export | `rules`, `workflow` (maker-checker), `notify`, `export` (export map + golden archive gate) | 3–4 |
| PL4 | AI gateway and Vidhi kernel | `ai` (adapters Anthropic direct, Bedrock India, OpenAI/Azure, Gemini Vertex, Grok, Sarvam, self-hosted; IMAGE_GEN; model registry; data-class routing; evals), `vidhi` (skills manifest, missions, RRULE schedules, autonomy L0–L4, locked-list enforcement, MCP server/client, notebooks) | 6–8 |
| PL5 | Public website kit | `cms`, `brand`, `consent`, `hlp`, `feedback`, `trust`, `ui`, `a11y`; the reference `apps/public` with every standard page, blog, resources, footer, cookie CMP, Brand Studio, Pricing Studio | 6–8 |
| PL6 | Infra and release | Docker/Helm/Terraform modules; `release.yml` publishing all packages at 1.0.0; `apps/reference` deployed to a preview environment; exit gate = a product can scaffold from the template in one session | 3–4 |

Total ≈ 30–40 sessions. Every phase ends with the IPB-09 exit gate: all CI checks green, acceptance tests in the IPB file for that package passing, STATUS.md updated, a Changeset written, and a version published to GitHub Packages (pre-releases `0.x` until PL6).

## 14.4 Step-by-step for the owner

### Step 1 — Create the organisation and repository on GitHub (10 minutes)
1. github.com → your avatar → **Your organizations** → **New organization** → Free plan → name `infrabyx` (or your preferred slug). Packages are published under this name as `@infrabyx/...`. If the name is taken, pick e.g. `infrabyx-group` and tell Claude the scope.
2. In the organisation → **New repository** → name `infrabyx-platform` → **Private** → tick **Add a README** → Create.
3. Move the `udofin` repository into the organisation later (Settings › Danger Zone › Transfer) or recreate it there; products must live in the same organisation to install the packages without extra tokens.

### Step 2 — Create one token for package publishing (5 minutes)
GitHub → avatar → Settings → Developer settings → Personal access tokens → **Tokens (classic)** → Generate new token → name `infrabyx-packages` → expiry 1 year → scopes **`write:packages`, `read:packages`, `repo`** → Generate → copy it once.
- In `infrabyx-platform` → Settings → Secrets and variables → Actions → New repository secret → name `NPM_PUBLISH_TOKEN` → paste.
- In every product repository → same place → name `NPM_READ_TOKEN` → paste (products only need `read:packages`; you may create a second, read-only token for that).
- Never paste the token into a chat or a file in the repository. Claude Code will read it from the secret.

### Step 3 — Prepare the upload (5 minutes)
Zip the IPB folder (`Infrabyx Platform Baseline Standard v1.0`, including `_research` and `_review`), this file (IPB-14) and `Infrabyx_Ecosystem_Integration_Spec_v1.2.md` into `infrabyx-platform-spec.zip`. No credentials files are involved here.

### Step 4 — Claude Code, session 1: set-up (paste as is)

> I have attached `infrabyx-platform-spec.zip`. Unzip it and set up this repository as the shared platform for the Infrabyx products. Change nothing inside the uploaded files.
> 1. Place the IPB folder at `docs/ipb/` (names unchanged) and the Ecosystem Spec at `docs/ecosystem/infrabyx-integration-spec-v1.2.md`.
> 2. Read `docs/ipb/00_README.md`, `docs/ipb/IPB-14_Platform_Build_Runbook.md` in full, and the headings and requirement tables of IPB-01, IPB-02, IPB-03, IPB-04, IPB-07, IPB-09, IPB-10, IPB-11.
> 3. Create `.nvmrc` (`24.22.1`), `pnpm-workspace.yaml`, `turbo.json`, `.changeset/config.json`, `.npmrc` configured for GitHub Packages under the scope `@infrabyx` using `${NODE_AUTH_TOKEN}` (never a literal token), `.gitignore` (node_modules, .env, .env.* except .env.example, *.local, SEED_CREDENTIALS.md, keys, .DS_Store), `.github/workflows/ci.yml` (the IPB-09 required-check list, initially allowed to pass on an empty workspace) and `.github/workflows/release.yml` (Changesets publish using the `NPM_PUBLISH_TOKEN` secret).
> 4. Create the empty package folders listed in IPB-14 §14.2, each with `package.json` (name `@infrabyx/<name>`, version `0.0.0`, private: false, publishConfig registry GitHub Packages), `README.md` naming the IPB file that specifies it, `src/index.ts` and a placeholder test.
> 5. Create `docs/STATUS.md` ("PL0 not started"), `docs/DECISIONS.md` (seeded with IPB-D-01…12), `docs/phases/README.md`, and `README.md` (what this repository is, the package list, how products install packages, how to run a session).
> 6. Write `CLAUDE.md`: this repository implements the IPB as publishable packages; the spec of record is `docs/ipb/`, never edited; the phase plan is `docs/ipb/IPB-14_Platform_Build_Runbook.md` §14.3; every session starts by reading `CLAUDE.md`, `docs/STATUS.md`, `docs/ipb/00_README.md` and ends by updating `docs/STATUS.md`; every phase begins with a written plan `docs/phases/PLn-plan.md` approved by me before code and stops at the exit gate; small assumptions are logged in `docs/DECISIONS.md` and work continues, but anything on a locked list (payments, cryptography choices, data deletion, production configuration, Vidhi locked actions) stops and asks; every package ships with its IPB acceptance tests; every package change needs a Changeset; nothing is ever published from a branch other than `main`.
> 7. Do not implement anything. Commit on `main` as "Add IPB specification and platform repository scaffold" and push. If you worked on a Claude branch, merge it into `main` and delete the branch.

### Step 5 — Sessions 2 onward: one phase at a time (paste, changing the phase code)

> Read `CLAUDE.md`, `docs/STATUS.md`, `docs/ipb/00_README.md` and `docs/ipb/IPB-14_Platform_Build_Runbook.md` §14.3. Start **PL1**: read in full every IPB file that specifies a PL1 package (IPB-01, IPB-02, IPB-07 settings registry, IPB-11). Write `docs/phases/PL1-plan.md` — package by package: public interface, data model, migrations, tests to write (including the IPB acceptance tests by ID), what will be stubbed, and the exit-gate checklist. List every owner decision or `[VERIFY]` it depends on. No code yet. Stop for my approval.

Then: *"Plan approved. Implement PL1. Commit after each package, write a Changeset per package, keep docs/STATUS.md current, stop at the exit gate."* Then: *"Run the PL1 exit gate: full CI locally, IPB acceptance tests by ID, report pass/fail, fix, update STATUS.md, commit and push. Then publish pre-release versions 0.1.0 of the PL1 packages to GitHub Packages through release.yml and confirm they appear under the organisation's Packages tab."* Continue with PL2 … PL6. Use Opus for plans, PL1, PL2 and PL4 and for every exit gate; Sonnet for the rest.

### Step 6 — Make the products use the platform
After PL6 publishes `1.0.0`, start (or restart) each product's Phase 0 / P00 with one added sentence in the first prompt:

> This product uses the Infrabyx platform packages. Install `@infrabyx/*` from GitHub Packages (scope `@infrabyx`, token from the `NPM_READ_TOKEN` secret via `${NODE_AUTH_TOKEN}` in `.npmrc`) instead of building tenancy, audit, config, rules, workflow, notify, connectors, ai, vidhi, cms, brand, consent, hlp, trust, feedback, export, ui, a11y or seed locally. Scaffold the repository from `infrabyx-platform/apps/reference`. Where this product's spec describes building one of those capabilities, implement only the product-specific configuration, skills, pages, content and settings on top of the package, and record the mapping in `docs/DECISIONS.md` as "provided by @infrabyx/<package>". If a package lacks something the product needs, do not fork it: open a change request in `docs/platform-requests.md` with the IPB ID and build the smallest product-local shim behind the same port.

**If you have already started Udofin Phase 0 before the platform exists** (your case): let Phase 0 finish the repository scaffold, toolchain and CI only, and tell Claude in the plan approval: *"Phase 0 scope is scaffold, toolchain, CI and environments only. Do not implement tenancy, audit, config, ports or seed packages — they will come from `@infrabyx/*` published by the `infrabyx-platform` repository. Leave `packages/` empty with a README saying so."* Then pause Udofin until PL2 is published (about three weeks), resume with Phase 1 using the Step 6 sentence.

### Step 7 — Keeping it maintainable
- Products pin exact versions (`"@infrabyx/tenancy": "1.2.0"`); Renovate opens a PR when a new version is published; the product's CI must pass before merging.
- A bug found in a product that belongs to a package is fixed in the platform repository, published, and bumped — never patched in the product.
- Every platform release note (Changesets) is copied into each product's "What's new" (IPB-09 pipeline).
- Once a quarter, run the IPB-12 review in the platform repository and bump `fut.*` flags there.

## 14.5 Exit gate for the whole platform (PL6)
1. All packages at `1.0.0` on GitHub Packages, installable from a fresh product repository with the read token.
2. `apps/reference` runs locally (Compose) and in a preview environment with Keycloak, PostgreSQL + RLS, Temporal, Redis, MinIO; a seeded tenant can log in, see a CMS page, trigger a Vidhi skill at L1, download its export, and view a mirrored vendor-assurance document.
3. Contract tests green for the reference adapter and at least one alternative on every Tier-0 port.
4. NN pattern tests (tenant isolation, audit chain, maker-checker, locked actions, seed-in-prod refusal) pass.
5. A new product scaffolds from the template and passes CI in one Claude Code session — the real measure that the saving is achieved.
