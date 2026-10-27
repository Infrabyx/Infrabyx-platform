# infrabyx-platform

Shared platform packages for the Infrabyx product ecosystem (LawDocs, LawDocsComply, Equator Resolution, Finbyx, Udofin, Operations Hub), implementing the **Infrabyx Platform Baseline Standard (IPB) v1.0** as private npm packages under the `@infrabyx` scope on GitHub Packages.

- Spec of record: `docs/ipb/` (never edited here) and `docs/ecosystem/infrabyx-integration-spec-v1.2.md`.
- Build plan: `docs/ipb/IPB-14_Platform_Build_Runbook.md` (phases PL0–PL6).
- Runtime: Node.js 24.22.1 (`.nvmrc`), pnpm 10 (ADR-0002, IPB-DEV-02), Turborepo, Changesets, TypeScript strict.

## Packages

| Package                | Purpose                                                                                   | Specified by   |
| ---------------------- | ----------------------------------------------------------------------------------------- | -------------- |
| `@infrabyx/contracts`  | Port interfaces, Zod schemas, event-catalogue types                                       | IPB-01, IPB-10 |
| `@infrabyx/config`     | Settings registry, tiers, typed env schema loader (exit code 78 on failure)               | IPB-07, IPB-11 |
| `@infrabyx/tenancy`    | Tenant/entity context, RLS helpers, RLS lint                                              | IPB-02         |
| `@infrabyx/audit`      | Hash-chained audit ledger, correction entries, nightly anchor                             | IPB-02         |
| `@infrabyx/crypto`     | The only cryptography call-site; crypto-agility layer                                     | IPB-02, IPB-12 |
| `@infrabyx/rules`      | GoRules ZEN + CEL behind RULES_PORT                                                       | IPB-01         |
| `@infrabyx/workflow`   | Temporal helpers, maker-checker, approvals, SLAs                                          | IPB-01, IPB-07 |
| `@infrabyx/notify`     | NOTIFY fan-out: email, SMS, WhatsApp, push, in-app                                        | IPB-01         |
| `@infrabyx/connectors` | Vendor adapters, one folder per port, provider_routing                                    | IPB-01 §01.4.4 |
| `@infrabyx/ai`         | LLM / EMBEDDING / IMAGE_GEN / SPEECH gateway, model registry, data-class routing, evals   | IPB-03         |
| `@infrabyx/vidhi`      | Vidhi AI kernel: skills, missions, schedules, autonomy L0–L4, locked list, MCP, notebooks | IPB-03         |
| `@infrabyx/cms`        | Headless CMS: pages, blocks, blog, vlog, resources, redirects, SEO                        | IPB-04         |
| `@infrabyx/brand`      | Brand packs, Brand Studio, host map, display name, contrast guard                         | IPB-04         |
| `@infrabyx/consent`    | Cookie CMP, consent ledger, marketing consent                                             | IPB-04, IPB-05 |
| `@infrabyx/hlp`        | "i" glossary registry, help keys, CI lint, tours, tutorials                               | IPB-07         |
| `@infrabyx/trust`      | Vendor Assurance Room mirror, Trust Centre, evidence packs                                | IPB-08         |
| `@infrabyx/feedback`   | Feedback widget and idea-board client                                                     | IPB-04         |
| `@infrabyx/export`     | `<PRODUCT>-EXPORT-1.0` export map and golden-archive gate                                 | IPB-09         |
| `@infrabyx/ui`         | Shared React components, per-product design tokens, a11y primitives                       | IPB-06, IPB-07 |
| `@infrabyx/a11y`       | Journey registry, axe/Pa11y gates, accessibility settings                                 | IPB-06         |
| `@infrabyx/seed`       | Seed framework, profiles, SEED_CREDENTIALS loader, production refusal                     | IPB-11         |
| `@infrabyx/testing`    | Port contract tests, Testcontainers helpers, NN test harness                              | IPB-01, IPB-02 |

## How products install the packages

```ini
# .npmrc in the product repository (committed; no credentials)
@infrabyx:registry=https://npm.pkg.github.com
```

Credentials never go in the committed `.npmrc`: pnpm 10 does not expand `${NODE_AUTH_TOKEN}` there (ADR-0002). In CI, `actions/setup-node` with `registry-url: https://npm.pkg.github.com`, `scope: '@infrabyx'` and `NODE_AUTH_TOKEN` from the product secret `NPM_READ_TOKEN` (read:packages) writes a user-level `.npmrc`. On a developer machine run `pnpm config set "//npm.pkg.github.com/:_authToken" <token>` once. Then `pnpm add @infrabyx/tenancy@1.0.0` etc. Each product repository documents its side in `docs/platform/README.md` and proves installs with its `platform-compat` workflow (installs every released version with the product's own `.npmrc`). Products pin exact versions; Renovate proposes bumps.

## How to run a build session (Claude Code)

1. Read `CLAUDE.md`, `docs/STATUS.md`, `docs/ipb/00_README.md`.
2. Start the next phase from IPB-14 §14.3: write `docs/phases/PLn-plan.md`, get owner approval, implement, pass the exit gate, publish.
3. End every session by updating `docs/STATUS.md`.

## Layout

`packages/*` publishable packages · `apps/reference` integration app and product template · `apps/public` the group website (Next.js 16) and the template for product sites · `apps/console` the reference Studio console · `infra/` Docker, Helm, Terraform (aws/azure/gcp) · `docs/` spec, status, decisions, phase plans · `.github/workflows` CI and release.
