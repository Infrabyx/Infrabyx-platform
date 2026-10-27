# PL2 gate A — publish report

**Date:** 2026-10-27 · **Checked against:** `main` at `3d57792` and version PR #14 at `fc2344b` (its base is `3d57792`) · **Checklist:** `docs/phases/PL2-plan.md` §11 (gate A), §10 (acceptance tests) · **Split gate:** IPB-DEV-04

Gate A closes PL2 and publishes the 0.x pre-releases. Gate B is per adapter: it needs a vendor test account and comes later (§3 below).

## 1. Result

The first check found **one item failing**: item 5, acceptance tests by tag. Item 4 (the `port-contract` issues) was **not yet done**. One adoption gap was also found: `sandbox-status.json` was not in the published package, so products could not run the gate-B routing check. All three were fixed in the gate-A PR, so every item now passes or does not apply. The release went ahead under the standing authority (PL2-D-19, PL2-D-41) and is published (§6).

| #   | Gate-A item (plan §11)                                                                                 | Result                                   | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | All IPB-09 required checks green, including the PL2 additions                                          | **pass**                                 | `main` `3d57792`: `ci` run 82 (id 40433598701) and `release` run 27 (id 40433598801, which runs the full `port-contract` matrix) green. PR #14 at `fc2344b`: all 17 check runs green: `verify (24.22.1)` (lint, typecheck, unit, `test:policy`, licence, `ipb:check`, migration-lint, registry-check, routing-check, dev-keys, env-example, pr-checklist, gitleaks, commitlint), `integration`, `changes`, `plan` and 13 `contract (<PORT>)` jobs. The gate-A PR adds its own green run                     |
| 2   | All 13 ports: unit and hermetic legs green for the reference and the alternative                       | **pass**                                 | PR #14 `port-contract` run 40433709497: 13 of 13 `contract (<PORT>)` jobs green (SECRETS, KMS, OBSERVABILITY, FEATURE_FLAG, IDENTITY, AUTHZ, STORAGE, QUEUE, WORKFLOW, EMAIL, SMS, WHATSAPP, PAYMENTS), each running both adapters' hermetic legs (for example SMS: 24 tests, msg91 and gupshup-sms). Test counts per port: §2                                                                                                                                                                              |
| 3   | Sandbox legs green for every adapter whose account exists                                              | **not applicable**                       | No vendor test account and no GitHub `sandbox` environment exists yet (`docs/runbooks/README.md`; PL2-D-44 keeps sandbox legs skipped until the environment exists). No sandbox leg could run, so none is red                                                                                                                                                                                                                                                                                               |
| 4   | Each missing sandbox leg is an open `port-contract` issue; adapter `unproven` in `sandbox-status.json` | **pass** (not done before the gate-A PR) | No issue existed at the first check. Opened #28–#39, one per adapter (§3). `sandbox-status.json` now names each issue, and `ipb:check` fails if an unproven adapter with a sandbox leg has none. All 13 listed adapters are `unproven`                                                                                                                                                                                                                                                                      |
| 5   | Acceptance tests in §10 present by tag and passing; `pnpm at:report` lists them                        | **pass** (failed at the first check)     | The first check found five §10 IDs with no tagged test: `@IPB-01-AT-04`, `@IPB-01-15`, `@IPB-01-17`, `@IPB-01-18`, `@IPB-10-27`. Tests for them existed but carried no tag. The gate-A PR tags them: the vendor-import rule test, with the exact AT-04 fixture added; the 27 hermetic-leg suites; health aggregation; the circuit-breaker and failover suites, plus a new chaos case where a GLOBAL secondary for a REGULATED primary is refused; inbound webhooks. `at-report` now lists every §10 ID (§4) |
| 6   | `provider_routing` loader refuses the broken fixtures; reference routing files validate                | **pass**                                 | `config/src/routing/routing.test.ts`: the broken file fails with `IPB-PORT-005` (`@IPB-01-AT-07`); unproven adapters are refused in staging; the CLI exits 1 on an invalid file. `routing-check` in `verify`: `local.routing.yaml` (10 ports) and `ci.routing.yaml` (7 ports) ok                                                                                                                                                                                                                            |
| 7   | `@NN-01/02/45` green with the new schema; migration-lint and rls-lint clean on `connectors`            | **pass**                                 | PR #14 `integration` job (PostgreSQL 18.6): `infrabyx-migrate` applies tenancy → audit → config → seed → connectors; `rls-lint` clean; `test:int` 30 of 30 turbo tasks; connectors 8 tests (`idempotency.int` 5 with `@NN-01`/`@NN-45`, `revocation.int` 3), tenancy 16, audit 7 (`@NN-02`, `@NN-45`), seed 8, testing 26. `migration:lint` in `verify` green                                                                                                                                               |
| 8   | Changesets: `connectors` 0.1.0 (publishable), `contracts`/`crypto`/`config`/`testing` 0.2.0            | **pass**                                 | PR #14 body: `@infrabyx/connectors@0.1.0` (`"private": false`), `contracts`, `crypto`, `config`, `testing` 0.2.0; also `tenancy` 0.2.0, `seed` 0.2.0 (both minor) and `audit` 0.1.1 (dependency patch). The 15 scaffolds stay private (PL1-D-20)                                                                                                                                                                                                                                                            |
| 9   | `docs/STATUS.md`, `docs/DECISIONS.md` and `docs/platform-requests.md` updated                          | **pass**                                 | Updated in the gate-A PR (STATUS handover, PL2-D-67). `platform-requests.md` already carries PR-002 to PR-016 and gate A adds none                                                                                                                                                                                                                                                                                                                                                                          |
| 10  | Published through `release.yml`                                                                        | **pass**                                 | Version PR #14 merged as `a09d13c` (17/17 green on `5b5be77`). `release.yml` run 29: full matrix green, 8 packages published, 8 tags pushed (§6)                                                                                                                                                                                                                                                                                                                                                            |

Also checked:

- **Threat model** (PL2-D-43). §3.8–§3.12 cover every PL2 adapter, and R-10 to R-14 are open risks. The **Last updated** date was stale (session 5) and is now set to the gate review.
- **`ipb:check`** passes, including the PL2 rule that every port has a contract suite and two adapter folders.

## 2. Hermetic legs per port

Every port runs its reference and its alternative on Testcontainers or vendor stubs. The counts are for each port's job, `pnpm --filter @infrabyx/connectors test:contract -- --port <PORT>`, in the gate-A PR's `port-contract` run 40435490177 (head `d322807`). Across the 13 ports, 329 tests passed and 1 was skipped. The skipped test is the Brevo sandbox leg, which waits for its account (#33). The release run 29 re-ran all 13 ports green before publishing.

| Port          | Reference → alternative          | Hermetic leg runs on                                                    | Tests                                  |
| ------------- | -------------------------------- | ----------------------------------------------------------------------- | -------------------------------------- |
| SECRETS       | `aws-sm` → `vault`               | moto 5.2.4 with a CloudTrail stub; OpenBao 2.7.1                        | 23                                     |
| KMS           | `aws-kms` → `vault-transit`      | LocalStack 4.12.0; OpenBao 2.7.1                                        | 25                                     |
| OBSERVABILITY | `otel` (collector → otlp-direct) | OTel Collector contrib 0.162.0                                          | 5                                      |
| FEATURE_FLAG  | `unleash` → `config-db`          | Unleash 8.2.0; PostgreSQL 18                                            | 15                                     |
| IDENTITY      | `keycloak` → `zitadel`           | Keycloak 26.8.1; Zitadel v4.19.5 (CI only, GHCR)                        | 21 (keycloak 11, zitadel 10)           |
| AUTHZ         | `cerbos` → `openfga`             | Cerbos 0.57.0; OpenFGA v1.22.0                                          | 18                                     |
| STORAGE       | `s3` → `minio`                   | moto 5.2.4; MinIO server RELEASE.2025-09-07T16-13-09Z built from source | 38                                     |
| QUEUE         | `bullmq` → `pg-boss`             | Redis 7.4, Valkey 8.1; PostgreSQL 18                                    | 29                                     |
| WORKFLOW      | `temporal` → `temporal-cloud`    | Temporal dev server (CLI 1.9.1, server 1.32.0)                          | 12                                     |
| EMAIL         | `ses` → `brevo`                  | SES v2 stub and moto 5.2.4; Brevo stub                                  | 32 (+1 skipped: the Brevo sandbox leg) |
| SMS           | `msg91` → `gupshup-sms`          | MSG91 and Gupshup Enterprise SMS stubs                                  | 24                                     |
| WHATSAPP      | `gupshup` → `meta-cloud`         | Gupshup WhatsApp and Meta Graph stubs                                   | 28                                     |
| PAYMENTS      | `razorpay` → `cashfree`          | Razorpay and Cashfree stubs, test mode only                             | 29                                     |

## 3. Proven and unproven adapters

**Proven by their hermetic legs. Products may use them in every environment, subject to their routing rules:**

- `vault`, `vault-transit` (OpenBao);
- `otel`, both exporter profiles;
- `unleash`, `config-db`;
- `keycloak`, `zitadel`;
- `cerbos`, `openfga`;
- `bullmq`, `pg-boss`;
- `temporal` (self-hosted).

These adapters have no vendor sandbox leg, so `sandbox-status.json` does not list them.

**Unproven until gate B.** Each waits for a vendor test account. `infrabyx-routing check` refuses these adapters in `staging`, `pre-prod`, `prod` and `dr` routing files until the closing PR marks them `proven`. They may be used in `local`, `dev`, `test` and `ci`.

| Adapter          | Port     | Waiting for (owner action)                                          | Runbook                                         | Issue |
| ---------------- | -------- | ------------------------------------------------------------------- | ----------------------------------------------- | ----- |
| `s3`             | STORAGE  | AWS Organization and sandbox account (D-01)                         | `docs/runbooks/aws-organization-and-sandbox.md` | #28   |
| `aws-sm`         | SECRETS  | AWS sandbox account (D-01)                                          | same                                            | #29   |
| `aws-kms`        | KMS      | AWS sandbox account (D-01)                                          | same                                            | #30   |
| `ses`            | EMAIL    | AWS sandbox account (D-01)                                          | same                                            | #31   |
| `temporal-cloud` | WORKFLOW | Temporal Cloud namespace in Mumbai (D-06; paid)                     | `docs/runbooks/temporal-cloud.md`               | #32   |
| `brevo`          | EMAIL    | Brevo account, sending only (D-08, OWN-15)                          | `docs/runbooks/messaging-vendors.md`            | #33   |
| `msg91`          | SMS      | MSG91 account and DLT registration (D-07); also the weekly live SMS | same                                            | #34   |
| `gupshup-sms`    | SMS      | Gupshup Enterprise SMS account (D-07)                               | same                                            | #35   |
| `gupshup`        | WHATSAPP | Gupshup WhatsApp sandbox app (D-07)                                 | same                                            | #36   |
| `meta-cloud`     | WHATSAPP | Meta developer app with test number (D-07)                          | same                                            | #37   |
| `razorpay`       | PAYMENTS | Razorpay test mode keys (P-16)                                      | same                                            | #38   |
| `cashfree`       | PAYMENTS | Cashfree sandbox keys (P-16)                                        | same                                            | #39   |

Every sandbox leg also needs the GitHub `sandbox` environment, which requires GitHub Team (PL2-D-12, `docs/runbooks/README.md` §2).

`minio` has no `port-contract` issue. Its hermetic leg and the MinIO-server leg are green, but by owner decision it stays `unproven` and is refused outside dev and test (PL2-D-61). Its production replacement is a PL6 decision (PR-015).

**Consequence for products:** staging can use self-hosted adapters only until the AWS sandbox account exists. `s3`, `aws-sm`, `aws-kms` and `ses` are the first adapters a staging deployment needs.

## 4. Acceptance tests (plan §10)

`pnpm at:report` lists every §10 ID with at least one tagged test file:

- `@IPB-01-AT-04`, `-AT-06`, `-AT-07`, `-AT-08`, `-AT-09`, `-AT-10`, `-AT-13`, `-AT-19`;
- `@IPB-01-15`, `-16`, `-17`, `-18`, `-20`;
- `@IPB-02-AT-02` (API half), `@IPB-02-05`, `@IPB-02-AT-05`, `-AT-11`, `-AT-13`, `-AT-15`, `-AT-20`;
- `@IPB-10-27`, `@IPB-10-29`;
- `@NN-01`, `@NN-02`, `@NN-45`.

Spec ATs with a tagged test: 39 of 272 (the rest belong to later phases).

Deferred as the plan says:

- `@IPB-02-AT-01` and the browser half of `-AT-02`: UI, PL5;
- `@IPB-02-AT-14`: Kyverno, PL6;
- `@IPB-01-AT-20`: staging swap drill, PL6;
- the IPB-10 outbound-webhook ATs: PL6.

## 5. What each product must change to adopt this release

Applies to Udofin, Finbyx, LawDocs, LawDocsComply, Equator and Operations Hub.

**Package versions.** Move every `@infrabyx/*` dependency together:

| Package                | From  | To              |
| ---------------------- | ----- | --------------- |
| `@infrabyx/contracts`  | 0.1.0 | **0.2.0**       |
| `@infrabyx/crypto`     | 0.1.0 | **0.2.0**       |
| `@infrabyx/config`     | 0.1.0 | **0.2.0**       |
| `@infrabyx/tenancy`    | 0.1.0 | **0.2.0**       |
| `@infrabyx/seed`       | 0.1.0 | **0.2.0**       |
| `@infrabyx/testing`    | 0.1.0 | **0.2.0** (dev) |
| `@infrabyx/audit`      | 0.1.0 | **0.1.1**       |
| `@infrabyx/connectors` | —     | **0.1.0** (new) |

**Migrations, through `infrabyx-migrate`.** No new command. Once `@infrabyx/connectors` is installed, the existing `infrabyx-migrate` (tenancy 0.2.0) applies its migrations after seed, with checksums in `meta.migration_checksums` (PL2-D-34):

- `connectors/0001_init.sql`: `idempotency_record`, forced RLS;
- `connectors/0002_session_revocation.sql`: the revocation store for IDENTITY;
- `connectors/0003_pgboss.sql`: the pg-boss schema. pg-boss runs DML-only and does no DDL at runtime.

After migrating, run `infrabyx-rls-lint` as before.

**Environment variables.**

- **`AUTH_SUPER_ADMIN_EMAIL`** (seed 0.2.0, PL2-D-63). It sets the super-admin persona's address. Set it only in each private product repository's local environment, never in this repository. Without it the seed uses the placeholder `super.admin@example.test`. Callers of `personasFor`, `RunSeedOptions`, `CredentialsOptions` and `checkCredentialsFile` pass it through.
- Per port, only for the adapters a product routes to. Names are in plan §6; in production, `_REF` values are SECRETS paths and never literal secrets (IPB-01-19):
  - SECRETS: `SECRETS_ADAPTER`, `SECRETS_AWS_REGION`, `SECRETS_VAULT_ADDR`, `SECRETS_VAULT_ROLE`, `SECRETS_CACHE_TTL_S`
  - IDENTITY: `AUTH_ADAPTER`, `AUTH_ISSUER_URL`, `AUTH_CLIENT_ID`, `AUTH_ADMIN_CLIENT_ID`; `AUTH_CLIENT_SECRET`, `AUTH_ADMIN_CLIENT_SECRET` and `AUTH_SCIM_BEARER_REF` from SECRETS; `AUTH_MFA_REQUIRED_ROLES`, `AUTH_JWKS_CACHE_S`, `AUTH_SESSION_*`, `AUTH_PASSKEYS_*`
  - FEATURE_FLAG: `FLAGS_ADAPTER`, `FLAGS_UNLEASH_URL`, `FLAGS_UNLEASH_API_TOKEN_REF`, `FLAGS_FILE_PATH`
  - OBSERVABILITY: `OBS_OTLP_ENDPOINT`, `OBS_OTLP_HEADERS_REF`, `OBS_OTLP_INSECURE`, `OBS_SERVICE_NAMESPACE`, `OBS_TRACE_SAMPLE_RATIO`, `OBS_LOG_LEVEL`, `OBS_LOG_FORMAT`, `OBS_AUDIT_HASH_CHAIN_KEY_REF`
  - STORAGE: `STORAGE_ADAPTER`, `STORAGE_REGION`, `STORAGE_ENDPOINT`, `STORAGE_BUCKET_*`, `STORAGE_KMS_KEY_REF`, `STORAGE_OBJECT_LOCK_MODE`, `STORAGE_PRESIGN_TTL_S` (`STORAGE_ACCESS_KEY_ID`/`_SECRET_ACCESS_KEY` local only)
  - QUEUE: `QUEUE_REDIS_URL`, `QUEUE_CONCURRENCY`
  - WORKFLOW: `WORKFLOW_TEMPORAL_ADDRESS`, `WORKFLOW_TEMPORAL_NAMESPACE`, `WORKFLOW_TASK_QUEUE`, `WORKFLOW_TEMPORAL_TLS_CERT_REF`, `WORKFLOW_TEMPORAL_TLS_KEY_REF`
  - EMAIL, SMS, WHATSAPP: `MSG_EMAIL_ADAPTER`, `MSG_EMAIL_FROM`, `MSG_EMAIL_DKIM_KEY_REF`; `MSG_SMS_ADAPTER`, `MSG_SMS_API_KEY`, `MSG_SMS_DLT_ENTITY_ID`; `MSG_WHATSAPP_ADAPTER`, `MSG_WHATSAPP_PHONE_NUMBER_ID`, `MSG_WHATSAPP_ACCESS_TOKEN_REF`, `MSG_WHATSAPP_VERIFY_TOKEN`
  - PAYMENTS: `PAYMENTS_RAZORPAY_KEY_ID`, `PAYMENTS_RAZORPAY_KEY_SECRET`, `PAYMENTS_RAZORPAY_WEBHOOK_SECRET`, `PAYMENTS_CASHFREE_APP_ID`, `PAYMENTS_CASHFREE_SECRET_REF`. Use test-mode values only. The env guard `payments-live-key` refuses a live key outside `prod` and `dr` (P-03, exit 78).

**New settings keys** (config 0.2.0; 156 keys in the registry). They are registered with defaults. Set only those your adapters need:

- SECRETS and KMS: `int.secrets.provider`, `.path_prefix`, `.cache_seconds`; `int.kms.platform_key_id`, `.tenant_key_policy`, `.data_key_cache_seconds`, `.algorithms_allowed`
- OBSERVABILITY: `eng.otel.endpoint`, `.sampling_ratio`, `.genai.capture_content`; `eng.logs.retention_days`, `.region`
- FEATURE_FLAG: `eng.flags.provider`, `.url`, `.snapshot_ttl_hours`
- IDENTITY and AUTHZ: `int.identity.issuer_url`, `.realm`, `.jwks_cache_seconds`, `.passkeys.enabled`, `.scim.enabled`, `.session.idle_minutes`; `int.authz.pdp_url`, `.bundle_version`, `.decision_cache_seconds`
- STORAGE, QUEUE, WORKFLOW: `int.storage.bucket.{class}`, `.region`, `.presign_ttl_seconds`, `.replication.target`; `int.queue.url`, `.default_attempts`, `.backoff`, `.dlq_retention_days`; `int.workflow.address`, `.namespace`, `.task_queue_prefix`, `.history_ttl_days`
- EMAIL: `int.email.provider`, `.from.{brand}`, `.reply_to`, `.dkim_selector`, `.bounce_webhook_path`
- SMS: `int.sms.provider`, `.dlt_entity_id`, `.sender_id.{brand}`, `.template_map`, `.low_balance_credits` (default 500)
- WHATSAPP: `int.whatsapp.provider`, `.waba_id.{brand}`, `.phone_id.{brand}`, `.template_namespace`, `.webhook_verify_token`, `.rate_card` (deployment configuration only); `mkt.meta.enabled` (default false, OWN-08)
- PAYMENTS: `int.payments.webhook_path`, `.settlement_account_ref`, `.methods_enabled`

**Routing files** (IPB-01-20):

- Each product adds `infra/routing/<env>.routing.yaml` per environment, starting from `infra/routing/reference/{local,ci}.routing.yaml`.
- Add `infrabyx-routing check infra/routing/**/*.yaml --sandbox-status node_modules/@infrabyx/connectors/sandbox-status.json` (the file ships in the package from this release, PL2-D-67) to CI.
- A staging-or-above file that names an unproven adapter fails until gate B (§3).
- GLOBAL messaging entries (`brevo`, `meta-cloud`) need a `dpa_ref` before they receive recipient fields. A product file may tighten `residency_policy` but never loosen it (`IPB-PORT-005`).

**Code changes.**

- **PAYMENTS:**
  - provide a `RefundApprovals` view on the approvals engine;
  - a refund needs an approved R3 maker request with payload `{ paymentId, amountMinor, reason }`;
  - Cashfree needs a `customerContact` resolver;
  - refund orders taken during failover through `router.portFor("PAYMENTS", order.adapter)` (P-07, P-08);
  - amounts are integer paise only (P-04).
- **IDENTITY:** `authenticate` takes the PKCE `codeVerifier`. Guard ORG_ADMIN and other MFA roles with `assertMfaForRoles`. Impersonation is unsupported (PL2-D-55).
- **Field encryption v2** (PL2-D-50): `FieldCrypto` seals new values under `{ tenant_id, purpose: "field" }`. v1 values stay readable; `rewrapField` re-wraps them when convenient. `KmsPort.generateDataKey` needs a valid C-14 context.
- **STORAGE:** `presign(key, op, ttl, { bucketClass, contentType })`.
- **Webhooks:** Gupshup webhook URLs carry `ipb_token` (at least 32 random bytes, rotated). Ingress logs must redact query strings; the platform's telemetry scrubber already does (PL2-D-65).

## 6. Release

**Published.** Version PR #14 was merged as `a09d13c` after its CI went green on the new `main`: 17 of 17 checks on head `5b5be77`. `release.yml` run 29 (id 40436757203) then:

- re-ran the full `port-contract` matrix, 13 of 13 green;
- published the 8 packages below to GitHub Packages ("packages published successfully");
- pushed one git tag per package.

No package was skipped, and no error was logged.

| Package                | Version | Tag                          | shasum (SHA-1, registry)                   | integrity (SHA-512, registry)                                                                     |
| ---------------------- | ------- | ---------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `@infrabyx/contracts`  | 0.2.0   | `@infrabyx/contracts@0.2.0`  | `812119f57992b4a96a9a06ff5cc25235c6f9b6d1` | `sha512-v8vJbeQH4j38mkKMKlWGyAsvocSFcybwLXUIrq0/Yl7YaANeXp87oGtmlrHX0+9ulyxphezhlD4I0v7fxTM60Q==` |
| `@infrabyx/crypto`     | 0.2.0   | `@infrabyx/crypto@0.2.0`     | `d999360aa85318cf5835f9bc68cded9817b69d91` | `sha512-1SLcsvQXbnjVdAsELwp0WDN2qzP878Q9TEMuZ3etctK4BlMarBYSZUvXhFiTgjvpOk7imAqoqzZ9T4fA6JGUeg==` |
| `@infrabyx/config`     | 0.2.0   | `@infrabyx/config@0.2.0`     | `4e3ecaa978abc82d6133270d4ff23c6d280f9b6c` | `sha512-aGtVD6s6mpPsA8XlSfrXzA/U7eZbiNY+e+9B+lEcQoKBtg/NI+stFfUQzFXcUzmNVQI9sM3m1BRZ/Vv6mIptlg==` |
| `@infrabyx/tenancy`    | 0.2.0   | `@infrabyx/tenancy@0.2.0`    | `74125a19c1b64ee8d7d12c802affc590d2f7dea9` | `sha512-ApUgJBqE7k4ljocV5EgqQunmGahdYW1UzAh8X34lLJhf5QGctJfMETr7yIHMYVR7wZR5abTRtZdlBHVHp8J9zg==` |
| `@infrabyx/audit`      | 0.1.1   | `@infrabyx/audit@0.1.1`      | `333771decdbab2ce0e5410efb3c4270d58c24b65` | `sha512-I046pxwyQ1KAabRUh2Sr2g0p0xohJYI3oYM9dX1cCVSxLlG/H8ll2v/LhQkNrwa8e5kxvdJek3HECA6BaOoE7w==` |
| `@infrabyx/seed`       | 0.2.0   | `@infrabyx/seed@0.2.0`       | `abe263d2da43e54456456408b98777f6884255ea` | `sha512-mMbqsi09E9AA3IT8Ua4sAqwlFFURYrxuoItm1zsE20tf81kXI+aw+d7/cpRYhtbqXy3aQvun73eflaQ3x9B93w==` |
| `@infrabyx/testing`    | 0.2.0   | `@infrabyx/testing@0.2.0`    | `ec39fd2e6f61c1329567898faa6e915df5c6f6e2` | `sha512-EMic5/naolc4/EtdEHIqwVr5I5G8phnUYMnRxyO0Nfm4HVfYuQ+OdZcOfb8P9dn2XW0Z2qF4bEcAUn+5F8SYcA==` |
| `@infrabyx/connectors` | 0.1.0   | `@infrabyx/connectors@0.1.0` | `5e97dd5c6a6ed8a53a6f057fc8bf07388d5ad6d7` | `sha512-lU5AxPsbhZ2/Py81ZJ3At1YDqfpwtOHQwSTVwtC1dhbbq/c/MRfrWt1lR4tORM4kJ3zf7KJplmWknWpm3GS1yw==` |

**Where the checksums come from (corrected 27 Oct 2026, PL3-D-14).** The table now carries the **registry's own values**, read by `registry-dist.yml` run 1 with the repository's registry token (`npm view <name>@<version> dist`). Five packages matched the reproduced values first published here. Three did not: `tenancy`, `seed` and `testing` 0.2.0. The values first reported for those three were:

- `tenancy` `740d4167d6b6b96dde549c5447b0fc29e2f6b194`;
- `seed` `378f258996e5c7d3c1941e786efd786e8afc276d`;
- `testing` `25f5f0b4ddb12b243e8715173394a99acbb5fc27`.

So the CI build was not byte-reproducible locally for those three packages. There were two causes, and the file contents are otherwise identical (PL3-D-14):

- the bin files of these three packages were packed 0644 locally but 0755 in CI;
- `pnpm pack` writes the rewritten `workspace:*` dependencies in a non-deterministic key order.

The original note follows.

The registry could not be read from the build session:

- GitHub Packages answered 401 to its token, and the packages API answered 403, because the session token is bound to the repository.
- `changeset publish` prints no tarball details.

So the values above were **reproduced**: `pnpm pack` of each package at the release commit `a09d13c`, on Node 24.22.1 with the frozen lockfile. A rebuild packed byte-for-byte identically. The connectors tarball contains `sandbox-status.json`. If the CI runner's tarballs are identical, these are the registry values.

**Registry confirmation.**

- Done (OWNER-QUESTIONS #17 closed, PL3-D-14): `registry-dist.yml` read the registry; the table above carries its values.
- From the next release, `release.yml` writes the registry's own `dist.shasum` and `dist.integrity` to the job summary (`scripts/registry-dist.mjs`), so later gate reports quote the registry directly.
