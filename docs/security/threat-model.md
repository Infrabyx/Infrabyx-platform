# Threat model — infrabyx-platform

**Status:** living document (PL2-D-43). Updated by every PR that adds a port, adapter, package or data flow; the PR checklist points here. **Last updated:** 2026-10-26 (PL2 session 2 merged; session 3 in progress).

**Method:** STRIDE (Spoofing, Tampering, Repudiation, Information disclosure, Denial of service, Elevation of privilege) per package and per IPB-01 port, against the IPB-02 controls. Each control links to where it is specified (plan section, decision ID) and how it is proven (test tag). "Built" means merged on `main`; "planned" means specified in a phase plan and not yet built.

## 1. Scope, assets and trust boundaries

**In scope:** the `@infrabyx/*` packages, the reference routing files, CI workflows and the test infrastructure in this repository. **Out of scope here:** product code (each product keeps its own model), the cloud accounts themselves (PL6 Terraform and runbooks), and vendor internals (Vendor Assurance Room, IPB-D-09).

**Data classes** (IPB-02 §02.4.3.1): `PUBLIC` < `INTERNAL` < `CONFIDENTIAL` < `REGULATED` < `SECRET`. A class follows the content, not its protection (PL2 plan §6.9). A caller may only raise the class of a port call, never lower it below the port default (PL2-D-03).

| Asset                                                         | Class                   | Where it lives                                              |
| ------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------- |
| Tenant business records                                       | CONFIDENTIAL–REGULATED  | Product schemas (RLS), field-encrypted where REGULATED      |
| REGULATED fields (PAN, Aadhaar, bank account, card last four) | REGULATED               | Field envelope (PL1 C-04), masked everywhere else           |
| Audit ledger                                                  | INTERNAL (digests only) | `audit.ledger`, hash-chained, append-only; signed anchors   |
| Secrets, keys, tokens                                         | SECRET                  | SECRETS / KMS ports only; never env in production           |
| Idempotency results                                           | as the call             | `connectors.idempotency_record`, sealed ≥ CONFIDENTIAL      |
| Telemetry                                                     | INTERNAL (scrubbed)     | OTLP → Collector → Grafana stack, `IN`                      |
| Flag state                                                    | INTERNAL                | Unleash or `config.flag_value`; snapshot in `config`        |
| Seed credentials                                              | SECRET                  | Generated per run, `SEED_CREDENTIALS.md` never committed    |
| Published packages                                            | PUBLIC (to the org)     | GitHub Packages; provenance through `release.yml` on `main` |

**Trust boundaries:**

1. **Caller → kernel.** Every mutation runs in `PgKernel.mutate` with a verified tenant context; RLS is the last line (IPB-02-12).
2. **Kernel → port (router).** The router enforces data class, residency, recipient delivery and idempotency before any I/O (PL2 plan §3.1, §3.5, §3.12).
3. **Adapter → vendor (egress).** HTTPS only, host allow-list, no redirects (IPB-02-43, plan §3.7).
4. **Vendor → platform (webhooks).** Signature verified, de-duplicated, ledgered (IPB-10-27, plan §3.8).
5. **CI and supply chain → `main` → registry.** SHA-pinned actions, 7-day dependency age, publish only from `main` (IPB-02-33, PL2-D-32).

## 2. Cross-cutting controls

| ID   | Control                                                                                              | Specified in                  | Proven by                                               | State   |
| ---- | ---------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------- | ------- |
| X-01 | Tenant isolation: RLS enabled and forced on every tenant table; no BYPASSRLS role                    | IPB-02-12; PL1 plan           | `rls-lint` in CI; @NN-01                                | Built   |
| X-02 | Every mutation writes the hash-chained ledger in the same transaction                                | IPB-MOD-003; PL1-C-01         | @NN-45; `audit.int.test.ts`                             | Built   |
| X-03 | Ledger append-only for every role, the owner included; corrections are new entries                   | IPB-02-51/52                  | @NN-02                                                  | Built   |
| X-04 | Single cryptography call-site (`@infrabyx/crypto`); `node:crypto` elsewhere fails lint               | IPB-12-05; PL1-C-01           | ESLint `ipb/no-direct-crypto`                           | Built   |
| X-05 | Data class raise-only; residency and max-class checks before I/O                                     | IPB-01-16; PL2-D-03           | @IPB-01-AT-06, @IPB-01-AT-07                            | Built   |
| X-06 | GLOBAL messaging recipients need `allow_global` and a DPA reference; bodies stay ≤ INTERNAL          | IPB-DEV-05; plan §3.12        | `routing.test.ts`, router tests                         | Built   |
| X-07 | Egress: HTTPS, allow-list, redirects refused, size cap                                               | IPB-02-43; plan §3.7          | `core.test.ts` egress cases                             | Built   |
| X-08 | Idempotency: pending record first, vendor lookup, money never re-sent blind                          | IPB-02-AT-05; PL2-D-35        | @IPB-02-AT-05; `idempotency.int.test.ts`                | Built   |
| X-09 | Telemetry scrubber (mask rules, patterns, credential keys, payload keys) and C-21 hashed IDs         | IPB-02-23; PL2-D-36, PL2-D-38 | `otel.test.ts`, OBSERVABILITY hermetic leg              | Built   |
| X-10 | Kill switches fail on when provider and snapshot are both unavailable                                | IPB-02-83; PL2-D-39           | @IPB-02-AT-20 (PL1 and Unleash legs)                    | Built   |
| X-11 | Secrets named, never valued; routing files hold SECRETS paths only; env guard refuses literals       | IPB-01-19; IPB-02-28          | `checkRouting`; env guard tests; gitleaks               | Built   |
| X-12 | Supply chain: SHA-pinned actions, 7-day dependency age, `trustPolicy: no-downgrade`, provenance pins | IPB-02-33; PL2-D-32           | `ipb:check` supply-chain guard; frozen-lockfile install | Built   |
| X-13 | Vendor SDKs confined to `packages/connectors`                                                        | IPB-01-14                     | `ipb:check` vendor rule                                 | Built   |
| X-14 | Agents (`AGT_*`) can never approve, sign, disburse, delete or grant                                  | IPB-02-10; IPB-03 locked list | PL1 kernel test; Cerbos policy leg (planned, session 4) | Partial |
| X-15 | Publish only from `main`, one version PR, held to the gate                                           | CLAUDE.md; PL2-D-31           | `release.yml` branch guard                              | Built   |

## 3. Packages

### 3.1 `@infrabyx/contracts` (built)

Types, schemas and error codes only; no I/O.

- **T:** a schema too loose lets bad data through every product. Control: Zod strict schemas, payload data-class annotations, and `ipb/port-data-class` lint (an unannotated field fails).
- **I:** an error leaks internal detail. Control: RFC 9457 errors with code and help key; adapters put vendor detail in `meta`, never in `detail` shown to users (IPB-10).

### 3.2 `@infrabyx/crypto` (built)

- **I:** key material logged or serialised. Control: `SecretKey` is opaque (`toJSON`, `toString` and `inspect` print the ID only); material lives in a `WeakMap`.
- **T/S:** wrong algorithm or weak parameters. Control: the algorithm registry and CBOM (PL1), `assertApproved`, and the approved C-items only (plan §9). A new primitive is a stop-and-ask (CLAUDE.md working mode, item 1).
- **I:** joinable pseudonyms across purposes. Control: per-purpose HKDF sub-keys; telemetry hashes use `ipb/telemetry-id/v1` (PL2-D-36).

### 3.3 `@infrabyx/config` (built)

- **T:** a setting read before registration, or a production secret in env. Control: settings registry, env guard (exit 78) and the `process.env` lint (IPB-01-19).
- **E:** a flag flipped without governance. Control: `FlagAdmin` (kill switches by PLT_RELEASE_MANAGER/PLT_SECURITY_OFFICER, `fut.*` through R3 maker-checker) with a ledger entry (PL1-D-11).
- **D:** flag provider down. Control: last-known-good snapshot ≤ 24 h, then registry defaults; unknown `kill.*` evaluates on (X-10).

### 3.4 `@infrabyx/tenancy` (built)

- **S:** forged tenant or actor. Control: context only from verified claims; RLS insert policies bind `app.tenant_id` and `app.actor_id`.
- **E:** impersonation or break-glass abuse. Control: time-boxed, reason-required, ledgered; impersonated sessions cannot approve (`IPB-SEC-003`).
- **I:** REGULATED fields in plaintext. Control: field envelope encryption with per-tenant keys (PL1 C-04, C-15) and server-side masking.
- **T:** a shipped migration edited. Control: checksums in `meta.migration_checksums`; migration-lint `--record-checksums`; CLAUDE.md "never edit a migration that has shipped".

### 3.5 `@infrabyx/audit` (built)

- **R:** an action without a trace. Control: ledger-required commit (X-02); trigger-computed chain so no application path writes an unchained row.
- **T:** history rewritten. Control: append-only for every role (X-03); weekly verifier emits `LedgerChainBroken`; signed daily anchors on write-once storage (PL1 C-03).
- **I:** payloads in the ledger. Control: before/after stored only as canonical digests; IP and user agent as keyed pseudonyms (PL1 C-02).

### 3.6 `@infrabyx/seed` (built)

- **E/I:** seeds or seed credentials in production. Control: refusal first in `prod`, `dr`, `pre-prod` (`SEED_REFUSED_ENVS`, PL1-D-06); generated passwords; `SEED_CREDENTIALS.md` ignored and checked by `ipb:check`; forced rotation and MFA on first production login (IPB-D-04).

### 3.7 `@infrabyx/testing` (built)

- **T (supply chain):** a test image swapped. Control: images pinned by digest from Docker Hub, kept equal to `infra/docker/TEST_IMAGES.md` by a unit test; images from session 2 on were at least 7 days old when pinned (PL2-D-37).
- **I:** sandbox credentials printed. Control: the sandbox-leg gate prints missing variable names only, never values.

### 3.8 `@infrabyx/connectors` core (built)

- **S:** a forged vendor webhook. Control: signature verification before any processing, 401 on failure, inbox de-duplication, ledger entry `connectors.webhook.received` (plan §3.8; C-13 for per-vendor rules, session 3 onwards).
- **T:** a replayed or altered idempotent request. Control: request hash (C-20) compared on replay, mismatch is `IPB-PORT-004`; keys stored as SHA-256 hashes.
- **R:** idempotency outcomes untraceable. Control: each state change is ledgered (PL2-D-35).
- **I:** a result of a REGULATED call stored readable. Control: results ≥ CONFIDENTIAL are sealed with tenant field encryption; RLS on `connectors.idempotency_record`.
- **I:** data sent to a vendor that cannot hold it. Control: X-05, X-06, checked before I/O; refusal emits `ResidencyViolationBlocked`.
- **D:** a failing vendor stalls callers. Control: circuit breaker per adapter (PL2-D-33), timeouts and bounded retries in egress, health registry; STORAGE writes fail fast instead of queueing bytes (IPB-DEV-06).
- **E/T:** SSRF through a vendor URL. Control: egress allow-list and no redirects (X-07).
- **Money:** a money call re-sent after an unknown outcome would double-charge or double-refund. Control: unknown outcomes stay pending and go to reconciliation; never re-sent (X-08, P-05).

## 4. Ports

Each row: the main threats for the port, its controls, the class ceiling and the state. Adapters are the reference and the alternative kept green (plan §6).

| Port          | Adapters                       | Max class               | Main threats (STRIDE)                                                                                                                       | Controls                                                                                                                                                                                                       | State                                                     |
| ------------- | ------------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| SECRETS       | `aws-sm`, `vault` (OpenBao)    | SECRET                  | **I** value in logs, spans or errors; **T** stale or wrong version served; **D** store down; **E** over-broad access                        | Values in memory only, 15-min cache, never older than 24 h; fetch failure after expiry makes the pod not-ready; scrubber assertion in contract tests; platform CMK (C-18); OIDC, no stored keys (§6.1)         | Planned: session 3                                        |
| KMS           | `aws-kms`, `vault-transit`     | SECRET                  | **T/S** wrong AAD or signature accepted; **I** plaintext fallback on outage; **E** tenant key deleted early                                 | AAD bound to `{tenant_id, purpose}` (C-14); fail closed `IPB-KMS-001`, no plaintext fallback; deletion ≥ 30 days after R5 maker-checker, refused under legal hold (C-15)                                       | Planned: session 3                                        |
| OBSERVABILITY | `otel` (two exporter profiles) | INTERNAL                | **I** REGULATED data or raw IDs exported; **I** vendor intake key leaked; **D** exporter outage blocks callers                              | X-09; GenAI content capture locked off; `otlp-direct` headers from SECRETS; HTTPS unless local; exporter failures never reach the caller (PL2-D-38)                                                            | Built (session 2)                                         |
| FEATURE_FLAG  | `unleash`, `config-db`         | INTERNAL                | **E** ungoverned flag change; **I** raw tenant IDs in contexts; **D** provider down                                                         | Writes through `FlagAdmin`; contexts must be C-21 hashes (`IPB-PORT-003`); staleness bound then snapshot then safe state (X-10, PL2-D-39); admin token from SECRETS                                            | Built (session 2)                                         |
| IDENTITY      | `keycloak`, `zitadel`          | CONFIDENTIAL            | **S** forged or replayed token, algorithm confusion; **E** missing MFA for privileged roles; **R** sessions survive de-provisioning         | C-11 verification rules (allow-list per issuer, no `none`/`HS*`, `kid` required, header refusals, ±60 s skew); ES256 signing (C-12); MFA by role (IPB-02-02); back-channel logout and SCIM deactivation ≤ 60 s | Planned: session 4                                        |
| AUTHZ         | `cerbos`, `openfga`            | CONFIDENTIAL            | **E** allow on PDP outage; **E** agents approving; **I** cross-product disclosure                                                           | Deny on PDP down (`IPB-AUTHZ-001`); allow cache ≤ 5 s; agent denials (X-14); `product_scope` bounds with no disclosure (IPB-02-11); parity table across adapters                                               | Planned: session 4                                        |
| STORAGE       | `s3`, `minio`                  | SECRET                  | **T** retained objects deleted; **I** long-lived or misused presigned URLs; **I** cross-tenant keys                                         | Object Lock compliance mode (PL1-D-06); presign ≤ 300 s bound to method and content type (IPB-02-15); SSE-KMS (C-17, tenant CMK per C-15); tenant-prefixed keys                                                | Planned: session 5                                        |
| QUEUE         | `bullmq`, `pg-boss`            | INTERNAL                | **I** sensitive payloads on the queue; **T** duplicate processing                                                                           | Router refuses payloads above INTERNAL (IDs only); idempotent consumers; explicit job IDs (PL2-D-28); DLQ and replay ledgered                                                                                  | Planned: session 5                                        |
| WORKFLOW      | `temporal`, `temporal-cloud`   | CONFIDENTIAL / INTERNAL | **I** readable history (IDs, names, failures) at the vendor; **T** non-deterministic replay                                                 | Payload codec on both adapters including failure attributes (C-16); no personal data in IDs, names or search attributes; CONFIDENTIAL inputs only on self-hosted or by STORAGE reference (§6.9)                | Planned: session 5                                        |
| EMAIL         | `ses`, `brevo`                 | INTERNAL                | **S** forged bounce or complaint webhooks; **I** CONFIDENTIAL content inline; **I** recipients to a GLOBAL vendor                           | SNS SignatureVersion 2 only, cert host pinned to ap-south-1/2, TopicArn checked (C-13); Brevo bearer plus IP allow-list; CONFIDENTIAL as secure link; X-06                                                     | Planned: session 6                                        |
| SMS           | `msg91`, `gupshup-sms`         | INTERNAL                | **S** forged delivery reports; **T** non-DLT content sent; misuse as an admin MFA factor                                                    | DLT template and header checks before send; signed or authenticated webhooks; SMS never an MFA factor for admin roles (IPB-02-02); live sends only to the owner's test number after DLT                        | Planned: session 6                                        |
| WHATSAPP      | `gupshup`, `meta-cloud`        | INTERNAL                | **S** forged webhooks; **I** recipients and media at a GLOBAL processor; marketing sent by mistake                                          | `X-Hub-Signature-256` (C-13); DPA per adapter (X-06); CONFIDENTIAL media as secure link; marketing templates off (OWN-08); test mode only                                                                      | Planned: session 6                                        |
| PAYMENTS      | `razorpay`, `cashfree`         | REGULATED               | **T** amount tampering or float rounding; **S** forged webhooks or return signatures; **E** refund without approval; live money by accident | Integer paise only (P-04); signatures verified in the adapter (P-09, C-13); refund requires an approved R3 `approvalRef` (P-07); no live keys outside prod/dr (P-03); idempotency X-08; `kill.payments` (P-12) | Planned: session 7 (locked list approved with conditions) |

## 5. CI and supply chain

- **T:** a compromised action or dependency. Controls: X-12; Renovate as the single updater; `ipb:check` refuses regressions; dependency and image ages recorded in DECISIONS (PL2-D-32, PL2-D-37).
- **E:** over-privileged release token. Open risk R-01 below; the GitHub App token replaces `NPM_PUBLISH_TOKEN` before production (PL1-D-21, PL2-D-42).
- **I:** secrets in commits. Controls: gitleaks in CI with a reviewed baseline, the pre-commit env and credential guard, generated test tokens (no literal tokens in tests).
- **D:** CI minutes exhausted on GitHub Free. Control: CI budget (PL2-D-41, PL2-D-44); weekly full matrix, changed-ports nightly.

## 6. Open risks

| ID   | Risk                                                                                                                 | Current mitigation                                                                             | Owner / next step                                            |
| ---- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| R-01 | `release.yml` uses a personal access token (`NPM_PUBLISH_TOKEN`) wider than a release needs                          | Used only on `main`, in the release job                                                        | Owner: GitHub App token before production (PL1-D-21)         |
| R-02 | Sandbox legs are off until the owner accounts exist, so vendor behaviour is proven only against stubs and containers | Gate B: unproven adapters are refused in staging and above (IPB-DEV-04, `sandbox-status.json`) | Owner accounts; latest-by dates in `docs/runbooks/`          |
| R-03 | Breaker state is per replica, so replicas may disagree briefly about a failing vendor                                | Each replica trips within its own window; events de-duplicated in the console (PL2-D-33)       | Revisit if PL6 load tests show flapping                      |
| R-04 | AWS KMS ML-DSA in ap-south-1 is unconfirmed                                                                          | ML-DSA stays `planned` behind `crypto.pqc.sign_hybrid`                                         | One `CreateKey` call in the sandbox account (D-01)           |
| R-05 | The `main` ruleset is not applied until the GitHub Team upgrade                                                      | CI required by convention and the standing authority; no force-push to `main` (CLAUDE.md)      | Owner: GitHub Team, then `infra/policy/github/rulesets.json` |
| R-06 | Telemetry scrubbing is pattern-based; a REGULATED value in an unexpected shape could pass                            | Mask-rule keys, payload keys dropped, scrubber tests; logs stay `IN` with 180-day retention    | Add product-specific patterns as products onboard            |
| R-07 | Unleash and OTel Collector run self-hosted with tokens; a leaked client token exposes flag state (INTERNAL)          | Tokens from SECRETS; client tokens are environment-scoped and read-only                        | Rotation runbook in PL6                                      |
