# IPB-01 — Reference Stack and Portability  (Infrabyx Platform Baseline Standard v1.0, 25 October 2026)

> **Status:** Binding for LD, LDC, EQ, FBX, UDF, OH unless a product records an `IPB-DEV` deviation.
> **Related:** IPB-02 (Security Baseline), IPB-09 (Engineering Governance, Release and Data Safety), IPB-10 (API, Integration and Event Standard), Ecosystem Spec v1.2 §4 (identity), §3 and §6 (events), §13.2 (data classes). Owner decisions IPB-D-01, IPB-D-02, IPB-D-05, IPB-D-06, IPB-D-07 are implemented here and must not be reopened.

## 01.1 Purpose and scope

This file locks the reference technology stack for every Infrabyx product and defines the rules that keep each product portable across clouds and vendors. It exists so that a coding agent can start any product build without re-deciding runtimes, frameworks, databases, deployment shape or how third-party services are wired in.

Scope:

- The locked runtime and framework versions and the mechanics that pin them (01.3.A, 01.4.1).
- The monorepo layout and the modular-monolith rules (01.4.2, 01.4.3).
- The **port catalogue**: every external capability sits behind a named port with a reference adapter and at least two alternatives (01.4.4).
- The `provider_routing` configuration schema (01.4.5).
- Database, object-storage, container and infrastructure portability rules (01.4.6–01.4.9).
- The environment catalogue summary, the Supabase-in-non-prod rule set, the reference deployment bill of materials and the cloud/vendor exit runbook as a design property (01.4.10–01.4.13).

Out of scope: security controls (IPB-02), branch/release/migration process (IPB-09), API surface and webhooks (IPB-10), AI kernel behaviour (the Vidhi file), and product-specific domain models.

A product may tighten any rule here. It may not loosen one. Any deviation is recorded in the product decision log as `IPB-DEV-01` with a dated reason and an exit plan.

## 01.2 Definitions

| Term | Meaning |
|---|---|
| **Port** | A TypeScript interface in `packages/contracts/ports/<name>.ts` that names a capability (for example `STORAGE_PORT`) and nothing about any vendor. Application code depends only on ports. |
| **Adapter** | A concrete implementation of a port for one vendor or self-hosted service, in `packages/connectors/<port>/<adapter>/`. Adapters are the only place vendor SDKs may be imported. |
| **Reference adapter** | The adapter used in the reference production deployment (AWS ap-south-1). It is the one the acceptance suite runs against by default. |
| **Alternative adapter** | A second (or third) adapter for the same port, kept green in CI by contract tests, so a swap is a configuration change. |
| **Residency tag** | A label on an adapter instance stating where data is processed and stored: `IN` (India only), `IN-ZR` (India, zero retention by the vendor), `GLOBAL`. Data classes (Ecosystem Spec §5) are mapped to allowed residency tags. |
| **Data class** | Handling tiers PUBLIC, INTERNAL, CONFIDENTIAL, REGULATED, SECRET as defined in IPB-02 §02.4.3.1. The Ecosystem Spec §13.2 *field* classes (`PII`, `SPI`, `FINANCIAL`, `LEGAL`, `HR`, `WELLNESS`, `CONSUMER_HELP`) map to these tiers through the mapping table in IPB-02 §02.4.3.1; Spec §5 is the entity catalogue, not the classification. *(rev. 26 Oct 2026)* |
| **Module** | A NestJS module in `apps/api/src/modules/<module>/` that owns exactly one PostgreSQL schema and one bounded context. |
| **Module manifest** | `module.manifest.ts` declaring the module's schema, public events, consumed events, exposed ports, settings keys and extraction readiness. |
| **Internal event bus** | The in-process, outbox-backed publish/subscribe mechanism modules use to communicate. No module calls another module's repository directly. |
| **Environment** | One of `local`, `dev`, `test`, `preview`, `staging`, `pre-prod`, `demo`, `prod`, `dr` as defined in IPB-09 §09.4.3 (binding list; the IPB-11 `APP_ENV` enum mirrors it) and summarised in 01.4.10. *(rev. 26 Oct 2026)* |
| **Seed profile** | A named data set (`minimal`, `demo`, `load`) that populates non-production environments. Production refuses every seed profile (IPB-D-04). |
| **RTO (provider swap)** | The maximum time from the decision to leave a provider to the product running on the alternative adapter with verified data. A design property, measured in a drill, not a hope. |
| **Object Lock** | Write-once-read-many retention on object storage that no credential, including the root account, can shorten before expiry. Each cloud has its own name for it (01.4.7). |
| **BOM** | Bill of materials: the enumerated list of components, services and versions in the reference deployment (01.4.12). |

## 01.3 Requirements

Tier column: **PLATFORM** (applies to all deployments, owned by the platform team), **PRODUCT** (each product implements), **TENANT** (configurable per tenant within guard-rails). Test column names the automated or manual check that proves the row.

### 01.3.A Runtime and version pinning

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-01-01 | Pin Node.js **24.22.1** in `.nvmrc`, `package.json#engines.node` (`"24.22.1"`, exact, not a range), every Dockerfile `FROM node:24.22.1-bookworm-slim@sha256:<digest>`, the CI matrix (single entry `24.22.1`), and a Renovate rule that pins the `node` datasource to `24.22.1` and opens an upgrade PR only for the `24.x` security line. | PLATFORM | CI job `pin-check` greps all five locations and fails on mismatch. |
| IPB-01-02 | Enable `engine-strict=true` in `.npmrc` so `pnpm install` refuses a non-matching Node. | PLATFORM | `pnpm install` on Node 22 exits non-zero. |
| IPB-01-03 | Node **26.12.1** is adopted only via a dated ADR (`docs/adr/ADR-nnnn-node-26.md`) using the template in 01.4.1.4, after the dependency verification matrix passes, and not before **Q2 2027**. | PLATFORM | ADR present, approved by `PLT_RELEASE_MANAGER` and `PLT_SECURITY_OFFICER`, before any pin change merges. |
| IPB-01-04 | Apply Node security releases within the IPB-02 patch SLA (critical 72 h). The October 2026 releases (24.22.1 / 26.12.1) are the floor. | PLATFORM | Renovate PR for `node` security line auto-labelled `security`; merge timestamp vs advisory timestamp within SLA. |
| IPB-01-05 | Lock framework majors: pnpm 9, Turborepo, TypeScript strict, Next.js 16 (App Router, React 19), NestJS 11, Expo SDK 57 (mobile products), PostgreSQL 16 minimum (18 preferred), Drizzle ORM. Minor/patch upgrades flow through Renovate; a major upgrade requires an ADR. | PLATFORM | `pnpm-lock.yaml` and `package.json` ranges audited by the `deps-policy` CI job. |
| IPB-01-06 | PostgreSQL 14 or lower is forbidden in any environment after **12 Nov 2026** (PG14 EOL **[VERIFY: postgresql.org/support/versioning]**). | PLATFORM | Terraform variable validation and Compose image tags; `pg-version-check` job. |
| IPB-01-07 | Prepare for NestJS 12 ESM: no `require()` cycles, `"type": "module"` dry-run passes in CI as a non-blocking job from Q1 2027. | PLATFORM | `esm-dry-run` job output archived per release. |

### 01.3.B Monorepo and modular monolith

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-01-08 | Use the monorepo layout in 01.4.2 exactly: `apps/`, `packages/`, `infra/`, `docs/`. No code outside these roots except repo configuration. | PRODUCT | `repo-layout` lint. |
| IPB-01-09 | One NestJS module = one PostgreSQL schema = one bounded context. A module never reads or writes another module's tables; it uses the other module's public service interface or events. | PRODUCT | `schema-boundary` lint parses Drizzle schema imports and fails on cross-module table imports. |
| IPB-01-10 | Every module ships a `module.manifest.ts` conforming to the schema in 01.4.3.2. The manifest is loaded at boot and validated with Zod; boot fails on an invalid manifest. | PRODUCT | Unit test `manifest.spec.ts` per module; boot smoke test. |
| IPB-01-11 | Modules communicate through the internal event bus (outbox → in-process dispatch → optional QUEUE_PORT fan-out). Direct cross-module repository calls are forbidden. | PRODUCT | `schema-boundary` lint plus `no-cross-module-repo` ESLint rule. |
| IPB-01-12 | Every module records an extraction readiness score (0–3) in its manifest and keeps an extraction path (01.4.3.4) current. v1 never deploys a module as a separate service. | PRODUCT | Manifest review at each phase exit gate. |
| IPB-01-13 | Shared packages (`packages/*`) have one implementation each. Products use them and never fork them. A product that needs a change raises a PR against the package. | PLATFORM | `no-duplicate-package` lint compares package names and exported symbols across apps. |

### 01.3.C Ports and adapters

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-01-14 | Every external service (cloud, SaaS, model provider, payment rail, messaging channel) is accessed only through a port listed in 01.4.4 or added through the port-registration process (01.4.4.0). | PRODUCT | `vendor-import` lint fails on any vendor SDK import outside `packages/connectors/`. |
| IPB-01-15 | Each port has a reference adapter and at least two alternative adapters. At least one alternative is kept green in CI by the port contract test suite. | PLATFORM | `port-contract` job runs each port's contract tests against reference + ≥1 alternative (Testcontainers or vendor sandbox). |
| IPB-01-16 | Each adapter instance declares `residency` and `max_data_class`. The routing layer refuses a call whose payload data class exceeds the adapter's `max_data_class` and fails closed (no fallback to a lower-residency adapter). | PLATFORM | Unit tests with REGULATED payloads against a GLOBAL adapter return `IPB-PORT-003`. |
| IPB-01-17 | Each port exposes `health()` returning `{status: 'up'\|'degraded'\|'down', latency_ms, checked_at}`; the API `/health/ready` aggregates them and OBSERVABILITY_PORT records a gauge per adapter. | PLATFORM | Health endpoint contract test. |
| IPB-01-18 | Failover between primary and secondary adapters follows the circuit-breaker settings in `provider_routing` (01.4.5). Failover never crosses a residency boundary and never crosses a data-class boundary. | PLATFORM | Chaos test: primary adapter forced to fail; secondary serves; REGULATED payload with GLOBAL secondary is rejected. |
| IPB-01-19 | Adapter configuration is read from `packages/config` keys listed in the port's config-key column and from SECRETS_PORT for credentials. Adapters never read `process.env` directly. | PLATFORM | ESLint `no-process-env` outside `packages/config`. |
| IPB-01-20 | `provider_routing` YAML is validated against the schema in 01.4.5 at boot and at CI; an invalid file fails the deployment. | PLATFORM | Schema test; deliberately broken file blocks Helm release. |

### 01.3.D Database portability

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-01-21 | PostgreSQL is the only database engine. No MySQL, MongoDB, DynamoDB, Cosmos DB, Firestore or proprietary stores, even for caches of record. | PLATFORM | Dependency allow-list; Terraform modules expose only PostgreSQL. |
| IPB-01-22 | Write ANSI SQL where possible. Extensions allowed: `pgvector`, `pg_trgm`, `pgcrypto`, `citext`. Any other extension requires an ADR and must be available on all four managed targets (RDS/Aurora, Azure Database for PostgreSQL Flexible Server, Cloud SQL, Supabase) and self-hosted. | PLATFORM | `migration-lint` rule `ext-whitelist`. |
| IPB-01-23 | Engine-specific features (Aurora-only functions, Supabase-only schemas such as `auth.*`/`storage.*`, Cloud SQL IAM auth helpers) appear only inside an adapter, never in migrations or module code. | PLATFORM | `migration-lint` rule `no-engine-specific`; Drizzle schema audit. |
| IPB-01-24 | Migrations are written with Drizzle Kit, numbered, forward-only, and follow expand→migrate→contract (IPB-09 §09.4.6). A migration released to production is never edited. | PRODUCT | `migration-lint`; checksum table compared in CI. |
| IPB-01-25 | RLS is enabled and forced (`ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`) on every tenant-scoped table; policies derive from `current_setting('app.tenant_id')`. | PRODUCT | `rls-lint` job (IPB-02, IPB-09). |
| IPB-01-26 | Logical replication (`pgoutput`) is the sanctioned cross-provider migration path; Terraform modules enable `wal_level=logical` where the provider allows it. | PLATFORM | DR drill evidence. |

### 01.3.E Object storage portability

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-01-27 | All blobs go through STORAGE_PORT. Keys use `tenant/<tenant_id>/<module>/<ulid>` and never encode the provider. | PRODUCT | `vendor-import` lint; key-format unit test. |
| IPB-01-28 | Buckets holding REGULATED or audit data run with Object Lock (or the equivalent in 01.4.7) in **compliance** mode with a retention period set from the retention policy, never governance mode. | PLATFORM | Terraform policy test (OPA) asserts lock configuration. |
| IPB-01-29 | Each STORAGE_PORT adapter implements `putWithRetention(key, body, retainUntil)` and `assertImmutable(key)`; adapters for providers that cannot honour retention throw `IPB-STOR-004` and are not selectable for REGULATED buckets. | PLATFORM | Contract test per adapter. |
| IPB-01-30 | Cross-provider object replication (for DR or exit) uses the port's `replicateTo(targetAdapter)` with manifest + checksum verification; `rclone` or vendor transfer services are implementation details inside the adapter. | PLATFORM | Exit drill evidence. |

### 01.3.F Container, deploy, infrastructure

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-01-31 | Every deployable has a multi-stage Dockerfile from the digest-pinned Node base, runs as non-root UID 10001, has a read-only root filesystem, and includes a `HEALTHCHECK`. | PRODUCT | `hadolint` + `trivy config` in CI; `docker inspect` in smoke test. |
| IPB-01-32 | Kubernetes deploys use the shared Helm chart `infra/helm/infrabyx-app` with per-product `values.<env>.yaml`. No product writes raw manifests. | PLATFORM | `helm lint`, `kubeconform`, `helm diff` gates. |
| IPB-01-33 | Local development uses `infra/compose/docker-compose.yml` bringing up PostgreSQL 18, Redis, MinIO (WORM enabled), Temporal, Keycloak, OpenSearch (optional profile), Mailpit, and the API/worker/web apps. | PRODUCT | `pnpm dev:up` smoke test in CI nightly. |
| IPB-01-34 | Terraform/OpenTofu modules exist per cloud under `infra/terraform/modules/{aws,azure,gcp}/` and expose the **same output contract** (01.4.9.3). A product's environment stack consumes outputs, never provider resources directly. | PLATFORM | `terraform validate` + output-schema test per module. |
| IPB-01-35 | Images are signed with Sigstore cosign and carry a CycloneDX SBOM attestation; the cluster admission policy rejects unsigned images (IPB-02). | PLATFORM | Kyverno/OPA policy test. |
| IPB-01-36 | Reference production is AWS **ap-south-1** (Mumbai) with DR in **ap-south-2** (Hyderabad). Any other production region requires an ADR and the residency review in IPB-02. | PLATFORM | Terraform variable validation. |

### 01.3.G Environments, Supabase, exit

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-01-37 | Non-production environments may use Supabase for **PostgreSQL only**. Supabase Auth, Storage, Edge Functions, Realtime and the `auth`/`storage` schemas are never used. Production never uses Supabase. | PLATFORM | `supabase-guard` test (01.4.11). |
| IPB-01-38 | Every product publishes `docs/exit/EXIT_RUNBOOK.md` generated from the port catalogue, stating for each adapter the alternative, the data-move method and the measured RTO. | PRODUCT | File present and dated within 180 days at each release. |
| IPB-01-39 | A provider-swap drill for at least two ports (one of which is STORAGE or the database) is run every 12 months in `staging` and the RTO recorded in the Vendor Assurance Room (IPB-D-09). | PLATFORM | Drill record `vad_` artefact present. |
| IPB-01-40 | The reference deployment BOM (01.4.12) is regenerated per release from Terraform state, Helm values and `pnpm-lock.yaml`, signed, and stored with the release. | PLATFORM | `bom-generate` job output attached to `rel_` record. |

## 01.4 Design

### 01.4.1 Version pin mechanics

#### 01.4.1.1 Files that must agree

| Location | Content | Notes |
|---|---|---|
| `/.nvmrc` | `24.22.1` | Exact. No `lts/*`, no `v` prefix. |
| `/package.json` | `"engines": {"node": "24.22.1", "pnpm": "9"}` | Root only; workspaces inherit. |
| `/.npmrc` | `engine-strict=true`, `auto-install-peers=true`, `node-linker=isolated` | |
| `apps/*/Dockerfile` | `FROM node:24.22.1-bookworm-slim@sha256:<digest>` in every stage | Digest obtained from Docker Hub at pin time and recorded in `infra/docker/BASE_IMAGES.md`. Renovate updates tag + digest together. |
| `.github/workflows/ci.yml` | `strategy.matrix.node: ['24.22.1']` and `actions/setup-node@<sha>` with `node-version-file: .nvmrc` | Matrix has one entry on purpose; a second entry is added only during an ADR-approved upgrade window. |
| `renovate.json` | Rule set in 01.4.1.2 | |
| `infra/helm/*/values.yaml` | `image.tag` is the application image tag, never a Node tag | Node version is baked into the image. |

#### 01.4.1.2 Renovate rules (excerpt)

```json
{
  "extends": ["config:recommended", ":pinAllExceptPeerDependencies"],
  "lockFileMaintenance": {"enabled": true, "schedule": ["before 4am on monday"]},
  "packageRules": [
    {
      "description": "Node runtime: stay on 24.x security line, exact pin",
      "matchDatasources": ["node-version", "docker"],
      "matchPackageNames": ["node"],
      "allowedVersions": "/^24\\.22\\.\\d+$|^24\\.(2[3-9]|[3-9]\\d)\\.\\d+$/",
      "rangeStrategy": "pin",
      "pinDigests": true,
      "labels": ["runtime", "security"],
      "automerge": false
    },
    {
      "description": "Block Node 26 until ADR",
      "matchPackageNames": ["node"],
      "matchCurrentVersion": "/^24/",
      "allowedVersions": "<26.0.0"
    },
    {
      "description": "Framework majors need ADR",
      "matchPackageNames": ["next", "@nestjs/core", "@nestjs/common", "expo", "drizzle-orm", "react", "react-dom"],
      "matchUpdateTypes": ["major"],
      "enabled": false
    },
    {
      "description": "Security patches fast-track",
      "matchUpdateTypes": ["patch"],
      "vulnerabilityAlerts": {"enabled": true},
      "automerge": true,
      "automergeType": "pr",
      "requiredStatusChecks": null
    }
  ],
  "osvVulnerabilityAlerts": true
}
```

Generate the full file with the `platform-skills:renovate` conventions when scaffolding; the excerpt above is the binding part.

#### 01.4.1.3 Dependency verification matrix for a runtime upgrade

Before any Node major changes, run and archive:

| Check | Pass criterion |
|---|---|
| `pnpm install --frozen-lockfile` on target Node | Exit 0, no peer warnings for native modules |
| Native modules (`sharp`, `argon2`, `bcrypt` if any, `pg-native` if any, `better-sqlite3` for tooling) | Prebuilt binaries available for target ABI, or `node-gyp` builds clean in the Docker stage |
| Full unit + integration + e2e suite | Green on target; flake rate unchanged |
| OpenSSL/TLS behaviour | Hybrid X25519MLKEM768 at the edge unaffected; Node TLS defaults reviewed |
| Permission Model and `--experimental-*` flags | None in use in production start commands |
| Memory/CPU baseline | p95 latency within 5 % of current under the k6 reference load |
| Vendor SDKs in `packages/connectors` | Each adapter's contract tests green |

#### 01.4.1.4 ADR template for the Node 26.12.1 (or later) adoption

```
# ADR-nnnn — Adopt Node.js <version> as the platform runtime
Date: <YYYY-MM-DD>   Status: Proposed | Accepted | Superseded
Deciders: PLT_RELEASE_MANAGER, PLT_SECURITY_OFFICER, owner
## Context
Current pin 24.22.1 (EOL April 2028). Target <version> entered LTS on <date> [VERIFY: nodejs.org release schedule].
## Verification
Link to the archived dependency verification matrix (01.4.1.3) run on <date>.
## Decision
Change pin in all five locations in one PR; ring rollout per IPB-09 (internal → canary → 10% → 50% → all).
## Rollback
Revert PR; images for 24.22.1 retained for 90 days.
## Consequences
Renovate rules updated; BASE_IMAGES.md updated; BOM regenerated.
```

### 01.4.2 Monorepo layout

```
/
├─ apps/
│  ├─ api/            NestJS 11 modular monolith (HTTP, GraphQL optional, MCP server module)
│  ├─ worker/         Same codebase, worker entrypoint (BullMQ consumers, Temporal workers)
│  ├─ web/            Next.js 16 tenant application
│  ├─ public/         Next.js 16 public website + CMS rendering (IPB-D-08)
│  ├─ console/        Next.js 16 super-admin console
│  ├─ delivery/ | ops/   Product-specific (e.g. EQ hearing room, OH ops desk) — optional
│  └─ mobile/         Expo SDK 57 — only where the product has a mobile app (UDF, FBX collections)
├─ packages/
│  ├─ contracts/      Port interfaces, Zod schemas, OpenAPI/AsyncAPI sources, event catalogue
│  ├─ connectors/     Adapters, one folder per port, one sub-folder per vendor
│  ├─ tenancy/ audit/ config/ rules/ workflow/ notify/ docgen/ redline/ ai/ vidhi/ agents/
│  ├─ export/ ui/ tokens/ i18n/ a11y/ cms/ brand/ hlp/ trust/ feedback/
│  └─ testing/        Testcontainers helpers, seed profiles, contract-test harness
├─ infra/
│  ├─ docker/         Dockerfiles (shared stages), BASE_IMAGES.md
│  ├─ compose/        docker-compose.yml + profiles
│  ├─ helm/           infrabyx-app chart + per-product values
│  ├─ terraform/      modules/{aws,azure,gcp}/ and envs/<product>/<env>/
│  └─ policy/         OPA/Kyverno policies, Semgrep rules, migration-lint rules
├─ docs/
│  ├─ adr/            Architecture decision records
│  ├─ exit/           EXIT_RUNBOOK.md (generated)
│  ├─ bom/            Reference BOM per release (generated)
│  └─ ipb/            Conformance checklist copies per phase
├─ .github/           workflows, CODEOWNERS, rulesets export, PR templates
├─ .nvmrc  package.json  pnpm-workspace.yaml  turbo.json  renovate.json  .npmrc
```

Rules:

- `apps/*` import from `packages/*`; `packages/*` never import from `apps/*`.
- `packages/contracts` has zero runtime dependencies beyond Zod.
- `packages/connectors` is the only package allowed to depend on vendor SDKs (`@aws-sdk/*`, `@azure/*`, `@google-cloud/*`, `razorpay`, `@anthropic-ai/sdk`, `openai`, etc.).
- Turborepo pipelines: `lint`, `typecheck`, `test`, `test:contract`, `build`, `e2e`. Remote cache is enabled with signed artefacts.

### 01.4.3 Modular monolith rules

#### 01.4.3.1 Module = schema = bounded context

Each module owns one PostgreSQL schema named after the module (`tenancy`, `audit`, `cms`, `billing_mirror`, `cases`, `loans`, …). The Drizzle schema file for a module lives in the module folder and declares `pgSchema('<module>')`. Cross-schema foreign keys are allowed only to `tenancy.tenant` and `tenancy.user` (the shared identity anchors). Any other cross-schema reference is by ID column with no FK, validated in application code and reconciled by a nightly consistency job.

#### 01.4.3.2 Module manifest

```ts
// apps/api/src/modules/<module>/module.manifest.ts
import { defineModule } from '@infrabyx/contracts/modules';

export default defineModule({
  name: 'cases',
  schema: 'cases',
  boundedContext: 'Dispute case lifecycle',
  owner: 'EQ-core',
  publishes: ['in.eq.cases.CaseFiled.v1', 'in.eq.cases.CaseClosed.v1'],
  consumes: ['in.eq.billing.InvoicePaid.v1', 'in.infrabyx.identity.UserDeactivated.v1'],
  ports: ['STORAGE', 'DOCGEN', 'WORKFLOW', 'ESIGN', 'VIDEO_MEET'],
  settingsPrefix: 'cases.',
  settings: ['cases.filing.fee_rule_id', 'cases.timers.response_days'],
  helpKeys: ['hlp.cases.filing', 'hlp.cases.timers'],
  dataClasses: ['CONFIDENTIAL', 'REGULATED'],
  extractionReadiness: 2, // 0 none … 3 can run standalone
  rlsTables: ['cases.case', 'cases.party', 'cases.filing'],
});
```

The manifest is validated by Zod at boot. Boot fails (`IPB-MOD-001`) if a listed table lacks RLS, a settings key is unregistered in `packages/config`, or a consumed event is not in the event catalogue.

#### 01.4.3.3 Internal event bus

- Every mutation that publishes an event writes the event row to `<module>.outbox` **in the same transaction** as the mutation and the audit ledger entry.
- A dispatcher in `apps/worker` reads the outbox, publishes to in-process subscribers and, when `QUEUE_PORT` fan-out is configured, to the queue. Delivery is at-least-once; consumers are idempotent by `event.id`.
- Envelope is CloudEvents 1.0.2 (IPB-10 §10.4.9). Internal event type grammar: `in.<product>.<module>.<EventName>.v<n>`.
- Subscribers inside the monolith register with `@OnInternalEvent('in.eq.cases.CaseFiled.v1')`. They never import the publisher's repository.
- `<module>.inbox` records processed `event.id` per consumer for de-duplication; rows older than the replay window are pruned.

#### 01.4.3.4 Extraction path

When a module must become a separate service (never in v1), the path is:

1. Confirm `extractionReadiness = 3`: no cross-schema FK except the identity anchors; all inbound calls go through the module's public service interface; all outbound calls go through ports or events.
2. Switch the module's event consumption from in-process to QUEUE_PORT subscription (configuration only).
3. Deploy the module's code as `apps/svc-<module>` with the same Helm chart, pointing to the same database but with a role restricted to its schema.
4. Move the schema to its own database with logical replication; cut over; remove the identity-anchor FKs in favour of ID-only columns.
5. Expose the module's service interface over the internal API (IPB-10) and update consumers.

### 01.4.4 Port catalogue

#### 01.4.4.0 Port registration process

A new port requires: an interface in `packages/contracts/ports/`, a contract test suite in `packages/testing/ports/`, a reference adapter, two alternatives (one may be an in-memory or self-hosted fake with the same guarantees), a row in this catalogue, config keys registered in `packages/config`, and an ADR. Ports are nouns in upper snake with `_PORT` suffix in code (`STORAGE_PORT`); the catalogue uses the short name.

#### 01.4.4.1 Common conventions for every port

| Aspect | Rule |
|---|---|
| Interface | Pure TypeScript, async methods, typed inputs/outputs via Zod schemas, no vendor types in the signature. |
| Residency | Adapter instance declares `residency: 'IN' \| 'IN-ZR' \| 'GLOBAL'` and `maxDataClass`. |
| Failover | Governed by `provider_routing`; default circuit breaker opens after 5 consecutive failures or 50 % error rate over 60 s, half-opens after 30 s. |
| Health | `health()` as in IPB-01-17; probed every 30 s by the worker; result cached 10 s for `/health/ready`. |
| Config keys | `int.<port_lower>.*` for routing and behaviour; secrets via SECRETS_PORT under `secrets/<env>/<port_lower>/<adapter>/<key>`. |
| Observability | Every call emits an OTel span `port.<name>.<method>` with `adapter`, `residency`, `tenant_id` (hashed), `data_class`, `outcome`. |
| Idempotency | Methods with side effects accept `idempotencyKey` and adapters map it to the vendor's equivalent or implement it in the inbox table. |
| Errors | Adapters throw `PortError` with `code` from the IPB-PORT-* and port-specific code table (01.6); never leak vendor error objects. |

#### 01.4.4.2 Catalogue

Each entry: interface summary · reference adapter · alternatives · residency/data-class constraints · failover behaviour · health check · config keys. Config keys are under `int.<port>` unless stated.

**IDENTITY**
- Interface: `authenticate(assertion)`, `getUser(id)`, `provisionUser(spec)`, `linkFederation(userId, idp)`, `issueToken(claims, ttl)`, `verifyToken(jwt)`, `scimSync(ops)`.
- Reference: Keycloak 26.x (self-hosted in-cluster, OIDC + SAML + passkeys/WebAuthn L3 + MFA + SCIM 2.0).
- Alternatives: Zitadel (self-hosted); Auth0 / Okta CIC (GLOBAL — INTERNAL data only, non-prod or staff-only); Microsoft Entra External ID (GLOBAL region selectable; **[VERIFY: India data boundary]**).
- Residency: Identity data is CONFIDENTIAL; production adapter must be `IN`. Keycloak runs in ap-south-1; its database is the platform PostgreSQL.
- Failover: Identity has no hot cross-vendor failover. HA is intra-adapter (Keycloak cluster, two replicas minimum, DR replica in ap-south-2). Token verification uses cached JWKS for 24 h so API calls survive IdP outage; new logins fail with `IPB-IDN-002`.
- Health: OIDC discovery document fetch + token introspection of a service account.
- Config: `int.identity.issuer_url`, `int.identity.realm`, `int.identity.jwks_cache_seconds`, `int.identity.passkeys.enabled`, `int.identity.scim.enabled`, `int.identity.session.idle_minutes`.

**AUTHZ**
- Interface: `check(principal, resource, action, ctx)`, `checkBatch(...)`, `planResources(principal, action)` (for list filtering), `loadPolicies(bundle)`, `explain(decision)`.
- Reference: Cerbos (self-hosted PDP sidecar, RBAC + ABAC policies in `infra/policy/cerbos/`).
- Alternatives: OpenFGA (self-hosted); Casbin (in-process library); SpiceDB (self-hosted).
- Residency: Policy decisions carry CONFIDENTIAL attributes; PDP runs in-cluster, `IN`.
- Failover: PDP unavailable → deny by default (`IPB-AUTHZ-001`), never allow. Cached allow decisions valid ≤ 5 s.
- Health: Policy bundle version check + canary decision.
- Config: `int.authz.pdp_url`, `int.authz.bundle_version`, `int.authz.decision_cache_seconds`.

**STORAGE**
- Interface: `put(key, body, meta)`, `putWithRetention(key, body, retainUntil, meta)`, `get(key)`, `presign(key, op, ttl)`, `delete(key)` (soft: tombstone + lifecycle), `list(prefix, cursor)`, `assertImmutable(key)`, `replicateTo(target, prefix)`.
- Reference: Amazon S3 ap-south-1 with Object Lock (compliance mode) and S3 Replication to ap-south-2.
- Alternatives: Azure Blob Storage (Central India) with immutable blob policies; Google Cloud Storage (asia-south1) with retention lock; MinIO (self-hosted or local) with WORM/object retention.
- Residency: `IN` for all production buckets. REGULATED/SECRET buckets require `assertImmutable` support.
- Failover: Reads fail over to the DR replica bucket after 3 failures; writes queue in QUEUE_PORT for up to 15 minutes, then surface `IPB-STOR-002` to the user with retry. No write failover across clouds (would break Object Lock continuity).
- Health: `HEAD` on a canary object + lock configuration read.
- Config: `int.storage.bucket.<class>`, `int.storage.region`, `int.storage.presign_ttl_seconds`, `int.storage.retention.<class>_days`, `int.storage.replication.target`.

**QUEUE**
- Interface: `enqueue(queue, job, opts{delay, priority, idempotencyKey})`, `schedule(cron, job)`, `consume(queue, handler, concurrency)`, `moveToDLQ(job, reason)`, `replay(dlq, filter)`, `stats(queue)`.
- Reference: BullMQ on Redis 7 (ElastiCache, ap-south-1, cluster mode disabled, TLS).
- Alternatives: Amazon SQS + EventBridge Scheduler; Azure Service Bus; Google Pub/Sub; RabbitMQ (self-hosted); Postgres-backed queue (`pg-boss`) for small products.
- Residency: Job payloads carry only IDs and INTERNAL data; CONFIDENTIAL/REGULATED payloads are referenced by ID, never embedded. Any adapter residency is therefore acceptable for payloads, but production uses `IN`.
- Failover: Enqueue failure → write to `<module>.outbox` (already present) and let the dispatcher retry; consumers are idempotent. Switching adapters drains the old queue first (runbook).
- Health: Round-trip of a canary job within 5 s.
- Config: `int.queue.url`, `int.queue.default_attempts` (5), `int.queue.backoff` (`exponential:2000`), `int.queue.dlq_retention_days` (14).

**WORKFLOW**
- Interface: `startWorkflow(type, input, opts{id, taskQueue})`, `signal(id, name, payload)`, `query(id, name)`, `cancel(id, reason)`, `listOpen(filter)`, `describe(id)`.
- Reference: Temporal (self-hosted on the platform PostgreSQL, ap-south-1; Worker Versioning enabled).
- Alternatives: Temporal Cloud (region **[VERIFY: Mumbai availability]** — GLOBAL unless confirmed; INTERNAL payloads only); AWS Step Functions; Azure Durable Functions; a PostgreSQL state-machine engine in `packages/workflow` for simple timers.
- Residency: Workflow histories can hold CONFIDENTIAL inputs; production adapter `IN`; inputs over 32 KB are stored via STORAGE and referenced.
- Failover: No live cross-engine failover. Workflows are designed with deterministic replay; HA is Temporal's own. Engine outage pauses timers; a catch-up job reconciles overdue timers on recovery.
- Health: `DescribeNamespace` + worker poll success.
- Config: `int.workflow.address`, `int.workflow.namespace`, `int.workflow.task_queue_prefix`, `int.workflow.history_ttl_days`.

**CACHE**
- Interface: `get(key)`, `set(key, value, ttl)`, `del(key)`, `incr(key, by, ttl)` (rate-limit counters), `lock(key, ttl)`, `mget(keys)`.
- Reference: Redis 7 (same ElastiCache as QUEUE, separate logical DB).
- Alternatives: Valkey; Memcached (no `lock`/`incr` semantics → adapter emulates with CAS; flagged as degraded); in-memory LRU (single-replica dev only); Dragonfly.
- Residency: Cache values are INTERNAL or hashed; never REGULATED plaintext. `IN` in production.
- Failover: Cache down → application continues without cache (cache-aside), rate limiter falls back to in-process token bucket with conservative limits and emits `IPB-CACHE-001` warning.
- Health: `PING` + set/get canary.
- Config: `int.cache.url`, `int.cache.default_ttl_seconds`, `int.cache.key_prefix`.

**SEARCH**
- Interface: `index(collection, doc)`, `bulkIndex(...)`, `search(collection, query{q, filters, sort, cursor, tenantId})`, `delete(collection, id)`, `reindex(collection, source)`, `suggest(collection, prefix)`.
- Reference: PostgreSQL full-text search (`tsvector` + `pg_trgm`) for products under ~5 M documents; Amazon OpenSearch Service (ap-south-1) when the product's SEARCH volume gate is crossed.
- Alternatives: Self-hosted OpenSearch; Meilisearch (self-hosted); Typesense (self-hosted); Elastic Cloud (GLOBAL unless India region confirmed **[VERIFY]**).
- Residency: Indexed content may be CONFIDENTIAL; `IN` required. Index documents always carry `tenant_id` and the adapter injects a tenant filter on every query.
- Failover: Search down → fall back to PostgreSQL FTS adapter automatically (degraded relevance, flagged in UI); reindex from canonical tables on recovery.
- Health: Cluster health + canary query.
- Config: `int.search.engine`, `int.search.url`, `int.search.index_prefix`, `int.search.fallback_to_pg` (true).

**VECTOR**
- Interface: `upsert(collection, vectors[])`, `query(collection, vector, k, filters)`, `delete(collection, ids)`, `createCollection(name, dims, metric)`.
- Reference: pgvector in the platform PostgreSQL (HNSW indexes, per-tenant partition key).
- Alternatives: Qdrant (self-hosted); Weaviate (self-hosted); Amazon OpenSearch k-NN; Azure AI Search vectors (GLOBAL unless Central India confirmed **[VERIFY]**).
- Residency: Embeddings of CONFIDENTIAL text are CONFIDENTIAL; `IN`.
- Failover: None cross-adapter; pgvector inherits database HA. Alternative adapters are for scale, switched by migration job.
- Health: Canary nearest-neighbour query.
- Config: `int.vector.engine`, `int.vector.dims`, `int.vector.metric` (`cosine`).

**SECRETS**
- Interface: `get(path, version?)`, `put(path, value, meta)`, `rotate(path, rotator)`, `list(prefix)`, `lease(path, ttl)` (dynamic credentials), `audit(path)`.
- Reference: AWS Secrets Manager (ap-south-1, KMS-encrypted, rotation Lambdas for RDS credentials) — accessed at runtime by the pod via IRSA, never injected as environment variables in production (IPB-02).
- Alternatives: HashiCorp Vault / OpenBao (self-hosted); Azure Key Vault (Central India); Google Secret Manager (asia-south1); SOPS + age files for `local` only.
- Residency: SECRET class; `IN`.
- Failover: Secrets are fetched at boot and cached in memory with a 15-minute refresh; fetch failure after cache expiry → pod reports not-ready, never starts with stale secrets older than 24 h.
- Health: Read a canary secret.
- Config: `int.secrets.provider`, `int.secrets.path_prefix`, `int.secrets.cache_seconds`.

**KMS**
- Interface: `encrypt(keyId, plaintext, aad)`, `decrypt(keyId, ciphertext, aad)`, `generateDataKey(keyId)`, `sign(keyId, digest, alg)`, `verify(...)`, `createTenantKey(tenantId)`, `scheduleKeyDeletion(keyId, days)`, `listAlgorithms()`.
- Reference: AWS KMS (ap-south-1) with one customer-managed key per tenant for REGULATED fields (envelope encryption) and multi-region replica keys to ap-south-2.
- Alternatives: Azure Key Vault Managed HSM; Google Cloud KMS; Vault Transit engine (self-hosted); PKCS#11 HSM adapter for on-premise bank deployments.
- Residency: `IN`. Algorithm registry supports crypto-agility (`alg`, `key_id`, `cert_chain_ref` stored with every signature; PQC hybrid behind `crypto.pqc.sign_hybrid`).
- Failover: KMS outage → decrypt fails closed for REGULATED fields (`IPB-KMS-001`); no plaintext fallback. Data keys cached in memory ≤ 5 minutes.
- Health: Encrypt/decrypt canary with the platform key.
- Config: `int.kms.platform_key_id`, `int.kms.tenant_key_policy`, `int.kms.data_key_cache_seconds`, `int.kms.algorithms_allowed`.

**EMAIL**
- Interface: `send(message{to, template, vars, attachments, tags, idempotencyKey})`, `sendRaw(mime)`, `getStatus(messageId)`, `handleWebhook(payload)`, `verifyDomain(domain)` (for white-label brands), `suppress(address, reason)`.
- Reference: Amazon SES (ap-south-1) with configuration sets per brand and DKIM/DMARC per `brand_pack.email_domain`.
- Alternatives: Postmark; Resend; SendGrid; Mailgun; SMTP relay (Postfix) for on-premise; Mailpit for `local`.
- Residency: Email bodies may contain CONFIDENTIAL data; transactional providers are GLOBAL unless an India region is confirmed. Rule: CONFIDENTIAL content goes as a secure link, never inline, so EMAIL adapters may be `GLOBAL` with `maxDataClass: INTERNAL`.
- Failover: Primary 5xx or reputation block → secondary provider for the same brand domain if DKIM is pre-provisioned there; otherwise queue and alert.
- Health: Provider API ping + daily seed-list delivery test.
- Config: `int.email.provider`, `int.email.from.<brand>`, `int.email.reply_to`, `int.email.dkim_selector`, `int.email.bounce_webhook_path`.

**SMS**
- Interface: `send(to, templateId, vars, {senderId, dltEntityId, idempotencyKey})`, `getStatus(id)`, `registerTemplate(dlt)`, `handleWebhook()`.
- Reference: Exotel (DLT-compliant, India).
- Alternatives: Kaleyra; MSG91; Gupshup; Twilio (international numbers only; GLOBAL); AWS SNS (India sender ID via DLT **[VERIFY]**).
- Residency: SMS contains INTERNAL data (OTP, references), never REGULATED. Indian traffic must use DLT-registered templates and headers.
- Failover: Provider error or DLR timeout > 60 s → secondary with the same DLT template mapping; OTP channel also offers email/WhatsApp fallback in UI.
- Health: Balance/credit check + canary to a monitored number daily.
- Config: `int.sms.provider`, `int.sms.dlt_entity_id`, `int.sms.sender_id.<brand>`, `int.sms.template_map`.

**WHATSAPP**
- Interface: `sendTemplate(to, templateName, lang, components, idempotencyKey)`, `sendSession(to, message)`, `uploadMedia(file)`, `getTemplateStatus(name)`, `submitTemplate(spec)`, `handleWebhook()`, `getConversationCost(category)`.
- Reference: Meta WhatsApp Cloud API (direct).
- Alternatives: Gupshup BSP; Exotel BSP; Infobip BSP; Twilio BSP (GLOBAL).
- Residency: Message content INTERNAL; media may be CONFIDENTIAL → send as secure link. Meta processes globally; `maxDataClass: INTERNAL`. INR billing required by 31 Dec 2026; per-message pricing by template category since 1 Jul 2025 — the adapter exposes category and cost so OH8 can bill.
- Failover: BSP outage → alternative BSP only if the WABA is shared/migratable (usually not); otherwise fall back to SMS/EMAIL channel with notice. Template approval state is cached.
- Health: Phone-number quality rating and messaging-tier fetch.
- Config: `int.whatsapp.provider`, `int.whatsapp.waba_id.<brand>`, `int.whatsapp.phone_id.<brand>`, `int.whatsapp.template_namespace`, `int.whatsapp.webhook_verify_token` (secret).

**PUSH**
- Interface: `register(deviceToken, platform, userId)`, `send(userIds, notification, data)`, `sendTopic(topic, ...)`, `unregister(token)`.
- Reference: Expo Push Service (for Expo apps) over FCM/APNs.
- Alternatives: Firebase Cloud Messaging direct; APNs direct; OneSignal (GLOBAL); Web Push (VAPID) for browsers.
- Residency: Payloads INTERNAL only (title + deep link); content fetched in-app. GLOBAL acceptable.
- Failover: Expo outage → FCM/APNs direct adapter using stored native tokens.
- Health: Receipt check of a canary push to a test device.
- Config: `int.push.provider`, `int.push.fcm_project_id`, `int.push.apns_topic`.

**VOICE**
- Interface: `call(to, flowId, vars)`, `ivr(sessionId, input)`, `recordConsent(sessionId)`, `transcribe(recordingId)` (delegates to SPEECH), `getRecording(id)`.
- Reference: Exotel Voice.
- Alternatives: Kaleyra Voice; Twilio Voice (GLOBAL); Knowlarity; Ozonetel.
- Residency: Recordings are CONFIDENTIAL (and REGULATED for collections under RBI Digital Lending Directions); recordings are pulled into STORAGE within 24 h and deleted at the provider; `IN` providers only for FBX/UDF.
- Failover: Secondary provider for outbound campaigns; inbound numbers cannot fail over without porting (documented RTO).
- Health: Account status + canary call to a test number weekly.
- Config: `int.voice.provider`, `int.voice.caller_id.<brand>`, `int.voice.recording.pull_hours`.

**PAYMENTS** (collection of fees from customers; hosted/tokenised checkout only — PCI DSS SAQ A)
- Interface: `createOrder(amount, currency, customer, notes, idempotencyKey)`, `createCheckoutSession(orderId, returnUrls)`, `verifySignature(payload)`, `capture(paymentId)`, `refund(paymentId, amount, reason, idempotencyKey)`, `createMandate(customer, plan)` (UPI AutoPay/eNACH), `handleWebhook()`, `reconcile(dateRange)`.
- Reference: Razorpay (RBI PA-authorised Dec 2023).
- Alternatives: PayU (PA-authorised May 2025); Cashfree (PA-authorised Dec 2023); PhonePe PG; Stripe (international cards only, GLOBAL).
- Residency: Card data never touches Infrabyx systems (hosted checkout); payment metadata is REGULATED; Indian PAs are `IN`.
- Failover: Primary PA degraded (success rate < 80 % over 10 min, or API 5xx) → new checkout sessions route to secondary PA; in-flight orders complete on the original PA. Mandates are PA-bound and never fail over.
- Health: PA status endpoint + synthetic order creation in test mode hourly.
- Config: `int.payments.primary`, `int.payments.secondary`, `int.payments.webhook_path`, `int.payments.settlement_account_ref`, `int.payments.methods_enabled`.
- Billing engine of record is OH8 (IPB-D-07); products emit `in.infrabyx.billing.SubscriptionPaymentReceived.v1` (Ecosystem Spec §6.27; every `billing.Payment*` name is superseded, Spec §6.17) and never compute invoices locally. *(rev. 26 Oct 2026)*

**PAYOUTS** (disbursement to customers/vendors — FBX, UDF, OH payroll)
- Interface: `createBeneficiary(spec)`, `validateAccount(ifsc, account)` (penny-drop), `payout(beneficiaryId, amount, mode{IMPS,NEFT,RTGS,UPI}, idempotencyKey)`, `getStatus(id)`, `reversalWebhook()`, `balance()`.
- Reference: RazorpayX.
- Alternatives: Cashfree Payouts; bank APIs (ICICI/HDFC/Yes Bank connected banking — adapter per bank **[VERIFY: partner bank onboarding]**); Decentro; NPCI UPI via sponsor bank.
- Residency: REGULATED; `IN` only.
- Failover: Payouts never auto-fail over (double-disbursement risk). Failure → maker-checker queue for manual re-route.
- Health: Balance fetch + beneficiary validation canary.
- Config: `int.payouts.provider`, `int.payouts.account_ref`, `int.payouts.max_auto_amount`, `int.payouts.dual_approval_above`.

**ESIGN**
- Interface: `createEnvelope(doc, signers[], order, fields)`, `sendForSignature(envelopeId)`, `getStatus(envelopeId)`, `downloadSigned(envelopeId)`, `aadhaarEsign(session)`, `dscSign(session)`, `verifySignature(pdf)`, `handleWebhook()`.
- Reference: LawDocs eSign (in-house, lawdocs.in) — Aadhaar eSign via a licensed ESP, DSC and electronic signature (IT Act s.3A/Second Schedule).
- Alternatives: Leegality; Digio; eMudhra emSigner; DocuSign (GLOBAL; electronic signature only, no Aadhaar).
- Residency: Signed documents REGULATED/CONFIDENTIAL; `IN`. Signature records store `alg`, `key_id`, `cert_chain_ref` (crypto-agility).
- Failover: ESP outage → queue envelopes; offer DSC/electronic signature path where legally sufficient; never silently downgrade signature type (requires signer consent and legal-sufficiency rule from RULES).
- Health: ESP status + test-mode envelope daily.
- Config: `int.esign.provider`, `int.esign.default_type`, `int.esign.esp_id`, `int.esign.reminder_schedule`.

**ESTAMP**
- Interface: `quoteDuty(state, instrument, consideration)` (delegates to RULES), `purchase(state, amount, parties, idempotencyKey)`, `attach(certificateId, documentId)`, `verify(certificateId)`, `handleWebhook()`.
- Reference: SHCIL e-Stamp via aggregator (Leegality or Digio) **[VERIFY: direct SHCIL API availability]**.
- Alternatives: NeSL (bank documents); state portals (Maharashtra GRAS, Karnataka Kaveri — adapter per state); manual stamp paper upload adapter (records physical stamp details).
- Residency: REGULATED; `IN`.
- Failover: None automatic; purchase failures land in a maker-checker queue. `esign.stamp.national_regime` flag reserved for a national regime.
- Health: Aggregator status.
- Config: `int.estamp.provider`, `int.estamp.states_enabled`, `int.estamp.rule_set_id`.

**KYC**
- Interface: `verifyPan(pan, name)`, `verifyAadhaarOffline(xml, shareCode)`, `digilockerPull(consentSession, docTypes)`, `ckycSearch(id)`, `ckycDownload(ckycNo)`, `startVcip(session)`, `livenessCheck(frames)`, `faceMatch(a, b)`, `bankAccountVerify(ifsc, acct)`, `ovdOcr(image)` (delegates to OCR), `amlScreen(party)`.
- Reference: HyperVerge (V-CIP, liveness v2, face match) + Digio (DigiLocker, CKYC) + Signzy (PAN, bank) — a composite reference because no single vendor covers all methods **[VERIFY: current vendor coverage]**.
- Alternatives: IDfy; Karza; Perfios; Setu; AuthBridge; direct CKYC/UIDAI integration via a licensed AUA/KUA.
- Residency: REGULATED; `IN` only; vendor must contractually delete raw data within 24 h (RBI Digital Lending Directions 2025 data rules). V-CIP sessions store liveness score, face-match score, geo, official ID and vendor model version.
- Failover: Per method; PAN/bank verification fail over to secondary; V-CIP sessions do not (session is vendor-bound); the UI offers rescheduling.
- Health: Vendor status + daily test-PAN canary.
- Config: `int.kyc.<method>.provider`, `int.kyc.vcip.liveness_threshold`, `int.kyc.data_delete_hours` (24), `int.kyc.aml.lists_enabled`.

**COMPANY_DATA**
- Interface: `lookupCin(cin)`, `lookupLlpin(llpin)`, `getDirectors(cin)`, `getCharges(cin)`, `getFilings(cin, since)`, `gstinLookup(gstin)`, `watch(cin, events)`.
- Reference: MCA V3 public data via an aggregator (Probe42 or Tofler **[VERIFY: licence terms]**) plus GSTN via a GSP (Masters India or ClearTax **[VERIFY]**).
- Alternatives: Zauba Corp; Karza; direct MCA21 scraping is forbidden (terms of use).
- Residency: PUBLIC/INTERNAL; `IN` preferred.
- Failover: Secondary aggregator; stale cache served with `as_of` label.
- Health: Canary CIN lookup.
- Config: `int.company_data.provider`, `int.company_data.cache_hours`, `int.company_data.gsp_provider`.

**LLM** (IPB-D-06)
- Interface: `complete(request{model_class, messages, tools, max_tokens, data_class, tenantId, trace})`, `stream(...)`, `countTokens(...)`, `listModels()`, `getModelCard(modelId)`, `getProviderPolicy(modelId)` (retention, residency, attestation).
- Reference: Anthropic Claude via Amazon Bedrock (ap-south-1) for CONFIDENTIAL/REGULATED (zero-retention, India-resident); Anthropic direct API for INTERNAL/PUBLIC.
- Alternatives: OpenAI / Azure OpenAI (Central India **[VERIFY: model availability]**); Google Gemini via Vertex AI asia-south1; xAI Grok (GLOBAL); Sarvam (India) and Bhashini (India, Indic); self-hosted vLLM/Ollama on in-cluster GPU nodes (IN, attestable with `ai.inference.confidential_only`).
- Residency: REGULATED/CONFIDENTIAL → `IN-ZR` only; fail closed (`IPB-AI-021`, IPB-03 §03.6). PUBLIC/INTERNAL → any. Every output stores `model_id`, `provider`, `prompt_hash`, `generated_at`, provenance manifest (IT Rules SGI amendment, in force 20 Feb 2026).
- Failover: Per `model_class` (e.g. `reasoning-large`, `fast-small`, `indic`): primary → secondary of the same residency class; cross-residency failover forbidden. Output schema validation retries once on the secondary.
- Health: Tiny completion canary per provider every 5 min; cost and latency gauges.
- Config: `ai.llm.routing` (YAML, 01.4.5), `ai.llm.zero_retention_required_classes`, `ai.llm.max_cost_per_tenant_day`, `ai.llm.attestation_required`.

**EMBEDDING**
- Interface: `embed(texts[], model, data_class)`, `dims(model)`, `listModels()`.
- Reference: Amazon Bedrock Titan/Cohere embeddings (ap-south-1) **[VERIFY: model list in Mumbai]**; fallback self-hosted `bge-m3` via vLLM for Indic.
- Alternatives: OpenAI text-embedding-3 (GLOBAL); Vertex AI text-embedding (asia-south1); Sarvam embeddings; self-hosted sentence-transformers.
- Residency: Same rule as LLM. Embedding model is recorded on every vector; a model change triggers a re-embed job (never mixed models in one collection).
- Failover: Same-residency secondary only.
- Health: Canary embed + dimension check.
- Config: `ai.embedding.model`, `ai.embedding.routing`, `ai.embedding.batch_size`.

**IMAGE_GEN**
- Interface: `generate(prompt, size, style, data_class)`, `edit(image, mask, prompt)`, `label(image, manifest)` (adds visible label + C2PA-style sidecar), `moderate(prompt)`.
- Reference: Amazon Bedrock image models (ap-south-1) **[VERIFY: availability]**; else Google Imagen via Vertex AI asia-south1.
- Alternatives: OpenAI image API (GLOBAL); Stability AI (GLOBAL); self-hosted Stable Diffusion/FLUX on GPU nodes.
- Residency: Prompts are INTERNAL (marketing/CMS use). Generated images are labelled as AI-generated (IT Rules SGI) before storage.
- Failover: Secondary provider; identical labelling.
- Health: Monthly canary (cost-aware), provider ping daily.
- Config: `ai.image_gen.provider`, `ai.image_gen.label_style`, `ai.image_gen.allowed_apps` (`public`, `console`).

**SPEECH** (STT/TTS)
- Interface: `transcribe(audio, lang, diarise, data_class)`, `transcribeStream(...)`, `synthesise(text, voice, lang)`, `listVoices()`, `detectLanguage(audio)`.
- Reference: Bhashini (Indic STT/TTS, India) for Indian languages; Amazon Transcribe/Polly (ap-south-1) for English.
- Alternatives: Sarvam Saaras/Bulbul; Gnani Vachana; Google Speech-to-Text/TTS (asia-south1); Azure Speech (Central India); OpenAI Whisper (GLOBAL) or self-hosted Whisper.
- Residency: Hearing recordings (EQ), collections calls (FBX/UDF) are CONFIDENTIAL/REGULATED → `IN` only.
- Failover: Same-residency secondary; partial transcripts flagged.
- Health: Short canary clip per provider daily.
- Config: `ai.speech.stt.routing`, `ai.speech.tts.routing`, `ai.speech.diarisation_enabled`.

**TRANSLATE**
- Interface: `translate(text, from, to, domain, data_class)`, `detect(text)`, `glossary(tenantId)`.
- Reference: Bhashini translation (22 scheduled languages).
- Alternatives: Sarvam; Google Cloud Translation (asia-south1); Azure Translator (Central India); LLM-based translation via LLM port (for legal register).
- Residency: As LLM.
- Failover: Same-residency secondary; legal documents always flagged "machine translation — not authoritative".
- Health: Canary sentence daily.
- Config: `ai.translate.routing`, `ai.translate.glossary_enabled`.

**OCR**
- Interface: `extractText(file, lang[])`, `extractFields(file, schemaId)` (document AI), `extractTables(file)`, `classify(file)`.
- Reference: Amazon Textract (ap-south-1).
- Alternatives: Google Document AI (asia-south1 **[VERIFY]**); Azure Document Intelligence (Central India); self-hosted Tesseract/PaddleOCR; LLM vision via LLM port for complex layouts.
- Residency: KYC documents REGULATED → `IN`; vendor deletion within 24 h.
- Failover: Same-residency secondary; confidence below threshold routes to human review queue.
- Health: Canary document daily.
- Config: `ai.ocr.provider`, `ai.ocr.confidence_threshold`, `ai.ocr.human_review_below`.

**DOCGEN**
- Interface: `render(templateId, data, format)`, `renderBatch(...)`, `previewHtml(templateId, data)`, `listTemplates(tenantId)`, `validateTemplate(file)`.
- Reference: docxtemplater (DOCX templating) + Gotenberg (self-hosted, in-cluster) for DOCX→PDF/HTML.
- Alternatives: Carbone (self-hosted); LibreOffice headless adapter; Puppeteer HTML→PDF (in-cluster); OnlyOffice Document Server.
- Residency: In-cluster, `IN`.
- Failover: Gotenberg pool unavailable → Puppeteer HTML path for HTML templates; DOCX templates queue.
- Health: Render a one-line template every 60 s.
- Config: `int.docgen.gotenberg_url`, `int.docgen.max_pages`, `int.docgen.fonts_dir`.

**PDF**
- Interface: `merge(files)`, `split(file, ranges)`, `stamp(file, text|image, position)`, `sign(file, keyRef, visibleField)` (PAdES via KMS), `redact(file, regions)`, `toPdfA(file)`, `extractPages(...)`, `watermark(file, text)`, `linearise(file)`.
- Reference: `pdf-lib` + `pdfcpu` CLI (in-cluster) + Gotenberg for PDF/A conversion.
- Alternatives: PDFBox (JVM sidecar); iText (commercial licence, requires ADR); Ghostscript adapter; qpdf.
- Residency: In-cluster.
- Failover: Alternative library path per operation; operations are pure functions over STORAGE objects.
- Health: Merge canary.
- Config: `int.pdf.pdfa_default`, `int.pdf.max_size_mb`.

**VIDEO_MEET**
- Interface: `createRoom(caseId, participants, policy{recording, lobby, e2ee})`, `joinToken(roomId, userId, role)`, `startRecording(roomId)`, `stopRecording()`, `fetchRecording(roomId)` (pulls into STORAGE), `endRoom()`, `handleWebhook()`.
- Reference: Self-hosted LiveKit (in-cluster, ap-south-1, TURN in India) for EQ hearings and FBX V-CIP.
- Alternatives: Jitsi (self-hosted); Daily.co (GLOBAL — INTERNAL meetings only); Zoom Meeting SDK (GLOBAL; INTERNAL only); Microsoft Teams via WORKSPACE port (staff meetings).
- Residency: Hearing recordings CONFIDENTIAL/REGULATED → `IN` self-hosted only. Recordings move to STORAGE with retention lock and a SHA-256 manifest (tamper-evident).
- Failover: Secondary self-hosted region (ap-south-2) room creation; in-progress rooms are not migrated; the hearing runbook reschedules.
- Health: Room create/destroy canary every 5 min.
- Config: `int.video_meet.provider`, `int.video_meet.recording.default` (on for hearings), `int.video_meet.turn_servers`.

**CALENDAR**
- Interface: `createEvent(calendarRef, event)`, `updateEvent()`, `cancelEvent()`, `freeBusy(refs, window)`, `subscribe(calendarRef)` (webhook/push), `icsFeed(userId)`.
- Reference: Internal calendar module + ICS feeds (no vendor dependency), with CalDAV adapter.
- Alternatives: Google Calendar API; Microsoft Graph Calendar; CalDAV (Nextcloud/Radicale).
- Residency: Event titles INTERNAL (case refs only). Vendor adapters GLOBAL acceptable with `maxDataClass: INTERNAL`.
- Failover: Vendor sync down → internal calendar remains authoritative; sync resumes with reconciliation.
- Health: Free/busy canary.
- Config: `int.calendar.providers_enabled`, `int.calendar.sync_interval_minutes`.

**WORKSPACE** (M365 / Google Workspace)
- Interface: `listFiles(driveRef, folder)`, `getFile(id)`, `putFile(folder, file)`, `shareLink(id, policy)`, `sendMailAsUser(user, message)` (staff only), `provisionUser(spec)` (HRMS → OH), `directorySync()`.
- Reference: Microsoft Graph (M365, India data residency where tenant is India-homed **[VERIFY: tenant geo]**).
- Alternatives: Google Workspace APIs; Nextcloud (self-hosted); none (feature disabled).
- Residency: Staff data CONFIDENTIAL; tenant must be India-homed; customer REGULATED data is never written to WORKSPACE.
- Failover: None; feature degrades to STORAGE-based sharing.
- Health: Delegated token validity + canary list.
- Config: `int.workspace.provider`, `int.workspace.tenant_id`, `int.workspace.allowed_scopes`.

**ANALYTICS**
- Interface: `track(event, props, consentState)`, `identify(anonId, traits)`, `page(route)`, `flush()`, `exportRaw(dateRange)`.
- Reference: Self-hosted PostHog (in-cluster, ap-south-1) — consent-gated, never on authenticated or sensitive routes (brief §6).
- Alternatives: Plausible (self-hosted); Matomo (self-hosted); GA4 via TAG_MANAGER (GLOBAL, PUBLIC pages only, consent-gated); Mixpanel (GLOBAL, INTERNAL product analytics with pseudonymous IDs).
- Residency: Pseudonymous INTERNAL only; `IN` for reference.
- Failover: Buffer in browser/worker up to 500 events, drop on overflow; analytics is never on the critical path.
- Health: Ingest canary.
- Config: `mkt.analytics.provider`, `mkt.analytics.consent_required` (true, locked), `mkt.analytics.blocked_routes` (`/app/*`, `/console/*`).

**TAG_MANAGER**
- Interface: `renderContainer(brandId, consentState)`, `serverSideEvent(event, consentState)`, `listTags(brandId)`, `approveTag(tagId)` (maker-checker), `blockTag(tagId)`.
- Reference: Google Tag Manager server-side container (self-hosted on in-cluster Cloud Run-equivalent) with first-party cookies and data redaction, loaded only on `apps/public` after consent.
- Alternatives: Client-side GTM (consent-gated); Tealium (GLOBAL); none (hard-coded consent-gated tags).
- Residency: PUBLIC pages only; no PII; redaction on.
- Failover: Container unavailable → no tags (fail closed, pages work).
- Health: Container fetch canary.
- Config: `mkt.tags.provider`, `mkt.tags.container_id.<brand>`, `mkt.tags.server_side` (true), `mkt.tags.allowed_vendors`.

**FEATURE_FLAG**
- Interface (OpenFeature): `getBooleanValue(key, default, ctx)`, `getStringValue()`, `getNumberValue()`, `getObjectValue()`, `track(event)`; management: `createFlag(spec)`, `setTargeting(key, rules)`, `kill(key)`, `listFlags(filter)`, `flagDebt()`.
- Reference: Unleash (self-hosted, in-cluster) via OpenFeature SDK.
- Alternatives: Flagsmith (self-hosted); flagd with GitOps flag files; LaunchDarkly (GLOBAL; INTERNAL context only); database-backed provider in `packages/config` (fallback).
- Residency: Flag contexts carry hashed tenant/user IDs; `IN` reference.
- Failover: Provider unreachable → last-known flag snapshot (cached ≤ 24 h), then defaults from the flag registry; `kill.*` flags default to **on** (safe state) when unknown.
- Health: Flag fetch canary.
- Config: `eng.flags.provider`, `eng.flags.url`, `eng.flags.snapshot_ttl_hours`.

**OBSERVABILITY**
- Interface: `startSpan(name, attrs)`, `recordMetric(name, value, attrs)`, `log(level, msg, ctx)`, `aiTrace(op, attrs)` (OTel GenAI conventions, `gen_ai.provider.name` etc.), `exportConfig()`.
- Reference: OpenTelemetry SDK → OTel Collector (in-cluster) → Grafana stack: Tempo (traces), Loki (logs), Mimir/Prometheus (metrics), Grafana dashboards; 180-day log retention in India (CERT-In) via Loki on S3 with Object Lock.
- Alternatives: Datadog (GLOBAL; India site unavailable **[VERIFY: Datadog region list]** → INTERNAL telemetry only, logs must stay in India); Dynatrace; Elastic Observability (self-hosted); AWS CloudWatch/X-Ray (ap-south-1).
- Residency: Logs are PII-scrubbed (IPB-02) and `IN`. Traces carry hashed IDs only.
- Failover: Collector buffers to disk (up to 2 GB), drops metrics before logs; audit ledger is never dependent on OBSERVABILITY.
- Health: Collector pipeline health + self-metrics.
- Config: `eng.otel.endpoint`, `eng.otel.sampling_ratio`, `eng.otel.genai.capture_content` (false), `eng.logs.retention_days` (180, minimum, locked), `eng.logs.region` (`IN`, locked).

**ERROR_TRACKING**
- Interface: `captureException(err, ctx)`, `captureMessage()`, `setUser(hashedId)`, `addBreadcrumb()`, `releaseHealth(release)`.
- Reference: Self-hosted GlitchTip or Sentry (self-hosted, in-cluster) — Sentry SDK protocol.
- Alternatives: Sentry SaaS (GLOBAL; PII scrubbing on, INTERNAL only); Bugsnag (GLOBAL); Datadog Error Tracking; Rollbar.
- Residency: Stack traces may leak CONFIDENTIAL data; scrubbers enforce INTERNAL. Reference `IN`.
- Failover: Drop with local log; never block requests.
- Health: Test event per deploy.
- Config: `eng.errors.dsn` (secret), `eng.errors.sample_rate`, `eng.errors.scrub_fields`.

**DNS_CDN**
- Interface: `upsertRecord(zone, record)`, `verifyDomain(domain, token)` (white-label host map), `issueCertificate(hosts)`, `purge(paths)`, `setWafRule(rule)`, `setRateLimit(rule)`, `getEdgeConfig()`.
- Reference: Cloudflare (DNS, CDN, WAF, bot management, hybrid X25519MLKEM768 TLS, HTTP/3 on) in front of AWS ALB.
- Alternatives: AWS Route 53 + CloudFront + WAF + ACM; Azure Front Door + DNS; Google Cloud DNS + Cloud CDN + Cloud Armor; Fastly.
- Residency: Edge caches PUBLIC content only; authenticated routes are `Cache-Control: private, no-store`. Cloudflare has Indian PoPs; origin remains in India.
- Failover: Secondary DNS provider with low TTL (300 s) and pre-provisioned certificates via ACM; documented swap RTO ≤ 4 h.
- Health: DNS resolution + edge TLS canary from India vantage points.
- Config: `int.dns_cdn.provider`, `int.dns_cdn.zone.<brand>`, `int.dns_cdn.waf_mode`, `int.dns_cdn.http3` (true), `int.dns_cdn.hybrid_kem` (true).

**GEO/MAPS**
- Interface: `geocode(address)`, `reverse(lat, lng)`, `distance(a, b)`, `pinLookup(pincode)`, `staticMap(center, markers)`, `autocomplete(query, country)`.
- Reference: MapmyIndia (Mappls) — India-resident.
- Alternatives: Google Maps Platform (GLOBAL); OpenStreetMap/Nominatim (self-hosted); India Post pincode dataset (offline, bundled).
- Residency: Addresses are CONFIDENTIAL in lending (FBX/UDF field visits) → `IN`; PUBLIC office maps may use GLOBAL.
- Failover: Offline pincode dataset for validation; secondary provider for geocoding.
- Health: Geocode canary.
- Config: `int.geo.provider`, `int.geo.country_restrict` (`IN`).

**RULES**
- Interface: `evaluate(ruleSetId, version, input, ctx)`, `evaluateCel(expr, input)`, `listRuleSets(tenantId)`, `publish(ruleSetId, version)` (maker-checker), `simulate(ruleSetId, inputs[])`, `explain(decision)`.
- Reference: GoRules ZEN engine (JDM decision tables/graphs, embedded) + CEL (cel-js) for guards and expressions, in `packages/rules`.
- Alternatives: json-rules-engine; Drools (JVM sidecar; bank clients); OPA/Rego (policy-style rules); Camunda DMN.
- Residency: In-process.
- Failover: Engine error → decision `UNDETERMINED`, routed to human queue; never default to allow/approve.
- Health: Canary decision table evaluation.
- Config: `rules.engine`, `rules.cel.max_cost`, `rules.publish.requires_checker` (true, locked).

**BILLING** (to OH8 — the billing engine of record)
- Interface: `recordUsage(tenantId, meter, qty, ts, idempotencyKey)`, `getPlan(tenantId)`, `getEntitlements(tenantId)`, `getInvoices(tenantId)`, `getBalance(tenantId)`, `subscribe(tenantId, planId)`, `changePlan(...)`, `cancel(...)`.
- Reference: OH8 Billing API (internal, via IPB-10 client with mTLS), events `in.infrabyx.billing.*`.
- Alternatives: Local read-model mirror (`billing_mirror` schema) served when OH8 is unreachable (read-only); Stripe Billing (international entities only, via OH8 adapter, never direct); Zoho Billing (via OH8 adapter).
- Residency: `IN`.
- Failover: OH8 down → entitlements served from the mirror (≤ 24 h stale allowed; after that, degrade to plan defaults with a banner); usage records buffer in outbox and replay.
- Health: OH8 `/health/ready` + mirror lag gauge.
- Config: `int.billing.oh8_url`, `int.billing.mirror_max_stale_hours` (24), `int.billing.meters_enabled`.

**CRM** (to OH3 — group CRM)
- Interface: `upsertLead(lead, source, consent)`, `upsertAccount(account)`, `logActivity(entityRef, activity)`, `getAccountForTenant(tenantId)`, `createTicket(...)` (hand-off to OH support), `syncContacts(tenantId)`.
- Reference: OH3 CRM API (internal).
- Alternatives: HubSpot (GLOBAL; marketing leads only, consent-gated); Zoho CRM (India DC available **[VERIFY]**); local `crm_mirror` read-model.
- Residency: Leads are CONFIDENTIAL; `IN`.
- Failover: Outbox buffering; leads are never lost (outbox is durable); UI shows "queued".
- Config: `int.crm.oh3_url`, `int.crm.lead_sources_enabled`.

Catalogue count: 42 primary ports (SPEECH counts once; GEO/MAPS once) plus 22 supplementary and product-specific ports in 01.4.4.3. Products add domain ports (for example FBX `BUREAU`, `AA_FIU`, `ULI_GATEWAY`; EQ `COURT_DATA`; LD `ECOURTS`) through 01.4.4.0.

#### 01.4.4.3 Supplementary ports registered by other IPB files

The following ports are introduced by IPB-03 to IPB-10 and are registered here under 01.4.4.0. Each follows the common conventions in 01.4.4.1. "Internal" means the reference adapter is an in-process module of the same monolith and the alternative is the HTTP client to the Operations Hub (or vice versa), so the capability is portable between "built-in" and "group service" without code change.

| Port | Purpose | Reference adapter | Alternatives | Residency | Owner file |
|---|---|---|---|---|---|
| RERANK | Re-rank retrieved passages for RAG | Cohere Rerank (GLOBAL, PUBLIC/INTERNAL only) | self-hosted bge-reranker (IN); none (skip) | by data class | IPB-03 |
| INTERPRETER | Book ISL / language interpreters for calls and hearings | Internal roster module | Partner agency API; manual queue | IN | IPB-06 |
| NOTIFY | Fan-out of in-app, email, SMS, WhatsApp, push through one call | Internal `packages/notify` | OH notification service via HTTP | IN | IPB-07 |
| TRUST | Read/write vendor-assurance documents and acknowledgements | OH14.6 HTTP client | Internal mirror (read-only fallback) | IN | IPB-08 |
| SUPPORT | Create/read support tickets from feedback widget and help | OH6 HTTP client | Internal lightweight ticket table; Zendesk/Freshdesk adapters | IN | IPB-04 |
| BACKLOG | Push ideas/bugs to the product backlog | OH product backlog client | GitHub Issues; Linear; Jira | IN/GLOBAL (no PII) | IPB-04 |
| CONSENT | Record and query consent artefacts (cookie, marketing, WhatsApp, DPDP purposes) | Internal `consent` module | Consent-manager API (DPDP registered CM, from 13 Nov 2026) | IN | IPB-04, IPB-05 |
| MEDIA | Image/video processing: re-encode, strip metadata, thumbnails, focal crop | sharp + ffmpeg in worker | Cloudinary / imgix (PUBLIC assets only) | IN for non-public | IPB-04 |
| AV | Malware scanning of every upload | ClamAV in-cluster | VirusTotal API (hash-only lookups); cloud-native scanner (GuardDuty Malware Protection / Defender) | IN | IPB-02, IPB-04 |
| PLAGIARISM | Duplicate/plagiarism check for blog and content import | Internal shingling + web search hook | Copyscape API; Turnitin (optional) | GLOBAL (public text only) | IPB-04 |
| EGRESS | Allow-listed outbound HTTP for embeds, webhooks, link previews (SSRF guard) | Internal egress proxy with allow-list | Cloud NAT + WAF egress rules | IN | IPB-02, IPB-04 |
| LAW_REGISTER | Stale-citation and regulatory-reference lookups for help keys and content lint | LDC legal rules register (HTTP, read-only) | Product-local snapshot (read-only JSON) | IN | IPB-05, IPB-07 |
| HR | Careers applications and intern/joiner data hand-off | OH10 HTTP client | Internal applications table; ATS adapters | IN | IPB-04 |

| SOCIAL_PUBLISHER | Publish and schedule posts to LinkedIn, X, Instagram, YouTube, Facebook (OH17) | Direct platform APIs via `packages/connectors/social` | Postiz / Buffer-type scheduler API; manual export queue | GLOBAL (PUBLIC content only) | OH v1.1 |
| ADS | Campaign and audience management for Meta, Google, LinkedIn ads (OH17) | Meta Marketing API | Google Ads API; LinkedIn Marketing API; none (manual) | GLOBAL (no customer PII; hashed audiences only with consent) | OH v1.1 |
| CRM_MARKETING | Marketing automation and sequences on top of CRM port (OH3/OH17) | Brevo | Mautic (self-hosted); HubSpot | IN preferred; GLOBAL only for INTERNAL/PUBLIC | OH v1.1 |
| ACCOUNTING | Post invoices, payments and payroll journals to the books (OH8/OH10) | Tally Prime connector | Zoho Books; ERPNext; CSV export | IN | OH v1.1 |
| PAYROLL | Statutory payroll computation and filings when not computed in-house (OH10) | Internal payroll engine | Payroll-provider API (e.g., greytHR / Keka / RazorpayX Payroll) [VERIFY APIs] | IN | OH v1.1 |
| BUREAU | Credit-bureau pulls and submissions (FBX; only by the RE under CICRA) | CIBIL (TransUnion) | Experian; Equifax; CRIF High Mark | IN | FBX v1.6 |
| AA_FIU | Account Aggregator FIU consent and data fetch (FBX, UDF via RE) | Sahamati-certified AA client (TSP) | Second TSP; direct AA API | IN | FBX v1.6 |
| ULI_GATEWAY | RBI Unified Lending Interface data services (FBX) | ULI sandbox client [VERIFY onboarding] | none (flag OFF) | IN | FBX v1.6 |
| DISBURSEMENT_RAIL | Disbursement and collection rails (FBX, UDF via RE accounts) | Bank API (IMPS/NEFT/UPI) through the RE's sponsor bank | PAYOUTS port adapters (RazorpayX, Cashfree Payouts); NACH/e-mandate processor | IN | FBX v1.6 |

Product-specific ports (BUREAU, AA_FIU, ULI_GATEWAY, DISBURSEMENT_RAIL) are owned by the product that registers them and are listed here only so that names are unique across the group. *(rev. 26 Oct 2026)*

Short code names used in other files (`APP_PORT`, `MSG_SMTP_PORT`, `OBS_METRICS_PORT`) are environment variables for TCP ports, not capability ports, and are catalogued in IPB-11.

### 01.4.5 `provider_routing` YAML schema

Location: `infra/routing/<product>/<env>.routing.yaml`, loaded by `packages/config` and validated with the Zod schema in `packages/contracts/routing.ts`. Secrets are referenced by SECRETS path, never inlined.

```yaml
# infra/routing/fbx/prod.routing.yaml
version: 1
defaults:
  circuit_breaker:
    failure_threshold: 5          # consecutive failures
    error_rate_threshold: 0.5     # over window
    window_seconds: 60
    open_seconds: 30              # before half-open
    half_open_max_calls: 3
  timeout_ms: 8000
  retries: 2
  retry_backoff_ms: 400
  residency_policy:
    PUBLIC: [IN, IN-ZR, GLOBAL]
    INTERNAL: [IN, IN-ZR, GLOBAL]
    CONFIDENTIAL: [IN, IN-ZR]
    REGULATED: [IN-ZR, IN]       # IN-ZR preferred; IN allowed where vendor contract has 24h deletion
    SECRET: [IN]
ports:
  STORAGE:
    primary:
      adapter: s3
      residency: IN
      max_data_class: SECRET
      config:
        region: ap-south-1
        bucket_prefix: infrabyx-fbx-prod
        object_lock: compliance
      secrets: secrets/prod/storage/s3
    secondary:
      adapter: s3
      residency: IN
      max_data_class: SECRET
      config: {region: ap-south-2, bucket_prefix: infrabyx-fbx-dr, object_lock: compliance}
      mode: read_only_failover     # read_only_failover | active_failover | none
    health_interval_seconds: 30
  LLM:
    model_classes:
      reasoning-large:
        primary:   {adapter: anthropic-bedrock, model: "<model id — VERIFY at build time>", residency: IN-ZR, max_data_class: REGULATED, secrets: secrets/prod/llm/bedrock}
        secondary: {adapter: vllm-selfhosted,   model: "<model id>", residency: IN,    max_data_class: REGULATED, attestation: required}
      fast-small:
        primary:   {adapter: anthropic-direct, model: "<model id>", residency: GLOBAL, max_data_class: INTERNAL, secrets: secrets/prod/llm/anthropic}
        secondary: {adapter: gemini-vertex,    model: "<model id>", residency: IN,     max_data_class: CONFIDENTIAL, config: {location: asia-south1}}
      indic:
        primary:   {adapter: sarvam, model: "<model id>", residency: IN, max_data_class: CONFIDENTIAL}
        secondary: {adapter: bhashini, residency: IN, max_data_class: CONFIDENTIAL}
    circuit_breaker: {failure_threshold: 3, open_seconds: 60}
  PAYMENTS:
    primary:   {adapter: razorpay, residency: IN, max_data_class: REGULATED, secrets: secrets/prod/payments/razorpay}
    secondary: {adapter: payu,     residency: IN, max_data_class: REGULATED, secrets: secrets/prod/payments/payu, mode: active_failover}
    failover_rule:
      success_rate_below: 0.8
      over_minutes: 10
```

Schema rules enforced at load:

- Every port in the manifest `ports` lists of loaded modules must have a `primary`.
- `secondary.residency` must satisfy `residency_policy` for every data class up to `primary.max_data_class`; otherwise `mode` must be `none` (load error `IPB-PORT-005` if a REGULATED-capable primary has a GLOBAL secondary with failover enabled).
- `secrets` values must be SECRETS paths (`secrets/<env>/…`), never literals.
- Changing `prod.routing.yaml` is a change-class **normal** change under IPB-09 with maker-checker; changing a `primary` adapter for STORAGE, KMS, IDENTITY or PAYMENTS is **normal + CAB**.

### 01.4.6 Database portability rules

| Area | Rule |
|---|---|
| Engine | PostgreSQL 16+ (18 preferred). Managed targets: RDS/Aurora PostgreSQL, Azure Database for PostgreSQL Flexible Server, Cloud SQL for PostgreSQL, Supabase (non-prod), self-hosted (CloudNativePG operator). |
| SQL dialect | ANSI SQL. Allowed PostgreSQL-specific constructs: `jsonb`, arrays, `RETURNING`, `ON CONFLICT`, CTEs, window functions, partitioning, RLS, `GENERATED` columns, `citext`, `tsvector`. Forbidden: `LISTEN/NOTIFY` as a delivery mechanism (use outbox), `dblink`/`postgres_fdw`, unlogged tables for durable data, procedural logic in triggers beyond audit-chain hashing and `updated_at`. |
| Extensions | Whitelist: `pgvector`, `pg_trgm`, `pgcrypto`, `citext`. Also permitted because they are core/contrib and universally available: `uuid-ossp` (prefer application ULIDs), `btree_gist`. Any other extension → ADR + availability proof on all targets. |
| IDs | Application-generated prefix + ULID (`doc_01J…`). No `SERIAL` for externally visible IDs. |
| Time | `timestamptz` only; application in UTC; display in tenant time zone. |
| Migrations | Drizzle Kit SQL migrations under `apps/api/drizzle/`; `migration-lint` enforces IPB-09 rules; checksum table `meta.migration_checksums`. |
| Roles | Three database roles: `app_rw` (RLS-subject, used by API/worker), `app_migrate` (DDL, used only by the migration job), `app_ro` (reporting/export, RLS-subject). `BYPASSRLS` is never granted to any application role. |
| Connection | PgBouncer (transaction pooling) in-cluster; `SET LOCAL app.tenant_id` per transaction, never per session. |
| Backups | Provider snapshots daily + continuous WAL archiving to STORAGE (Object Lock) + weekly `pg_dump` logical backup to a second provider. Restore drill quarterly (IPB-02). |
| Cross-provider move | Logical replication (`pgoutput`) or `pg_dump`/`pg_restore` for < 200 GB; sequence/identity reset script; RLS policy diff check post-move. |
| Engine-specific | Aurora fast clone, Supabase branching, Cloud SQL IAM auth live only in `infra/` or adapters; never in migrations or module code. |

### 01.4.7 Object storage portability and Object Lock equivalents

| Capability | AWS S3 | Azure Blob Storage | Google Cloud Storage | MinIO |
|---|---|---|---|---|
| WORM retention | S3 Object Lock, **compliance** mode, default retention per bucket + per-object `retain-until-date` | Immutable blob storage: time-based retention policy (**locked** policy), version-level WORM | Bucket retention policy with **retention policy lock**; Object Retention (per-object) | Object Lock (S3-compatible API), compliance mode; bucket versioning required |
| Legal hold | Legal Hold flag | Legal hold tags | Temporary hold / event-based hold | Legal hold (S3 API) |
| Versioning | Required for Object Lock | Blob versioning required for version-level WORM | Object versioning | Versioning required |
| Region | ap-south-1 / ap-south-2 | Central India / South India | asia-south1 / asia-south2 | Any (self-hosted in India) |
| Encryption | SSE-KMS with tenant/platform CMK | CMK in Key Vault | CMEK in Cloud KMS | SSE-KMS via KES + external KMS |
| Replication | S3 Replication (same-account cross-region) | Object replication (GRS not sufficient for lock continuity → use explicit replication) | Dual-region buckets or Storage Transfer Service | `mc mirror`/site replication |
| Adapter method support | Full | Full | Full | Full |

Rules: STORAGE adapters normalise all of the above to `putWithRetention` and `assertImmutable`. A bucket class is `AUDIT`, `REGULATED`, `CONFIDENTIAL`, `GENERAL`, `PUBLIC_ASSETS`; only `GENERAL` and `PUBLIC_ASSETS` may run without lock. Retention defaults: `AUDIT` 8 years, `REGULATED` per product retention rule (minimum 8 years for FBX/UDF loan records **[VERIFY: product-specific statutory retention]**), `CONFIDENTIAL` 1 year lock then lifecycle per tenant policy.

### 01.4.8 Containers and deploy

#### 01.4.8.1 Dockerfile standard (API shown; web/worker identical shape)

```dockerfile
# syntax=docker/dockerfile:1.7
FROM node:24.22.1-bookworm-slim@sha256:<digest> AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@9 --activate

FROM base AS deps
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY packages/ packages/   # package.json files only via .dockerignore allow-list
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch --prod=false

FROM deps AS build
COPY . .
RUN pnpm install --offline --frozen-lockfile && pnpm turbo run build --filter=@infrabyx/api... && pnpm --filter=@infrabyx/api deploy --prod /out

FROM base AS runtime
RUN groupadd -g 10001 app && useradd -u 10001 -g app -m app
WORKDIR /app
COPY --from=build --chown=app:app /out /app
USER 10001
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD ["node", "dist/healthcheck.js"]
ENTRYPOINT ["node", "--enable-source-maps", "dist/main.js"]
```

Rules: no `latest` tags; `.dockerignore` excludes `.env*`, `SEED_CREDENTIALS.md`, `.git`; `trivy image` critical/high must be zero or waived with an expiry; images are built once and promoted across environments by digest (IPB-09).

#### 01.4.8.2 Helm chart values (shared chart `infrabyx-app`)

| Key | Purpose | Default |
|---|---|---|
| `image.repository`, `image.digest` | Promoted image by digest | required |
| `app.kind` | `api` / `worker` / `web` / `public` / `console` | required |
| `env.name` | Environment catalogue name | required |
| `routing.configMap` | Mounts `<env>.routing.yaml` | required |
| `secrets.provider` | `aws-secrets-manager` / `vault` / `azure-keyvault` / `gcp-secret-manager` via CSI driver | required in prod |
| `securityContext` | `runAsNonRoot`, `readOnlyRootFilesystem: true`, `allowPrivilegeEscalation: false`, drop all caps | locked |
| `resources` | Requests/limits per kind | per product |
| `autoscaling` | HPA on CPU + custom queue depth (KEDA for worker) | on in prod |
| `pdb.minAvailable` | 1 (prod ≥ 2 replicas) | |
| `networkPolicy` | Default-deny egress; allow-list per port adapter endpoints | on |
| `probes` | `/health/live`, `/health/ready`, `/health/startup` | |
| `migrations.job` | Pre-upgrade hook running `app_migrate` role; expand-only on deploy | on |
| `otel` | Collector endpoint, sampling | |
| `seed.profile` | Only honoured when `env.name != prod`; chart template fails render if set in prod | null |

#### 01.4.8.3 Compose for local

`infra/compose/docker-compose.yml` profiles: `core` (postgres:18, redis:7, minio with `MINIO_OBJECT_LOCK`-enabled bucket bootstrap, mailpit, keycloak:26 with realm import, temporal + temporal-ui, gotenberg, unleash), `search` (opensearch), `ai` (ollama), `observability` (grafana, tempo, loki, prometheus). `pnpm dev:up` runs `core` and seeds profile `minimal`. Local secrets come from `.env.local` decrypted by SOPS/age — the only environment where env-var secrets are allowed.

### 01.4.9 Terraform modules per cloud

#### 01.4.9.1 Module set (identical names across `aws/`, `azure/`, `gcp/`)

`network`, `kubernetes` (EKS / AKS / GKE), `postgres` (RDS or Aurora / Flexible Server / Cloud SQL), `redis`, `object_storage` (with lock), `kms`, `secrets`, `dns_cdn_edge`, `observability_backend`, `registry`, `iam_workload_identity`, `bastion_breakglass`.

#### 01.4.9.2 Environment stacks

`infra/terraform/envs/<product>/<env>/main.tf` composes modules and writes outputs into the environment's `routing.yaml` and Helm values via a generated `outputs.auto.json`. Remote state per cloud with locking; state is SECRET class.

#### 01.4.9.3 Output contract (every cloud returns the same keys)

| Output | Type | Example (AWS) |
|---|---|---|
| `kubeconfig_ref` | string | Secrets path |
| `postgres.host`, `postgres.port`, `postgres.db`, `postgres.ssl_mode` | string | RDS endpoint, 5432, `fbx`, `verify-full` |
| `postgres.credentials_secret_path` | string | `secrets/prod/db/app_rw` |
| `redis.url_secret_path` | string | |
| `storage.buckets.<class>` | map | `{AUDIT: "infrabyx-fbx-prod-audit", …}` |
| `storage.lock_mode` | string | `compliance` |
| `kms.platform_key_id` | string | ARN / Key Vault URI / resource name |
| `secrets.provider`, `secrets.path_prefix` | string | |
| `edge.zone_id`, `edge.origin_hostname` | string | |
| `observability.otlp_endpoint` | string | |
| `registry.url` | string | |
| `region.primary`, `region.dr` | string | `ap-south-1`, `ap-south-2` |

Validation: `terraform validate` + a schema test asserting all outputs exist with the right types for each cloud; `tflint`, `checkov`/`trivy config` in CI; `platform-skills:terraform` review checklist for IAM blast radius.

### 01.4.10 Environment catalogue summary

Full definitions and promotion rules are in IPB-09 §09.4.3. Summary for portability purposes:

| Env | Database | Storage | Secrets | Seed profile | Adapter residency |
|---|---|---|---|---|---|
| `local` | Compose PostgreSQL 18 | MinIO (lock on) | SOPS `.env.local` | `minimal` | fakes / sandbox |
| `dev` | Supabase project (DB only) or shared RDS dev | S3 dev bucket (no lock) or MinIO | AWS SM dev | `demo` | sandbox |
| `test` (CI) | Testcontainers PostgreSQL 18 | MinIO container | ephemeral | `demo` | fakes |
| `preview` (per PR) | Neon/Supabase branch from `demo` | MinIO/S3 preview prefix | none (fakes only) | `demo` | fakes |
| `staging` | RDS (same engine version as prod) | S3 with lock | AWS SM | `demo` + anonymised | sandbox / test keys |
| `pre-prod` | Production snapshot restore (isolated network) | S3 copy | AWS SM | none (snapshot) | sandbox |
| `prod` | RDS Multi-AZ ap-south-1 | S3 lock + replication | AWS SM via IRSA | **refused** | live, `IN` |
| `dr` | Read replica / promoted in ap-south-2 | Replica bucket | AWS SM replica | n/a | live, `IN` |

### 01.4.11 Supabase in non-prod rule set

1. Supabase is permitted in `dev` and `preview` for **PostgreSQL only**. Branching may be used to create per-PR databases from the `demo` seed.
2. Do not enable or use Supabase Auth, Storage, Edge Functions, Realtime, or the `supabase-js` client. The `auth`, `storage`, `realtime`, `supabase_functions` and `graphql_public` schemas are not referenced by any migration or query.
3. Connect through the pooled connection string with `sslmode=verify-full`; application roles `app_rw`/`app_migrate`/`app_ro` are created by migration, not Supabase defaults. `postgres` superuser is used only by the bootstrap script.
4. RLS is enforced by our policies, not Supabase's `auth.uid()` helpers; any policy referencing `auth.*` fails `rls-lint`.
5. Extensions enabled must be within the whitelist (01.3.D). Supabase-specific extensions (`pg_graphql`, `supabase_vault`, `pg_net`) stay disabled.
6. No production or REGULATED/CONFIDENTIAL real data is loaded into Supabase; only `demo` and anonymised data sets. The `supabase-guard` test checks connection strings in `prod`/`staging`/`pre-prod` configs and fails if a `*.supabase.co` host appears.
7. Supabase projects are created in the Mumbai region where available **[VERIFY: Supabase region list]**; otherwise Singapore is acceptable for `demo` data only.
8. Deleting or pausing a Supabase preview project is automated at PR close (IPB-09).
9. Supabase MCP tools may be used by Claude Code only against `dev`/`preview` projects and never with `apply_migration` to a shared `dev` database without a PR.

### 01.4.12 Reference deployment bill of materials (prod, AWS ap-south-1 / ap-south-2)

| Layer | Component | Version / service | Notes |
|---|---|---|---|
| Runtime | Node.js | 24.22.1 (bookworm-slim, digest-pinned) | IPB-D-01 |
| Package manager | pnpm | 9.x via corepack | |
| Build | Turborepo, TypeScript (strict), Changesets | current minors | |
| Web | Next.js 16.4.x, React 19.x | `apps/web`, `apps/public`, `apps/console` | Security feed subscribed |
| API | NestJS 11.1.x, Drizzle ORM, Zod | `apps/api`, `apps/worker` | ESM dry-run from Q1 2027 |
| Mobile | Expo SDK 57 (RN 0.86) | UDF, FBX field app | |
| Database | Amazon RDS for PostgreSQL 18 Multi-AZ; read replica ap-south-2 | extensions: pgvector, pg_trgm, pgcrypto, citext | PgBouncer in-cluster |
| Cache/queue | Amazon ElastiCache Redis 7 (TLS) | BullMQ | |
| Workflow | Temporal (self-hosted, Helm) on RDS | Worker Versioning | |
| Search | PostgreSQL FTS (default) / Amazon OpenSearch Service | per product gate | |
| Vector | pgvector | HNSW | |
| Identity | Keycloak 26.x (Helm) | OIDC/SAML/passkeys/SCIM | |
| AuthZ | Cerbos PDP sidecar | | |
| Rules | GoRules ZEN + cel-js | embedded | |
| Flags | Unleash (Helm) + OpenFeature SDK | | |
| Secrets | AWS Secrets Manager + Secrets Store CSI driver; IRSA | no env-var secrets | |
| KMS | AWS KMS multi-region keys; one CMK per tenant for REGULATED fields | | |
| Storage | Amazon S3 Object Lock (compliance) + Replication to ap-south-2 | bucket classes AUDIT/REGULATED/CONFIDENTIAL/GENERAL/PUBLIC_ASSETS | |
| Docgen/PDF | Gotenberg (Helm), docxtemplater, pdf-lib, pdfcpu | in-cluster | |
| Video | LiveKit (Helm) + coturn | EQ, V-CIP | |
| Kubernetes | Amazon EKS (current supported minor), Karpenter, KEDA, Kyverno, cert-manager, external-dns | | |
| Edge | Cloudflare DNS/CDN/WAF/Bot, HTTP/3, hybrid KEM | origin ALB restricted to Cloudflare IPs | |
| Observability | OTel Collector → Grafana, Tempo, Loki (S3 lock, 180 d), Mimir | Grafana OnCall for alerts | |
| Errors | GlitchTip/Sentry self-hosted | | |
| Email | Amazon SES (ap-south-1), per-brand configuration sets | | |
| SMS/Voice | Exotel | DLT | |
| WhatsApp | Meta Cloud API | INR billing by 31 Dec 2026 | |
| Payments | Razorpay (primary), PayU (secondary) | SAQ A | |
| AI | Bedrock (Claude) ap-south-1; Anthropic direct; Vertex AI asia-south1; Sarvam; Bhashini; vLLM on GPU node group | routing YAML | |
| CI/CD | GitHub Actions (OIDC to AWS), cosign, CycloneDX, Renovate, Semgrep, ZAP, Trivy | | |
| IaC | Terraform/OpenTofu, remote state S3 + lock | modules aws/azure/gcp | |
| Backup | RDS snapshots + WAL to S3 lock + weekly `pg_dump` to Azure Blob (Central India, immutable) | 3-2-1 | |

Regenerated per release (`bom-generate`), signed with cosign, stored as `docs/bom/<release>.cdx.json` and attached to the `rel_` record.

### 01.4.13 Cloud/vendor exit as a design property

Exit is not a document written after the fact; it is a measured property of the port catalogue. For each port, `docs/exit/EXIT_RUNBOOK.md` (generated from adapter metadata and the last drill) states:

| Field | Meaning |
|---|---|
| Port / current primary | e.g. STORAGE / s3 |
| Exit target | The alternative adapter the drill used (e.g. Azure Blob Central India) |
| Data move method | e.g. `replicateTo` with manifest + SHA-256 verification |
| Data volume class | S (< 100 GB), M (< 1 TB), L (> 1 TB) |
| Measured RTO | From the last drill (hours) |
| Target RTO | Per tier: Tier-0 (IDENTITY, KMS, DB): 24 h; Tier-1 (STORAGE, QUEUE, SECRETS, WORKFLOW): 48 h; Tier-2 (messaging, AI, docgen): 8 h (config swap); Tier-3 (analytics, tags, maps): 4 h |
| Lock-in residue | Anything that cannot move (e.g. WhatsApp number tied to BSP, mandates tied to PA) and the mitigation (re-registration timeline) |
| Last drill | Date, environment, evidence `vad_` ID |

Whole-cloud exit (AWS → Azure or GCP): Terraform `envs/<product>/<env>` is re-pointed at the other cloud's modules, outputs regenerate `routing.yaml`, database moves by logical replication, storage by `replicateTo`, identity by Keycloak realm export/import, workflows drain then restart; target RTO for a full-cloud move is 5 working days for a product under 1 TB, with the drill run in `staging` every 24 months. RBI Outsourcing Directions 2025 exit-strategy expectations for regulated clients are met by this runbook plus the tenant export (`<PRODUCT>-EXPORT-1.0`).

## 01.5 Settings keys

| Key | Tier | Type | Default | Who may change | Maker-checker |
|---|---|---|---|---|---|
| `ipb.runtime.node_version` | PLATFORM | string | `24.22.1` | PLT_RELEASE_MANAGER (via ADR + PR only) | Yes |
| `ipb.region.primary` | PLATFORM | string | `ap-south-1` | PLT_SUPER_ADMIN (ADR) | Yes |
| `ipb.region.dr` | PLATFORM | string | `ap-south-2` | PLT_SUPER_ADMIN (ADR) | Yes |
| `int.routing.file` | PLATFORM | string | `infra/routing/<product>/<env>.routing.yaml` | deploy pipeline | n/a |
| `int.<port>.primary` | PLATFORM | string | per 01.4.4 | PLT_SUPER_ADMIN | Yes (CAB for Tier-0/1) |
| `int.<port>.secondary` | PLATFORM | string | per 01.4.4 | PLT_SUPER_ADMIN | Yes |
| `int.<port>.failover_mode` | PLATFORM | enum | `read_only_failover` / `active_failover` / `none` | PLT_SUPER_ADMIN | Yes |
| `int.<port>.circuit_breaker.*` | PLATFORM | object | 5 / 0.5 / 60 s / 30 s | PLT_RELEASE_MANAGER | No |
| `int.residency.policy` | PLATFORM | map | per 01.4.5 defaults | PLT_SECURITY_OFFICER | Yes (locked for REGULATED/SECRET) |
| `int.storage.retention.<class>_days` | PLATFORM | int | AUDIT 2922, REGULATED product-specific | PLT_SECURITY_OFFICER + PLT_DPO | Yes |
| `int.storage.retention.tenant_override_days` | TENANT | int | null (≥ platform minimum) | ORG_OWNER | Yes |
| `int.llm.tenant_allowed_providers` | TENANT | string[] | all platform-allowed of correct residency | ORG_ADMIN | Yes |
| `int.llm.tenant_residency_floor` | TENANT | enum | plan default | ORG_OWNER | Yes |
| `int.whatsapp.brand_number` | BRAND | string | null | PLT_SUPER_ADMIN | Yes |
| `int.email.brand_domain` | BRAND | string | brand_pack.email_domain | PLT_SUPER_ADMIN | Yes |
| `eng.env.seed_profile` | PLATFORM | enum | null; `prod` refuses any value | deploy pipeline | n/a |
| `eng.env.supabase_allowed` | PLATFORM | bool | true only in `dev`/`preview` | locked | n/a |
| `eng.exit.drill_interval_months` | PLATFORM | int | 12 | PLT_SECURITY_OFFICER | No |
| `eng.bom.generate_on_release` | PLATFORM | bool | true (locked) | — | — |
| `eng.esm.dry_run_enabled` | PLATFORM | bool | false until Q1 2027 | PLT_RELEASE_MANAGER | No |

All keys are registered in `packages/config/registry.ts` before any code reads them (brief §6). Unregistered reads fail typecheck.

## 01.6 Events and error codes

### 01.6.1 Internal events

| Event | Payload (summary) | Emitted when |
|---|---|---|
| `in.<product>.platform.AdapterFailedOver.v1` | port, from_adapter, to_adapter, reason, data_class_max | Circuit breaker opens and traffic moves |
| `in.<product>.platform.AdapterRecovered.v1` | port, adapter | Half-open probe succeeds |
| `in.<product>.platform.ResidencyViolationBlocked.v1` | port, adapter, data_class, module, trace_id | A call was refused for residency |
| `in.<product>.platform.RoutingConfigChanged.v1` | env, diff_summary, actor, approver | routing YAML change deployed |
| `in.<product>.platform.ExitDrillCompleted.v1` | ports[], measured_rto_hours, evidence_ref | Drill completed |
| `in.<product>.platform.BomGenerated.v1` | release_id, bom_ref, signature | Release BOM produced |
| `in.<product>.platform.ModuleManifestInvalid.v1` | module, errors[] | Boot validation failure (also blocks boot) |

### 01.6.2 Proposed Ecosystem events

| Proposed event | Purpose |
|---|---|
| `in.infrabyx.platform.ProviderIncident.v1` | OH receives provider outages from all products for the status page and vendor risk register (RBI outsourcing: concentration risk). |
| `in.infrabyx.platform.ExitDrillCompleted.v1` | Vendor Assurance Room (OH14.6) stores drill evidence. |

### 01.6.3 Error codes

| Code | Meaning | HTTP | help_key |
|---|---|---|---|
| `IPB-PORT-001` | Port not configured for this environment | 500 | `hlp.int.port_not_configured` |
| `IPB-PORT-002` | Adapter unavailable, circuit open | 503 | `hlp.int.adapter_unavailable` |
| `IPB-PORT-003` | Residency/data-class violation; call refused | 422 | `hlp.int.residency_blocked` |
| `IPB-PORT-004` | Idempotency key reused with different payload | 409 | `hlp.int.idempotency_conflict` |
| `IPB-PORT-005` | Invalid routing configuration | boot | `hlp.int.routing_invalid` |
| `IPB-MOD-001` | Module manifest invalid | boot | `hlp.eng.manifest_invalid` |
| `IPB-MOD-002` | Cross-module repository access detected at runtime | 500 | `hlp.eng.module_boundary` |
| `IPB-STOR-001` | Object not found | 404 | |
| `IPB-STOR-002` | Write deferred (storage degraded) | 202 | `hlp.int.storage_deferred` |
| `IPB-STOR-003` | Immutable object; modification refused | 423 | `hlp.int.immutable` |
| `IPB-STOR-004` | Adapter cannot honour retention | 500 | |
| `IPB-IDN-001` | Token invalid or expired | 401 | |
| `IPB-IDN-002` | Identity provider unavailable for new sessions | 503 | |
| `IPB-AUTHZ-001` | Policy decision point unavailable; denied | 503 | |
| `IPB-KMS-001` | Key unavailable; decrypt refused | 503 | |
| `IPB-AI-021` | No model of required residency available; failed closed (owned by IPB-03 §03.6; the draft code `IPB-LLM-003` is retired and must not be emitted) *(rev. 26 Oct 2026)* | 503 | `hlp.ai.residency_unavailable` |
| `IPB-CACHE-001` | Cache degraded; conservative limits applied | (warning) | |
| `IPB-ENV-001` | Seed profile refused in production | boot | `hlp.eng.seed_refused` |
| `IPB-ENV-002` | Disallowed engine/host detected (e.g. Supabase in prod) | boot | |
| `IPB-DB-001` | Extension not in whitelist | migration | |
| `IPB-DB-002` | Engine-specific construct outside adapter | migration | |

Products re-export as `<PRODUCT>-PORT-001` etc. without changing numbers.

## 01.7 Product adoption notes

**LD (LawDocs).** Already operates lawdocs.in and the eSign platform; LD's eSign becomes the reference ESIGN adapter for every other product, so LD must publish `packages/connectors/esign/lawdocs` with the port contract tests and sandbox keys. Start SEARCH on PostgreSQL FTS; cross to OpenSearch at the volume gate. ESTAMP state coverage is LD's responsibility (rule set `rules.estamp.*`). PDF port is heavily used (merge, PAdES sign via KMS). No mobile app in v1.

**LDC (LawDocsComply).** GRC data is CONFIDENTIAL with REGULATED slices for regulated clients; set `int.llm.tenant_residency_floor` default to `IN-ZR` for plans sold to RBI/SEBI/IRDAI entities. COMPANY_DATA is a first-class port (MCA/GSTN watch). LDC builds the AI system register that doubles as 42001 evidence; it consumes `BomGenerated` and `ExitDrillCompleted` events to populate controls. No PAYOUTS, no VIDEO_MEET in v1.

**EQ (Equator Resolution).** VIDEO_MEET (self-hosted LiveKit) and SPEECH (Indic STT with diarisation) are critical; recordings go to `REGULATED` bucket class with hash manifests. ESIGN for awards and settlement agreements; CALENDAR for hearing scheduling (internal authoritative). Scheme rules (SEBI ODR thresholds, fees) live in RULES as data. EQ must declare `odr.scheme.sebi_v2` as a `mod.` flag off by default.

**FBX (Finbyx).** Most ports in use: KYC, PAYOUTS, PAYMENTS (mandates), VOICE, GEO/MAPS, OCR, plus product ports `BUREAU`, `AA_FIU`, `ULI_GATEWAY`, `DISBURSEMENT_RAIL` registered per 01.4.4.0. All REGULATED. Payout failover is manual by design. Bank clients may require on-premise/HSM: FBX must keep the KMS PKCS#11 adapter and the self-hosted CloudNativePG target green. RBI Outsourcing Directions 2025 Chapter IV (NBFC-ML and above) clauses (audit access, sub-contractor list, exit) are satisfied by the EXIT_RUNBOOK and BOM artefacts shared via the Vendor Assurance Room.

**UDF (Udofin).** Expo SDK 57 mobile is primary; PUSH via Expo with FCM/APNs direct fallback. As an LSP/DLA under RBI Digital Lending Directions 2025, data stays in India and any offshore processing is deleted within 24 h — therefore every UDF adapter is `IN` or `IN-ZR` with `maxDataClass` ≥ CONFIDENTIAL; GLOBAL adapters are limited to PUSH and PUBLIC analytics. White-label `brand_pack` drives EMAIL/SMS/WHATSAPP sender identities per brand.

**OH (Operations Hub).** OH8 is the BILLING port's server side; OH3 is the CRM server side. OH consumes `ProviderIncident` and `ExitDrillCompleted` from all products. WORKSPACE (M365) is used for staff; product_scope segregation (IPB-D-12) is implemented in AUTHZ policies. OH runs the group Vendor Assurance Room (OH14.6) and the status page.

## 01.8 Acceptance tests

```gherkin
@IPB-01-AT-01
Feature: Node version pin consistency
  Scenario: All five pin locations agree
    Given the repository at HEAD
    When the pin-check job reads .nvmrc, package.json engines, every Dockerfile FROM line, the CI matrix and renovate.json
    Then every location resolves to "24.22.1"
    And every Dockerfile FROM line includes a sha256 digest

@IPB-01-AT-02
Feature: Engine strictness
  Scenario: Install on wrong Node refused
    Given Node 22.23.4 is active
    When I run "pnpm install"
    Then the command exits non-zero with an engine mismatch error

@IPB-01-AT-03
Feature: Node 26 blocked without ADR
  Scenario: Renovate does not propose Node 26
    Given renovate.json at HEAD
    When Renovate evaluates the node datasource
    Then no pull request proposing a 26.x version is opened

@IPB-01-AT-04
Feature: Vendor SDK imports confined to connectors
  Scenario: Direct SDK import in a module
    Given a file apps/api/src/modules/cases/service.ts importing "@aws-sdk/client-s3"
    When the vendor-import lint runs
    Then it fails naming the file and the forbidden import

@IPB-01-AT-05
Feature: Module boundary
  Scenario: Cross-module table import
    Given apps/api/src/modules/billing_mirror/repo.ts imports a table from modules/cases/schema.ts
    When schema-boundary lint runs
    Then it fails with IPB-MOD-002 guidance

@IPB-01-AT-06
Feature: Residency fail-closed
  Scenario: REGULATED payload against GLOBAL adapter
    Given LLM routing where model class "fast-small" has primary residency GLOBAL
    When a module calls LLM.complete with data_class REGULATED and model_class "fast-small"
    Then the call is refused with IPB-PORT-003
    And no request leaves the cluster
    And event in.<product>.platform.ResidencyViolationBlocked.v1 is emitted

@IPB-01-AT-07
Feature: Failover never crosses residency
  Scenario: Primary IN-ZR fails, secondary GLOBAL configured
    Given routing with primary residency IN-ZR and secondary residency GLOBAL and failover active for REGULATED
    When the routing file is loaded
    Then loading fails with IPB-PORT-005

@IPB-01-AT-08
Feature: Circuit breaker failover
  Scenario: PAYMENTS primary degraded
    Given Razorpay sandbox returns 5xx for 6 consecutive createOrder calls
    When a seventh checkout is requested
    Then the order is created on PayU sandbox
    And in.<product>.platform.AdapterFailedOver.v1 is emitted with from_adapter "razorpay" and to_adapter "payu"

@IPB-01-AT-09
Feature: Storage Object Lock
  Scenario: Attempt to overwrite a locked object
    Given an object written with putWithRetention retainUntil in 8 years in bucket class AUDIT
    When any role, including the deployment role, attempts delete or overwrite
    Then the adapter returns IPB-STOR-003
    And the object remains unchanged

@IPB-01-AT-10
Feature: Storage adapter parity
  Scenario Outline: putWithRetention across adapters
    Given adapter <adapter> configured against its test target
    When the STORAGE contract suite runs
    Then all contract tests pass including assertImmutable
    Examples:
      | adapter |
      | s3      |
      | minio   |
      | azure-blob |
      | gcs     |

@IPB-01-AT-11
Feature: Extension whitelist
  Scenario: Migration enabling a non-whitelisted extension
    Given a migration containing CREATE EXTENSION postgis
    When migration-lint runs
    Then it fails with IPB-DB-001

@IPB-01-AT-12
Feature: Production refuses seed and Supabase
  Scenario: Seed profile set in prod
    Given Helm values with env.name "prod" and seed.profile "demo"
    When helm template renders
    Then rendering fails with IPB-ENV-001 message
  Scenario: Supabase host in staging config
    Given a staging database URL containing ".supabase.co"
    When supabase-guard runs
    Then it fails with IPB-ENV-002

@IPB-01-AT-13
Feature: Health aggregation
  Scenario: Adapter degraded
    Given the CACHE adapter health returns "down"
    When GET /health/ready is called
    Then the response lists CACHE as down with latency and checked_at
    And the overall status is "degraded" because CACHE is non-critical

@IPB-01-AT-14
Feature: Terraform output parity
  Scenario Outline: Same outputs on every cloud
    Given module set under infra/terraform/modules/<cloud>
    When the output-schema test runs
    Then every key in the output contract exists with the declared type
    Examples:
      | cloud |
      | aws   |
      | azure |
      | gcp   |

@IPB-01-AT-15
Feature: Container hardening
  Scenario: Runtime image properties
    Given the built apps/api image
    When docker inspect and trivy config run
    Then the user is 10001, root filesystem is read-only in the Helm securityContext, a HEALTHCHECK exists, and no critical or high findings remain unwaived

@IPB-01-AT-16
Feature: Module manifest validation
  Scenario: Table listed without RLS
    Given a module manifest listing table cases.note under rlsTables
    And cases.note has RLS disabled
    When the API boots in test
    Then boot fails with IPB-MOD-001 naming cases.note

@IPB-01-AT-17
Feature: Exit runbook currency
  Scenario: Release with stale runbook
    Given docs/exit/EXIT_RUNBOOK.md last generated 200 days ago
    When the release job runs
    Then it fails requiring regeneration

@IPB-01-AT-18
Feature: BOM generation
  Scenario: Release produces signed BOM
    Given a release candidate tag
    When bom-generate runs
    Then docs/bom/<release>.cdx.json exists, is valid CycloneDX, lists node 24.22.1 and the PostgreSQL version, and has a cosign signature verifiable with the platform public key

@IPB-01-AT-19
Feature: Secrets never from process.env in production
  Scenario: Adapter reads process.env
    Given a connector file reading process.env.RAZORPAY_KEY
    When no-process-env lint runs
    Then it fails naming the file

@IPB-01-AT-20
Feature: Provider swap drill
  Scenario: STORAGE swap in staging
    Given staging primary STORAGE s3 and a configured azure-blob target
    When the drill replicates prefix tenant/ with manifest verification and switches primary
    Then all sampled objects verify by SHA-256, assertImmutable holds on the target, and the measured RTO is recorded in a vad_ artefact
```

## 01.9 Open items

| ID | Item | Owner | Flag (default OFF) |
|---|---|---|---|
| IPB-OI-01-01 | Confirm Bedrock model availability and zero-retention terms in ap-south-1 for the reference LLM adapter; record model IDs in routing YAML at build time. **[VERIFY]** | PLT_SECURITY_OFFICER | `ai.provider.bedrock_in_primary` |
| IPB-OI-01-02 | Confirm Supabase Mumbai region availability for `dev`/`preview` projects. **[VERIFY]** | PLT_RELEASE_MANAGER | `eng.env.supabase_mumbai` |
| IPB-OI-01-03 | Decide Temporal self-hosted vs Temporal Cloud if a Mumbai region becomes available. **[OWNER]** | Owner | `int.workflow.temporal_cloud` |
| IPB-OI-01-04 | Composite KYC reference vendor set to be confirmed against current coverage and RBI Digital Lending data-deletion contract terms. **[VERIFY] [COUNSEL]** | FBX lead | `int.kyc.composite_reference` |
| IPB-OI-01-05 | Direct SHCIL e-stamp API availability vs aggregator. **[VERIFY]** | LD lead | `int.estamp.direct_shcil` |
| IPB-OI-01-06 | Datadog/Elastic India-region availability for OBSERVABILITY alternative adapters; until confirmed, logs stay on Loki/S3 only. **[VERIFY]** | PLT_RELEASE_MANAGER | `eng.otel.saas_backend` |
| IPB-OI-01-07 | Node 26 LTS promotion date and ADR schedule (not before Q2 2027). **[VERIFY]** | PLT_RELEASE_MANAGER | `ipb.runtime.node26_adr_open` |
| IPB-OI-01-08 | PostgreSQL 19 evaluation after GA; stay on 18 until then. **[VERIFY]** | PLT_RELEASE_MANAGER | `eng.db.pg19_eval` |
| IPB-OI-01-09 | Statutory retention periods per product for REGULATED bucket class defaults (loan records, arbitral records, GRC evidence). **[COUNSEL]** | PLT_DPO | `int.storage.retention_rules_v2` |
| IPB-OI-01-10 | PQC hybrid signing (ML-DSA) adoption once CCA/eMudhra issue certificates; KMS algorithm registry is ready. **[VERIFY]** | PLT_SECURITY_OFFICER | `crypto.pqc.sign_hybrid` |
| IPB-OI-01-11 | On-premise/HSM deployment profile for bank clients (CloudNativePG + PKCS#11 + MinIO) as a fourth Terraform target `onprem/`. **[OWNER]** | FBX lead | `infra.target.onprem` |
| IPB-OI-01-12 | NestJS 12 ESM GA date; switch `eng.esm.dry_run_enabled` to blocking once GA is verified. **[VERIFY]** | PLT_RELEASE_MANAGER | `eng.esm.dry_run_enabled` |
