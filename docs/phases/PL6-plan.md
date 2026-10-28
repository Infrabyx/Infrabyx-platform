# PL6 — Infra and release

**Phase:** PL6 (IPB-14 §14.3) · **Delivers:** containers, Compose, the shared Helm chart, OpenTofu modules per cloud, the reference application `apps/reference`, the product scaffold and its CI proof, the release BOM and exit runbook generators, and the readiness report for 1.0.0.
**Date:** 2026-10-27 · **Branch:** `claude/wonderful-franklin-goo59b`
**Status:** written and self-reviewed under the continuous-build mode (PL2-D-41). Defaults for open points are logged as PL6-D-01 and OWNER-QUESTIONS #66; items that hit a stop condition are parked in #67. Implementation starts without waiting (the owner reviews plans in batches). **Publishing 1.0.0 is a stop condition (CLAUDE.md item 5): the phase ends with a readiness report and a held changeset PR, and nothing is published at 1.0.0 until the owner says so.**

**Self-review (27 Oct 2026).** Checked against IPB-01-31…40 and §01.4.8–§01.4.13, IPB-02-28 and 02-35, IPB-09-07, 09-11…14, 09-23, §09.4.2–§09.4.3, IPB-11 (seed refusal) and IPB-14 §14.2, §14.3 and §14.5, row by row:

- every PLATFORM row in scope is built, or parked with a named default and an owner question (§9);
- nothing weakens an IPB-02 control: containers run as UID 10001 with a read-only root filesystem, the chart locks the security context, the chart refuses a seed profile in `prod`, `dr` and `pre-prod`, and no production secret path is ever an environment variable;
- no new cryptography: image signing (cosign, IPB-02-35) is written but switched off until the owner approves it, because it is not one of the approved C-items (#67);
- no external account, paid service or recurring cost: no cloud is touched, no module is applied, nothing is pushed to a registry, and the "preview environment" of the gate is the CI-ephemeral stack that IPB-01 §01.4.10 and `eng.preview.db_provider = testcontainers` allow (#66, #67);
- no deletion or retention change, no production configuration: `envs/` contains an example stack that is validated only, and the chart's `prod` values are a schema, not a deployment.

**Read for this plan:** IPB-01 §01.3.F–G, §01.4.2, §01.4.8–§01.4.13, §01.8 (AT-01, 12, 14, 15, 17, 18); IPB-02-28, 02-35 and §02.4 supply chain; IPB-09 §09.3.C, §09.4.2–§09.4.3; IPB-11 refusal rules; IPB-14 §14.2–§14.5; `infra/docker/BASE_IMAGES.md`, `infra/docker/TEST_IMAGES.md`; DECISIONS PL1-D-06 (seed refusal), PL2-D-13 (CI budget), PL2-D-32 (7-day rule), PL2-D-61 and OWNER-QUESTIONS #4 (MinIO), ADR-0002 (pnpm 10).

---

## 1. Scope

### 1.1 What PL6 delivers

1. **Containers** (IPB-01-31, §01.4.8.1): one multi-stage Dockerfile shape in `infra/docker/`, used by every deployable here (`apps/public`, `apps/console`, and the three `apps/reference` parts), from the digest-pinned Node base, UID 10001, read-only root filesystem, `HEALTHCHECK`; `.dockerignore` excluding `.env*`, `SEED_CREDENTIALS.md` and `.git`.
2. **Compose for local** (IPB-01-33, §01.4.8.3): `infra/compose/docker-compose.yml` with the `core`, `search`, `ai` and `observability` profiles; `pnpm dev:up` and `pnpm dev:down`.
3. **Helm chart** (IPB-01-32, §01.4.8.2): `infra/helm/infrabyx-app` with a values schema, the locked security context, probes, HPA, PDB, default-deny network policy, the migration hook, the routing config map, the secrets CSI mount and the seed-profile refusal; example values per environment.
4. **Admission policies** (IPB-01-35, IPB-02-35): Kyverno policies in `infra/policy/kyverno/` (verify image signature and SBOM attestation, require the security context, refuse `latest` and tag-only images), tested with the Kyverno CLI against fixtures. The signature policy is shipped `Audit` until signing is approved (#67).
5. **OpenTofu modules** (IPB-01-34, 01-36, §01.4.9): `infra/terraform/modules/{aws,azure,gcp}/` with the twelve modules of §01.4.9.1 and a `platform` composition per cloud that returns the §01.4.9.3 output contract; an example environment stack under `infra/terraform/envs/example/`; region validation; never applied.
6. **`apps/reference`** (IPB-14 §14.2): the "hello tenant" application the products copy, in the product layout of §01.4.2: `apps/reference/api` (NestJS 11), `apps/reference/worker` and `apps/reference/web` (Next.js 16), using every package.
7. **Scaffold** (IPB-14 §14.5 item 5): `scripts/scaffold-product.mjs` writes a new product repository from `apps/reference`, `apps/public`, `apps/console`, the infra templates and the governance files; a CI job scaffolds one into a temporary directory, installs the packed packages from a local registry and runs the product's own CI there.
8. **Release evidence** (IPB-01-38, 01-40, IPB-09-23): `bom-generate` (CycloneDX for the platform and the template), `exit-runbook` (generated from the port catalogue), and the release record fields the platform can fill.
9. **CI**: a `containers` job (hadolint, build, `trivy config`, `trivy image`, `docker inspect` assertions), an `infra` job (`helm lint`, `helm template` tests, `kubeconform`, Kyverno CLI tests, `tofu fmt`, `tofu validate`, `tofu test` with mock providers, `tflint`, `trivy config`), a `reference` job (Compose stack, migrations, seed, the gate journey in Playwright) and a `scaffold` job. All run only when their paths change (PL2-D-13 speed rule).
10. **The PL6 gate and 1.0.0 readiness**: the gate report, the major changesets prepared in a PR that is **held** for the owner, the platform-wide exit gate of IPB-14 §14.5 checked item by item.

### 1.2 What PL6 is not

- **No deployment anywhere.** No cluster, no cloud account, no `tofu apply`, no hosted preview (#67). `helm diff` needs a cluster and is recorded as not run.
- **No image push and no signing** until the owner approves them (#67). Images are built and scanned in CI and discarded.
- **No 1.0.0 publish** without the owner's word (stop condition 5).
- **No product code.** Product modules, product skills and product pages stay in the six product repositories.

---

## 2. Order of work and dependencies

```
containers (Dockerfiles, .dockerignore)  →  Compose  →  apps/reference (needs Compose for its e2e)
Helm chart  →  Kyverno policies (fixtures render from the chart)
OpenTofu modules (independent)
scaffold (needs apps/reference, the chart values and the env stack templates)
BOM + exit runbook (needs the port catalogue, the lockfile and the chart values)
gate
```

---

## 3. Containers (`infra/docker/`)

### 3.1 Dockerfile shape

One shape for every deployable, following §01.4.8.1, with two deliberate differences recorded in PL6-D-01:

- **pnpm 10 via corepack** (ADR-0002, IPB-DEV-02), not `pnpm@9`.
- **Next.js apps** use the same stages; the runtime copies the `pnpm deploy --prod` output plus `.next/`. The webpack build stays (PL5-D-13) because the platform packages read their shipped files relative to themselves.

Stages: `base` (pinned Node image by tag and digest, `ipb-check` already enforces it) → `deps` (`pnpm fetch` with a cache mount) → `build` (`pnpm install --offline --frozen-lockfile`, `turbo run build --filter=<app>...`, `pnpm --filter=<app> deploy --prod /out`) → `runtime` (UID and GID 10001, `/app` owned by `app`, `USER 10001`, `HEALTHCHECK` through `node dist/healthcheck.js` or the Next app's `/health/live`, `ENTRYPOINT` with `--enable-source-maps`). Writable paths (`/tmp`, `.next/cache`) are `emptyDir` volumes in the chart and `tmpfs` in Compose, so the root filesystem stays read-only.

### 3.2 Health

Every app serves `/health/live`, `/health/ready` and `/health/startup` (§01.4.8.2 probes). `ready` aggregates adapter health through the existing connectors health aggregation (`@IPB-01-AT-13`); `apps/public` and `apps/console` gain these routes.

### 3.3 Checks

- `hadolint` on every Dockerfile (no ignores without a dated reason).
- `trivy config` on Dockerfiles and the chart; `trivy image` on each built image: critical and high must be zero, or waived in `infra/docker/trivy-waivers.yaml` with an expiry date.
- `docker inspect` assertions (`@IPB-01-AT-15`): user `10001`, a `HEALTHCHECK`, no `latest` tag, the base digest from `BASE_IMAGES.md`; read-only root filesystem asserted on the rendered chart.

Tool versions are pinned: the tools' Docker Hub images by digest, the same pin locally and in CI (PL6-D-02; GitHub release downloads are not reachable from the build sandbox), listed in `infra/docker/README.md` and published at least 7 days before pinning (PL2-D-32).

---

## 4. Compose (`infra/compose/`)

| Profile         | Services                                                                                                                                                                                 |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core`          | PostgreSQL 18 with pgvector 0.8.1, Redis 7.4, MinIO with an Object Lock bucket bootstrap, Mailpit, Keycloak 26 with a realm import, Temporal and Temporal UI, Gotenberg, Unleash, Cerbos |
| `search`        | OpenSearch                                                                                                                                                                               |
| `ai`            | Ollama                                                                                                                                                                                   |
| `observability` | OTel Collector, Grafana, Tempo, Loki, Prometheus                                                                                                                                         |

- Images by digest; the ones already in `TEST_IMAGES.md` are reused, the rest are added with the session that uses them (D-11 pattern). MinIO follows OWNER-QUESTIONS #4: the pinned quay.io digest, or the source build if quay.io stops serving it; never a third-party mirror.
- The Keycloak realm import holds only reserved example users and generated passwords; credentials come from `SEED_CREDENTIALS.md` written by the seed (never committed).
- Secrets: `.env.local` is the only place env-var secrets are allowed (IPB-02-28). SOPS with age is documented for products; the platform's Compose uses generated local-only values and `.env.local.example`.
- `pnpm dev:up` starts `core`, waits for health, runs `infrabyx-migrate` and the `minimal` seed. `pnpm dev:down` stops it and removes volumes.
- The nightly `pnpm dev:up` smoke test of IPB-01-33 is run in the `reference` job on path changes here (the repository is public, so minutes are free, but a nightly is not needed while the path filter covers every change).

---

## 5. Helm chart (`infra/helm/infrabyx-app/`)

### 5.1 Values (§01.4.8.2)

`values.schema.json` makes required what the spec marks required: `image.repository` and `image.digest` (a `sha256:` digest; tags are refused), `app.kind` (`api`, `worker`, `web`, `public`, `console`), `env.name` (the IPB-09-15 catalogue only), `routing.configMap`, and `secrets.provider` when `env.name` is `prod`, `dr`, `pre-prod` or `staging`.

### 5.2 Templates

Deployment (worker without a Service), Service, ServiceAccount (workload identity annotation per provider), HPA (CPU, plus a KEDA `ScaledObject` for workers when enabled), PDB (`minAvailable: 1`; the schema requires two or more replicas in `prod`), NetworkPolicy (default-deny ingress and egress, allow-list from values), the migration `Job` as a pre-install and pre-upgrade hook running as `app_migrate`, the routing `ConfigMap` mount, the `SecretProviderClass` for the CSI driver, `emptyDir` for writable paths, and OTel environment for the collector endpoint (not a secret).

The security context is not configurable: `runAsNonRoot`, `runAsUser: 10001`, `readOnlyRootFilesystem: true`, `allowPrivilegeEscalation: false`, `capabilities.drop: [ALL]`, `seccompProfile: RuntimeDefault`.

### 5.3 Refusals in the template

- `seed.profile` set with `env.name` in `prod`, `dr` or `pre-prod` fails rendering with the `IPB-ENV-001` message (`@IPB-01-AT-12`, the Helm scenario; the refused set is `SEED_REFUSED_ENVS`, PL1-D-06).
- A database host containing `.supabase.co` in `staging`, `pre-prod`, `prod` or `dr` values fails rendering with `IPB-ENV-002` (mirrors `supabase-guard`).
- A plain `env` entry whose name looks like a secret (`*_PASSWORD`, `*_SECRET`, `*_TOKEN`, `*_KEY`) fails rendering outside `local` and `test` (IPB-02-28).

### 5.4 Tests

`helm lint` with each example values file; `helm template` render tests in a Node test (`infra/helm/infrabyx-app/tests/render.test.mjs`) asserting the locked fields and every refusal; `kubeconform` against pinned Kubernetes JSON schemas (vendored by version and checksum so no network is needed at test time). `helm diff` needs a cluster and is not run (§1.2).

---

## 6. Admission policies (`infra/policy/kyverno/`)

- `verify-images`: images must be referenced by digest from the registry in values, signed (cosign keyless, GitHub OIDC issuer and this repository's workflow identity, IPB-02-35) and carry a CycloneDX attestation. **Shipped with `validationFailureAction: Audit`** until #67 approves signing; the test fixtures cover both outcomes.
- `require-security-context`, `disallow-latest-tag`, `require-probes`, `restrict-host-paths`.
- Tested with `kyverno test` against rendered chart fixtures; no cluster.

---

## 7. OpenTofu modules (`infra/terraform/`)

### 7.1 Layout

`modules/<cloud>/<module>/` for `network`, `kubernetes`, `postgres`, `redis`, `object_storage`, `kms`, `secrets`, `dns_cdn_edge`, `observability_backend`, `registry`, `iam_workload_identity`, `bastion_breakglass`, plus `modules/<cloud>/platform/` composing them and returning the output contract. The existing `infra/terraform/{aws,azure,gcp}/README.md` placeholders move under `modules/`.

`envs/example/preview/main.tf` shows a product stack consuming only the `platform` outputs and writing `outputs.auto.json` for the routing YAML and the Helm values (§01.4.9.2). It is validated, never applied; remote state is declared as a commented example (state is SECRET class).

### 7.2 Content per module (reference shape)

Each module is the minimum a product needs to start, with the secure defaults the IPB names:

- **AWS:** VPC across three AZs, EKS with IRSA, RDS PostgreSQL 18 Multi-AZ with `verify-full`, ElastiCache Redis 7 with TLS, S3 with Object Lock (compliance) per bucket class and replication to the DR region, KMS multi-region keys, Secrets Manager paths, Route 53 zone and origin hostname (Cloudflare edge is configured by the product), ECR with immutable tags, IAM roles for workload identity, a break-glass bastion off by default.
- **Azure and GCP:** the equivalents named in §01.4.9.1 (AKS, Flexible Server, Azure Cache, Blob immutability, Key Vault; GKE, Cloud SQL, Memorystore, GCS retention lock, Cloud KMS, Secret Manager), with the same input and output names.

Region validation (IPB-01-36): the AWS `platform` module accepts `region.primary = ap-south-1` and `region.dr = ap-south-2` only, unless `region_adr` names an ADR; Azure and GCP default to Central India and `asia-south1` with the same ADR rule.

### 7.3 Tests

- `tofu fmt -check`, `tofu init -backend=false`, `tofu validate` per module and per `platform`.
- **Output parity (`@IPB-01-AT-14`):** `tofu test` per cloud runs the `platform` module with `mock_provider` blocks (OpenTofu 1.8+), so no credentials and no resources, and asserts every key of `infra/terraform/contract/outputs.schema.json` with its type. A Node test checks that the three clouds' `outputs.tf` declare exactly the contract keys.
- `tflint` with the AWS, Azure and Google rulesets; `trivy config` for misconfigurations (waivers dated, as for images).

---

## 8. `apps/reference` — the template

### 8.1 Layout and stack

| Part     | Stack                                                     | Uses                                                                                                                                                                                                                                                                        |
| -------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api`    | NestJS 11, Drizzle-free (the kernel's SQL), Zod           | `tenancy` (kernel, RLS, module manifest), `audit`, `config`, `crypto`, `connectors` (IDENTITY Keycloak, AUTHZ Cerbos, STORAGE MinIO, QUEUE BullMQ, WORKFLOW Temporal), `rules`, `workflow`, `notify`, `export`, `ai`, `vidhi`, `cms`, `trust`, `consent`, `feedback`, `hlp` |
| `worker` | Same codebase, worker entrypoint                          | BullMQ consumers, the Temporal worker, the outbox relay, the sweeps (consent, trust, retrieval)                                                                                                                                                                             |
| `web`    | Next.js 16 (webpack build, nonce CSP as in `apps/public`) | `ui`, `a11y`, `brand`, `hlp`, `consent` (CMP), the OIDC sign-in through `api`                                                                                                                                                                                               |

One example module, `hello` (schema `hello`, one tenant table with forced RLS), shows the module pattern: manifest, migration, service through `kernel.mutate`, audit in the same transaction, a settings key registered in `config`, help keys in the product registry, journeys in `a11y`.

### 8.2 The gate journey (IPB-14 §14.5 item 2)

A seeded tenant user, on the Compose `core` stack:

1. signs in through Keycloak (OIDC code flow with PKCE, through the IDENTITY port);
2. sees a CMS page rendered from `cms`;
3. triggers a Vidhi skill at L1 (a maker-only `hello.summarise` skill on the deterministic AI fixture adapter; the result waits for a human checker);
4. downloads the tenant export (`export`, the export map and the signed manifest, C-22);
5. views a mirrored vendor-assurance document (`trust`, fixture feed).

Playwright runs the journey in the `reference` job, with axe on each page (`a11y`), and the `NN` pattern tests (tenant isolation, audit chain, maker-checker, locked actions, seed refusal) run against the same stack.

### 8.3 Settings, secrets and environments

`api` and `worker` validate their environment through `config` (`envSchema`), read secrets only through the SECRETS port (OpenBao in Compose, fixtures in test), and refuse fixture adapters outside `local`, `dev`, `test` and `preview`, as `apps/public` does.

---

## 9. Scaffold and release evidence

### 9.1 `scripts/scaffold-product.mjs`

`node scripts/scaffold-product.mjs --product <code> --name <name> --out <dir>` writes:

- `apps/api`, `apps/worker`, `apps/web` from `apps/reference`; `apps/public` and `apps/console` from this repository; workspace imports rewritten to exact `@infrabyx/*` versions;
- `.nvmrc`, `package.json` (`packageManager`, `engines`), `pnpm-workspace.yaml`, `turbo.json`, `.npmrc` (`${NODE_AUTH_TOKEN}`, never a literal), `renovate.json`, `.gitignore`, `.github/workflows/ci.yml` (the IPB-09-07 check names), the PR template, `CLAUDE.md`, `docs/STATUS.md`, `docs/DECISIONS.md` (with the "provided by `@infrabyx/<package>`" rows of IPB-14 Step 6), `docs/platform-requests.md`;
- `infra/compose`, `infra/helm/values.<env>.yaml` for the product, and `infra/terraform/envs/<product>/<env>/` stacks from the example.

The `scaffold` CI job packs every package, serves them from a local Verdaccio-compatible registry inside the job (no external account), scaffolds into a temporary directory, and runs the scaffolded repository's `install`, `lint`, `typecheck`, `test` and `build`. That is the measurable form of §14.5 item 5 in CI; the "one Claude Code session" form is shown once at the gate on the real GitHub Packages registry after 1.0.0.

### 9.2 `bom-generate` and `exit-runbook`

- `pnpm bom` writes `docs/bom/<version>.cdx.json` (CycloneDX 1.6) from `pnpm-lock.yaml`, the chart values, the base image digests and the Compose images; validated against the CycloneDX schema; it lists Node 24.22.1 and PostgreSQL 18 (`@IPB-01-AT-18` without the signature until #67).
- `pnpm exit-runbook` generates `docs/exit/EXIT_RUNBOOK.md` from the port catalogue and adapter metadata (§01.4.13 fields; measured RTO "not yet drilled"). The release job fails when it is older than 180 days (`@IPB-01-AT-17`).

---

## 10. Locked-list items and how PL6 treats them

| Item                                                | Treatment                                                                                                |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Cryptography (image signing, IPB-02-35)             | Not one of the approved C-items: written, off, parked (#67)                                              |
| Production configuration or deployment              | Nothing deployed; `prod` values are schema examples; modules never applied                               |
| Costs and external accounts (hosted preview, cloud) | None created; the gate's preview is CI-ephemeral (#66, #67)                                              |
| Publishing 1.0.0                                    | Held for the owner (#67)                                                                                 |
| Repository settings                                 | New required checks are added to `infra/policy/github/rulesets.json` only; the owner applies the ruleset |
| Data deletion or retention                          | None: Compose `dev:down` removes local volumes only                                                      |

---

## 11. CI gates added

| Job          | Runs on paths                                                        | Steps                                                                                            |
| ------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `containers` | `infra/docker/**`, `apps/**`, `packages/**`, lockfile                | hadolint, build each image, `trivy config`, `trivy image`, inspect assertions                    |
| `infra`      | `infra/helm/**`, `infra/policy/**`, `infra/terraform/**`             | helm lint, render tests, kubeconform, kyverno test, tofu fmt/validate/test, tflint, trivy config |
| `reference`  | `apps/reference/**`, `infra/compose/**`, `packages/**`, lockfile     | Compose `core`, migrate, seed, Playwright gate journey with axe, NN tests                        |
| `scaffold`   | `scripts/scaffold-product.mjs`, `apps/**`, `packages/**`, `infra/**` | pack, local registry, scaffold, the scaffolded CI                                                |

Each becomes a required check in `infra/policy/github/rulesets.json` once it has passed on `main` twice; the owner applies the ruleset.

---

## 12. Assumptions and owner questions

PL6-D-01 records the defaults below as `[ASSUMED – owner review]` (#66); the blocked items are #67.

1. **OpenTofu** (MPL-2.0), not Terraform (BSL 1.1): the IPB allows either ("Terraform/OpenTofu"), and OpenTofu's mock providers make the output-parity test possible without credentials.
2. **The gate's preview environment is CI-ephemeral** (`eng.preview.db_provider = testcontainers`, IPB-01 §01.4.10): the Compose `core` stack inside the `reference` job. A hosted per-PR preview (IPB-09-11, `pr-<n>.<product>.preview.infrabyx.dev`) needs a database-branching account, a cluster and a domain (#67).
3. **Images are built and scanned, not pushed**; signing and attestation are off; the Kyverno signature policy is `Audit` (#67).
4. **pnpm 10 in the Dockerfiles** (ADR-0002), not the `pnpm@9` line of §01.4.8.1; a platform request asks to update the example (PR-036).
5. **`apps/reference` is three parts** (`api`, `worker`, `web`) in the product layout of §01.4.2; the template's public site and console are `apps/public` and `apps/console`.
6. **IPB-01 AT-18 and IPB-02-35 disagree** on how the BOM is verified ("the platform public key" against keyless): keyless is assumed (IPB-02 is the security baseline) and a platform request asks to align AT-18 (PR-037).
7. **Tooling from Docker Hub images by digest, locally and in CI** (PL6-D-02 replaced the release-archive plan for CI); `helm diff` is not run without a cluster.
8. **No nightly `dev:up` job**: the path-filtered `reference` job runs the same smoke test on every change that could break it.

| #   | Question                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 66  | PL6 defaults: (a) OpenTofu, (b) the gate's preview is the CI-ephemeral stack, (c) images built and scanned but not pushed, (d) pnpm 10 in Dockerfiles, (e) `apps/reference` as `api`, `worker`, `web`, (f) keyless BOM verification, (g) tools from images or checksummed archives, (h) no nightly `dev:up`. Keep these?                                                                                                                                            |
| 67  | Blocked until the owner decides (stop conditions): (1) turn on cosign keyless signing and SBOM attestation for images and the BOM (a cryptography item, IPB-02-35) and switch the Kyverno policy to `Enforce`; (2) a hosted preview (database branching provider, cluster, domain; costs and accounts); (3) pushing images to GHCR (free for this public repository, but it publishes artefacts); (4) publishing 1.0.0 of every package once the PL6 gate is green. |

---

## 13. Sessions

| Session | Content                                                                                                                                                                                                                                                                                 |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1       | **Built: 1a (PL6-D-02) and 1b (PL6-D-03).** Containers: the Dockerfile shape, Dockerfiles for `apps/public` and `apps/console`, health routes, `.dockerignore`, the `containers` CI job, `@IPB-01-AT-15`; Compose `core` and `pnpm dev:up`                                              |
| 2       | **Built (PL6-D-04).** Helm chart, render tests, kubeconform, Kyverno policies and tests, the `infra` CI job (Helm part), `@IPB-01-AT-12` (Helm scenario)                                                                                                                                |
| 3       | **3a built (PL6-D-05): AWS and the contract. 3b built (PL6-D-06): Azure and GCP. 3c built: tflint.** OpenTofu modules for the three clouds, the `platform` compositions, the output contract and `tofu test`, the example env stack, the `infra` job (OpenTofu part), `@IPB-01-AT-14`   |
| 4       | **4a built (PL6-D-08): the api and worker skeleton, environment, adapters, sign-in, the `hello` module, the node image, Compose.** 4b: the gate endpoints (content, Vidhi, export, trust), the outbox relay, the Temporal worker, the `dev:up` bootstrap of Keycloak, MinIO and Unleash |
| 5       | `apps/reference` `web`, the gate journey in Playwright on Compose, the `reference` job, the NN tests on the stack                                                                                                                                                                       |
| 6       | Scaffold script and the `scaffold` job; `bom-generate` and `exit-runbook` (`@IPB-01-AT-17`, AT-18 without the signature)                                                                                                                                                                |
| 7       | Gate: `docs/phases/PL6-gate.md`, threat model, at-report, the platform exit gate of §14.5 item by item, the held 1.0.0 changeset PR; HANDOVER READY                                                                                                                                     |

---

## 14. Acceptance tests and exit gate

**Tagged and passing at the gate:** `@IPB-01-AT-01` (pin check now covers every Dockerfile), `@IPB-01-AT-12` (Helm scenario added), `@IPB-01-AT-14` (three clouds), `@IPB-01-AT-15`, `@IPB-01-AT-17`, `@IPB-01-AT-18` (partial until signing), and the NN pattern tests on the reference stack.

**PL6 exit gate (before the 1.0.0 decision):**

1. Every IPB-09 required check green, plus `a11y`, `containers`, `infra`, `reference` and `scaffold`.
2. Every image builds, runs as 10001 with a health check, and has no unwaived critical or high finding.
3. The chart renders for every kind and environment, refuses the seed in `prod`, `dr` and `pre-prod`, and passes kubeconform and the Kyverno tests.
4. The three clouds' `platform` modules return the same output contract under `tofu test`.
5. The reference stack runs locally through Compose and in CI, and the gate journey passes.
6. A product scaffolds from the template and its own CI passes in the `scaffold` job.
7. BOM and exit runbook generated; threat model, STATUS, DECISIONS, OWNER-QUESTIONS and platform-requests updated; the gate report written.

**Platform exit gate (IPB-14 §14.5)** is reported item by item in the gate report; items 1 (1.0.0 on GitHub Packages) and the hosted part of item 2 wait for #67.

---

## 15. Risks

| Risk                                                                | Mitigation                                                                                                |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Image and tool downloads are not reachable from the build sandbox   | Docker Hub images by digest locally; release archives by checksum in CI; MinIO per #4                     |
| The Compose stack is slow or flaky in CI                            | Health-gated start, one stack per job, the path filter, Playwright retries off (a flake is a bug)         |
| Provider schemas for `tofu validate` change under us                | Exact provider versions and the lock file committed per module; Renovate within the 7-day rule            |
| The template drifts from the packages                               | The `scaffold` job runs on every package change and installs the packed packages, not the workspace       |
| NestJS adds a large dependency tree to the licence and trust checks | Exact pins; the licence allow-list and the trust policy run on the lockfile as for every other dependency |
