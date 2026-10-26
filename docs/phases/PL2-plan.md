# PL2 — Ports and reference adapters

**Phase:** PL2 (IPB-14 §14.3) · **Packages:** `connectors` (first release), plus additions to `contracts`, `crypto`, `config`, `testing` · **Plus:** `provider_routing`, port contract tests in CI
**Date:** 2026-10-26 · **Branch:** `claude/funny-cori-6upyrr` (plan only)
**Read for this plan:** IPB-01 §01.3.C, §01.4.4 (0–3), §01.4.5, §01.5, §01.6, §01.8; IPB-02 §02.3.A, §02.3.C–D, §02.4.2–02.4.4, §02.4.6.1, §02.6.3, §02.8; IPB-10 §10.3.B–E, §10.4.5–10.4.7, §10.8; IPB-11 env variable names; IPB-14 §14.2–14.3; `docs/DECISIONS.md` (OWN-02, OWN-05, OWN-07, OWN-08, PL1-C-01, PL1-D-09).
**Owner approval:** approved 26 Oct 2026, with conditions. The conditions are listed in **section 15** and recorded as `[OWNER]` rows PL2-D-05 to PL2-D-19 and PL2-C-02 to PL2-C-04 in `docs/DECISIONS.md`. **Where a condition differs from an earlier section, the condition wins.** The main inline corrections are made in place.

**Revision 2 — changed sections:** 3.1 (a caller may only raise the data class) · 3.5 (pending-first idempotency with vendor lookup) · 3.11 (sandbox legs and the split gate) · 3.12 new (messaging recipients, tighten-only residency) · 4 and 5.1 (routing schema rules) · 5.2 and 6.7 (STORAGE writes fail fast) · 6.9 (Temporal Cloud only with a confirmed Mumbai namespace) · 6.10–6.12 (messaging residency) · 8 P-05, P-07 · 9 C-11 (`jose`) · 10 (new tests) · 11 (split exit gate) · 12 (deviations and change requests now recorded) · 13 (decisions recorded).

**Tier-0 vendor pairs** (owner decision of 26 Oct 2026, PL2-D-06): Keycloak + Zitadel, S3 + MinIO, Razorpay + Cashfree, SES + Brevo, Bedrock + Gemini Vertex, Leegality + Digio. The last two belong to ports outside IPB-14's PL2 list: LLM in PL4 and ESIGN in PL3 (D-09, IPB-DEV-07).

---

## 1. Scope and what PL2 is not

PL2 delivers, for each Tier-0 port named in IPB-14 §14.3, the port interface in `contracts`, a contract test suite in `testing`, the reference adapter and **one alternative kept green in CI** in `connectors`, the config keys in `config`, and the `provider_routing` loader and runtime that choose between adapters, enforce residency and data class, and fail over.

| #   | Port          | Reference adapter                           | Alternative kept green in CI                     | Source of the pair                      |
| --- | ------------- | ------------------------------------------- | ------------------------------------------------ | --------------------------------------- |
| 1   | SECRETS       | AWS Secrets Manager                         | HashiCorp Vault API (OpenBao, D-03)              | IPB-14 §14.3                            |
| 2   | KMS           | AWS KMS                                     | Vault Transit (OpenBao, D-03)                    | IPB-01 catalogue                        |
| 3   | OBSERVABILITY | OpenTelemetry SDK → OTel Collector          | OTLP exporter profile to a second backend (A-05) | IPB-01 catalogue                        |
| 4   | FEATURE_FLAG  | Unleash (self-hosted) via OpenFeature shape | Database provider in `@infrabyx/config` (PL1)    | IPB-01 catalogue                        |
| 5   | IDENTITY      | Keycloak 26.x                               | Zitadel                                          | Owner pair; IPB-01 catalogue            |
| 6   | AUTHZ         | Cerbos PDP                                  | OpenFGA (D-04)                                   | IPB-01 catalogue                        |
| 7   | STORAGE       | Amazon S3 (Object Lock, compliance)         | MinIO (Object Lock)                              | Owner pair; IPB-01 catalogue            |
| 8   | QUEUE         | BullMQ on Redis 7                           | pg-boss on PostgreSQL (D-05)                     | IPB-01 catalogue                        |
| 9   | WORKFLOW      | Temporal (self-hosted)                      | Temporal Cloud (OWN-05, D-06)                    | IPB-01 catalogue; OWN-05                |
| 10  | EMAIL         | Amazon SES (ap-south-1)                     | Brevo (D-08)                                     | Owner pair                              |
| 11  | SMS           | MSG91 (D-07)                                | Gupshup SMS (D-07)                               | OWN-07                                  |
| 12  | WHATSAPP      | Gupshup BSP (D-07)                          | Meta WhatsApp Cloud API                          | OWN-07, OWN-08                          |
| 13  | PAYMENTS      | Razorpay                                    | Cashfree                                         | Owner pair — **section 8, locked list** |

Out of PL2:

- The other IPB-01 ports (CACHE, SEARCH, VECTOR, PUSH, VOICE, PAYOUTS, ESIGN, ESTAMP, KYC, DOCGEN, PDF and the rest). Their names already exist in the PL1 catalogue; their interfaces arrive with the phase that needs them. LLM, EMBEDDING, IMAGE_GEN and SPEECH are PL4 (`ai`). ESIGN placement is decision D-09.
- The second IPB alternative for each port (IPB-01-15 asks for two; one may be an in-memory fake). PL2 counts the PL1 in-memory fakes in `@infrabyx/testing` as the second alternative where one exists (SECRETS, STORAGE, IDENTITY) and adds memory fakes for the other ports; real third adapters (Azure Blob, GCS, Azure Key Vault, Exotel, PayU and so on) come later.
- HTTP endpoints. `/health/ready`, webhook receivers and the connector marketplace UI live in apps (PL5–PL6). PL2 ships framework-agnostic functions plus thin NestJS adapters as optional subpath exports, as PL1 did (PL1-D-02, D-07).
- Production infrastructure (Terraform, Helm, Kyverno, multi-region keys, DR buckets). PL2 adapters support those settings; PL6 provisions them.
- Outbound webhooks to tenants (IPB-10 §10.4.5) and API keys (IPB-10-14/15): API work, PL6.

## 2. Package changes and dependency order

```
contracts   + port interfaces (AUTHZ, QUEUE, WORKFLOW, EMAIL, SMS, WHATSAPP, PAYMENTS, OBSERVABILITY; full IDENTITY),
              routing.ts (provider_routing Zod schema), connector manifest schema, PortCall, capability flags
crypto      + JWT/JWS verification, vendor HMAC verification, SNS signature verification, telemetry ID hashing (section 9)
config      + int.<port>.*, eng.flags.*, eng.otel.*, eng.logs.* keys; routing file loader (IPB-01-20)
testing     + packages/testing/ports/<port>.contract.ts suites, container helpers, vendor stubs, memory fakes,
              fault-injection proxy helper
connectors  (new) core: router, circuit breaker, health registry, HTTP client with egress allow-list,
              PortError mapping, span wrapper, idempotency store, inbound-webhook helpers;
              one folder per port, one sub-folder per adapter; migration connectors/0001_init.sql
```

`connectors` depends on `contracts`, `crypto`, `config`, `tenancy` (context, inbox, approvals check) and `audit` (ledger writes for state-changing admin calls). `testing` gains a dev-only dependency on `connectors` for the contract runners.

Releases at the exit gate: `connectors` **0.1.0** (flipped to `"private": false` in the same PR as its first changeset, PL1-D-20); `contracts`, `crypto`, `config`, `testing` **0.2.0** (all additions are additive; existing PL1 signatures stay valid). D-12.

## 3. Cross-cutting design (applies to every port)

### 3.1 Call context, data class and residency (IPB-01-16, IPB-02-25)

- Every method that sends data to a vendor takes an optional trailing `call: PortCall = { dataClass?, idempotencyKey?, tenantId? }`. `tenantId` defaults to the tenancy context.
- **The effective data class of a call is the highest of: the port default, `call.dataClass`, and the highest data-class annotation in the payload.** Port defaults: EMAIL, SMS, WHATSAPP, QUEUE, FEATURE_FLAG, OBSERVABILITY `INTERNAL`; PAYMENTS `REGULATED`; all other ports `CONFIDENTIAL`.
- A caller may **raise** the class with `call.dataClass`, never lower it. A `call.dataClass` below the port default throws `IPB-PORT-003` before any I/O.
- The only way below the port default is through the payload schema. Port payload schemas carry the same data-class annotations as columns (Zod field metadata, IPB-02-19). When every field is annotated and the highest annotation is below the port default, the router uses that maximum.
- The ESLint rule `ipb/port-data-class` (new, in `@infrabyx/testing/eslint`) enforces this. It fails a `PortCall` whose literal `dataClass` is below the port default, and a port payload schema with an unannotated field.
- Adapters are reached only through the router. Before any network I/O the router checks `call.dataClass ≤ adapter.maxDataClass` and `adapter.residency ∈ residency_policy[call.dataClass]`. A failure throws `IPB-PORT-003`, emits `ResidencyViolationBlocked.v1`, and makes no vendor request. There is never a fallback to a lower-residency adapter.
- The PL1 interfaces (`StoragePort`, `KmsPort`, `SecretsPort`, `FeatureFlagPort`, `IdentityProvisioning`) gain the same trailing argument. The change is additive.

### 3.2 Errors

Adapters throw `PortError` with codes from IPB-01 §01.6.3 (`IPB-PORT-*`, `IPB-STOR-*`, `IPB-IDN-*`, `IPB-AUTHZ-001`, `IPB-KMS-001`), IPB-02 §02.6.3 and IPB-10 §10.6.3. Vendor error objects never cross the port. Vendor HTTP status and vendor error code go into the span and the log (scrubbed), not into the error message. A missing code is not improvised. It goes to `docs/platform-requests.md` (section 12), and until the IPB editor answers, PL2 uses the nearest existing code.

### 3.3 Capability flags

Some IPB interface methods have no equivalent at some vendors: AWS Secrets Manager has no dynamic `lease`, Vault has no queryable access `audit`, and Brevo has no domain-verification API. Each adapter declares `capabilities: Record<method, 'native' | 'emulated' | 'unsupported'>` in its descriptor. The contract suite runs the native and emulated cases and asserts that unsupported methods throw a typed error. Change request PR-010 asks for a dedicated code (`IPB-PORT-006`, operation not supported by this adapter). Until then they throw `IPB-PORT-001` with `detail.reason = 'unsupported'`.

### 3.4 Observability on every call (IPB-01 §01.4.4.1)

Each routed call runs inside the span `port.<name>.<method>` with attributes `adapter`, `residency`, `data_class`, `outcome`, and `tenant_id` hashed per C-21. Duration and outcome feed `port_call_duration_ms` and `port_call_total`. Payloads, headers and vendor responses are never span attributes. The OBSERVABILITY port (section 6.3) is the only OTel import site.

### 3.5 Idempotency (IPB-01 §01.4.4.1, IPB-10-07, IPB-02-AT-05)

- Side-effect methods accept `idempotencyKey`. It is mandatory for money operations (P-05).
- Where the vendor has an idempotency header or field, the adapter maps the key to it: Cashfree `x-idempotency-key` and our own `order_id`/`refund_id`, Razorpay order `receipt`, SES/Brevo message tags, Temporal workflow ID, BullMQ job ID, pg-boss singleton key.
- **The record is written before the vendor call.** The router inserts `connectors.idempotency_record` with `status = 'pending'` and the request hash (C-20) in its own committed transaction, then calls the vendor. The unique key is `(tenant_id, port, key)`.
- After the call:
  - success sets `succeeded` and stores the result, encrypted with the PL1 field-encryption path when the class is CONFIDENTIAL or above;
  - a definite vendor rejection (a 4xx that means "not created") sets `failed`, and the same key may be used again;
  - an unknown outcome (timeout, connection reset, 5xx after the request was sent) **leaves the record `pending`**.
- A call with an existing key:
  - **different request hash** throws `IPB-PORT-004` (409);
  - **`succeeded`** returns the stored result without calling the vendor;
  - **`pending`** first runs the adapter's `lookup(operation, key)` at the vendor (Razorpay order by `receipt`, Cashfree order or refund by our ID, SES/Brevo by tag, Temporal by workflow ID, BullMQ by job ID):
    - found: record the result and return it;
    - authoritatively absent: call the vendor again;
    - inconclusive: `IPB-PORT-002`, and the record stays `pending`.
- **Money operations are never re-sent while pending unless the lookup authoritatively shows the operation does not exist.** A refund that the lookup cannot resolve goes to the human queue and is never retried automatically (P-07).
- Records expire after 24 h (IPB-10-07) and are purged (section 5.4). Pending money-operation records are not purged until resolved.

### 3.6 Health and circuit breaker (IPB-01-17, IPB-01-18)

- Each adapter implements `health()` as the catalogue describes.
- `HealthRegistry` probes every 30 s and caches results for 10 s. `aggregateHealth()` returns the `/health/ready` body:
  - A critical port down (IDENTITY, KMS, SECRETS, plus the database probe from `tenancy`) makes the service `down`.
  - Any other port down makes it `degraded` (IPB-01-AT-13).
- Each adapter gauge goes to OBSERVABILITY.
- The circuit breaker is written in `connectors` (about 150 lines, fake-clock tested), with no new dependency. Defaults come from `provider_routing`:
  - It opens after 5 consecutive failures, or at a 50 % error rate over 60 s.
  - It half-opens after 30 s and allows at most 3 trial calls.
  - Open emits `AdapterFailedOver.v1` when a secondary takes over. A successful half-open probe emits `AdapterRecovered.v1`.

### 3.7 Outbound HTTP and egress (IPB-02-43, §01.4.4.3 EGRESS)

- Adapters that call vendor REST APIs without an SDK use one shared client. It provides:
  - timeouts and retries from routing;
  - `Retry-After` handling;
  - an allow-list of hosts per adapter (for example `api.razorpay.com`, `sandbox.cashfree.com`, `api.brevo.com`, `control.msg91.com`);
  - HTTPS only, with system CAs and hostname verification;
  - redirects off;
  - response size caps.
- A host outside the list throws `IPB-SEC-018`.
- SDK-based adapters (AWS SDK v3, Temporal, BullMQ, Cerbos, OpenFGA, OTel) get their endpoints from routing config, never from request data.

### 3.8 Inbound webhooks (IPB-10-27, IPB-02-AT-05 scenario 2)

- Each webhook-receiving adapter exports `verifyWebhook(rawBody, headers) → VerifiedEvent | never`. It checks the vendor signature through `@infrabyx/crypto` (C-13) and the timestamp window where the vendor sends one, and it normalises the vendor event.
- The calling module stores the event in its PL1 inbox, keyed by vendor event ID, then processes it through QUEUE.
- The NestJS helper:
  - answers 401 for unverified payloads and logs them without the body;
  - answers 2xx within 2 s after the inbox insert;
  - acknowledges duplicates with 200 without processing them again.

### 3.9 Secrets and configuration (IPB-01-19, IPB-02-28, IPB-11)

- Adapters read behaviour from `int.<port>.*` keys and credentials from SECRETS paths `secrets/<env>/<port>/<adapter>/<key>` (IPB-02 §02.4.4). They never read `process.env`.
- In `local` and in CI test runs, `@infrabyx/config` resolves the IPB-11 variable names (`STORAGE_ACCESS_KEY_ID`, `PAYMENTS_RAZORPAY_KEY_ID`, …) and `secret://` references, as PL1 built.
- The SECRETS adapter itself bootstraps from workload identity: IRSA for AWS, the Kubernetes auth role (`SECRETS_VAULT_ROLE`) for Vault. It is the only adapter that needs no stored credential.
- Each port section names the secrets it needs. **No value appears in this plan, the repository or CI logs.**

### 3.10 Vendor SDK confinement and package size (IPB-01-14)

Vendor SDKs are dependencies of `connectors` only (`vendor-import` lint and `ipb:check` already enforce this). Each port is a subpath export (`@infrabyx/connectors/storage`, `…/payments`, …), and each adapter is loaded by dynamic `import()` only when routing selects it. A product that never routes to Temporal never loads the Temporal native module. Exact SDK versions are pinned and recorded in the changeset.

### 3.11 Test strategy (IPB-01-15, IPB-10 §10.4.7)

Every port has one contract suite in `packages/testing/ports/<port>.contract.ts`. The suite runs on three legs:

| Leg                           | When                                                                                          | Target                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **unit**                      | every PR                                                                                      | memory fake; router, breaker, residency and idempotency logic with fake clocks                                                                                                                                                                                                                                                                 |
| **hermetic** (Testcontainers) | every PR that touches `contracts`, `crypto`, `config`, `testing` or `connectors`, and nightly | a real self-hostable engine in a container (Keycloak, Zitadel, Cerbos, OpenFGA, MinIO, Redis, PostgreSQL, Temporal dev server, OpenBao, Unleash, OTel Collector, moto for AWS APIs, LocalStack where moto lacks an API) or, for SaaS-only vendors, a **vendor stub** built from the vendor's API documentation and replayed sandbox recordings |
| **sandbox**                   | nightly, on `workflow_dispatch`, and on same-repository PRs that touch that adapter's folder  | the vendor's real test environment: AWS sandbox account (from the first staging deployment, D-01), Razorpay test mode, Cashfree sandbox, Brevo sandbox header, MSG91 and Gupshup test credentials, Meta test number, Temporal Cloud namespace                                                                                                  |

The "kept green" claim for a SaaS adapter rests on the **sandbox** leg, because a stub proves only adapter logic. A red or missing sandbox leg opens an issue labelled `port-contract`. Section 11 says how these issues relate to the exit gate and to staging use. Container images are pinned by digest in `infra/docker/TEST_IMAGES.md`. Docker Official Images are pulled from `public.ecr.aws/docker/library/*` to avoid the Docker Hub rate limit that hit PL1 (PL1-D-16).

### 3.12 Messaging recipients and tighten-only residency (owner decision 26 Oct 2026; IPB-DEV-05, PR-013)

- IPB-02 §02.4.3.1 classes contact details as CONFIDENTIAL (`IN`/`IN-ZR` only). EMAIL, SMS and WHATSAPP default to INTERNAL, and Brevo, Meta and Gupshup WhatsApp are `GLOBAL`.
- **Owner decision:** a recipient's email address or phone number may go to a `GLOBAL` provider **for delivery only, under a DPA**. Message bodies stay INTERNAL, and CONFIDENTIAL content goes only as a secure link.
- **Mechanics:**
  - Messaging payload schemas annotate recipient fields as `CONFIDENTIAL` with role `delivery_recipient`.
  - The router checks the body (every other field) against the adapter as usual.
  - It checks the recipient fields against the routing file's `recipient_delivery` policy:
    - always allowed on an `IN` adapter;
    - allowed on a `GLOBAL` adapter only when the adapter instance declares `dpa_ref` (the Vendor Assurance Room document holding the DPA, IPB-08) **and** `recipient_delivery.allow_global` is true.
  - Otherwise the call is refused with `IPB-PORT-003`. Recipient values never appear in spans or logs; they are hashed (C-21).
- **Product routing files may tighten, never loosen.** A product file's `residency_policy` must be a per-class subset of the platform defaults (IPB-01 §01.4.5), and per-port `residency_policy` overrides may only narrow further. `recipient_delivery.allow_global: false` is allowed; anything looser is rejected at load with `IPB-PORT-005`.
- **Example:** the owner cites Udofin, which allows GLOBAL only for PUSH and public analytics. For Udofin, EMAIL routes to SES only and SMS to the `IN` SMS adapters. WhatsApp has no `IN` adapter, so it stays unavailable for Udofin until one exists.

## 4. `@infrabyx/contracts` additions

- Port interfaces for AUTHZ, QUEUE, WORKFLOW, EMAIL, SMS, WHATSAPP, PAYMENTS and OBSERVABILITY, plus the full IDENTITY interface. Each port has Zod schemas for inputs and outputs and no vendor types; method lists are in section 6.
- `routing.ts`: the `provider_routing` schema exactly as IPB-01 §01.4.5. Load-time rules:
  - every port a loaded module lists has a `primary`;
  - a secondary must satisfy `residency_policy` up to the primary's `max_data_class`, unless `mode: none` (`IPB-PORT-005`);
  - `secrets` values must be SECRETS paths, never literals;
  - `mode` ∈ `read_only_failover | active_failover | none`;
  - PAYMENTS has an optional `failover_rule`;
  - a product file may only tighten `residency_policy`, globally or per port (3.12);
  - `recipient_delivery.allow_global` (default true) and a per-adapter `dpa_ref`, required for any `GLOBAL` adapter that receives recipient fields;
  - a routing file for `staging`, `pre-prod`, `prod` or `dr` may not name an adapter marked `unproven` in `packages/connectors/sandbox-status.json` (section 11, gate B).
- `connector-manifest.ts`: the IPB-10 §10.4.6.1 manifest schema, so `@IPB-10-29` manifest lint can run on the four tenant-installable PL2 adapters (Razorpay, Cashfree, Gupshup, Meta WhatsApp).
- `PortCall`, the capability flags, and the `AdapterFailedOver` / `AdapterRecovered` / `ResidencyViolationBlocked` / `RoutingConfigChanged` payload schemas (IPB-01 §01.6.1).
- The catalogue entries for the 13 ports switch to `interfaceDefined: true`.

## 5. `provider_routing`, `config`, `connectors` core

### 5.1 Files and loading (IPB-01-20)

- `infra/routing/reference/{local,ci,dev}.routing.yaml` are the reference app's files: containers for `local` and `ci`; Supabase database, Temporal Cloud (Mumbai) and vendor sandboxes for `dev` (OWN-05, PL2-D-16). Production files are PL6.
- `@infrabyx/config` loads the file named by `int.routing.file`, validates it with the `contracts` schema, resolves SECRETS references lazily on first use, and refuses boot with `IPB-PORT-005` on any error. `infrabyx-routing check <file>` runs the same validation in CI.
- A deliberately broken fixture proves the refusal (`@IPB-01-AT-07`, `@IPB-01-20`).

### 5.2 Runtime (IPB-01-16/18)

`createRouter(routing, registry)` builds adapters from the adapter factory registry and returns typed port facades. For each call the router:

1. applies the data-class and residency check (3.1);
2. applies idempotency (3.5);
3. runs the call in its span (3.4);
4. calls the primary through its breaker (3.6).

The failover mode decides what happens when the primary's breaker is open:

| Mode                 | Behaviour                                                                                                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read_only_failover` | Reads go to the secondary. Writes fail fast: `IPB-PORT-002`, or `IPB-STOR-002` for STORAGE, and the caller's outbox or upload session retries. File bytes never go into QUEUE |
| `active_failover`    | New operations go to the secondary when its residency satisfies the call's data class; otherwise `IPB-PORT-002`                                                               |
| `none`               | `IPB-PORT-002`                                                                                                                                                                |

IPB-01 §01.4.4.2 fixes a mode for each port (section 6).

### 5.3 Change control

Routing files are code: a PR, CI validation and `RoutingConfigChanged.v1` at deploy. Changing a production `primary` for STORAGE, KMS, IDENTITY or PAYMENTS is "normal + CAB" (IPB-01 §01.4.5). PL2 records the rule and the event; the deploy gate is PL6.

### 5.4 Data model (schema `connectors`, migration `connectors/0001_init.sql`)

| Table                | Columns (data class)                                                                                                                                                                                             | Notes                                                                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `idempotency_record` | `tenant_id`, `legal_entity_id` (INTERNAL), `port`, `adapter`, `key` (INTERNAL), `request_hash` (INTERNAL), `status`, `result_enc`, `result_key_id`, `result_alg` (class of the call), `created_at`, `expires_at` | RLS enabled and forced; unique `(tenant_id, port, key)`; purge after `expires_at` + 1 h, ledgered as a single system purge entry per run       |
| `adapter_state`      | `port`, `adapter`, `breaker_state`, `opened_at`, `last_health` (INTERNAL)                                                                                                                                        | Platform table without tenant rows (PL1 platform-table convention); lets several replicas share breaker state; optional (in-memory by default) |

The 24 h retention is IPB-10-07's figure, not a new retention choice. The purge job is listed here because data deletion is on the locked list. Approving this plan approves that job.

## 6. Ports (one subsection each)

Each subsection gives: interface · reference · alternative kept green · residency class (per adapter instance) · failover · contract tests · test targets · secrets (named) · config keys · routing entry.

### 6.1 SECRETS

- **Interface (PL1, extended):** `get(path, version?)`, `put(path, value, meta)`, `rotate(path, rotator)`, `list(prefix)`, `lease(path, ttl)`, `audit(path)`, `health()`. Metadata `owner`, `rotation_days`, `last_rotated`, `data_class` (IPB-02-32).
- **Reference `aws-sm`:** AWS Secrets Manager ap-south-1, encrypted with the platform CMK (C-18), not the AWS-managed default key. `lease` is emulated: it returns the current version with `expiresAt` = cache TTL. `audit` reads CloudTrail `LookupEvents` for the secret ARN.
- **Alternative `vault`:** Vault/OpenBao KV v2. `lease` is native through the database secrets engine for dynamic PostgreSQL credentials. `audit` is unsupported (Vault audit devices are not queryable); capability flag.
- **Residency:** both `IN`, `maxDataClass: SECRET`.
- **Failover:** `none`. Values are cached in memory for 15 min (`int.secrets.cache_seconds`). After cache expiry a fetch failure marks the pod not-ready, and a value older than 24 h is never served (IPB-01 catalogue).
- **Contract tests:** put/get/version pinning, list by prefix, rotate with overlap, metadata round-trip, cache-expiry not-ready, no secret in span, log or error (scrubber assertion); `@IPB-01-AT-19` re-run with `connectors` in scope.
- **Targets:** hermetic: moto (Secrets Manager) and the OpenBao container in dev mode. Sandbox: AWS sandbox account through GitHub OIDC, from the first staging deployment (D-01); a `port-contract` issue until then.
- **Secrets needed:** none stored. AWS access uses the GitHub OIDC role (variable `SANDBOX_AWS_ROLE_ARN`, not a secret). Vault in CI uses a throwaway root token generated by the container at start.
- **Config:** `int.secrets.provider`, `int.secrets.path_prefix`, `int.secrets.cache_seconds`; env `SECRETS_ADAPTER`, `SECRETS_AWS_REGION`, `SECRETS_VAULT_ADDR`, `SECRETS_VAULT_ROLE`, `SECRETS_CACHE_TTL_S`.
- **Routing:** `SECRETS: { primary: { adapter: aws-sm, residency: IN, max_data_class: SECRET }, secondary: { adapter: vault, mode: none } }`.

### 6.2 KMS

- **Interface (PL1):** `encrypt`, `decrypt`, `generateDataKey`, `sign`, `verify`, `getPublicKey`, `createTenantKey`, `scheduleKeyDeletion`, `listAlgorithms`, `health()`. `sign`/`verify` take the message (PL1-D-09).
- **Reference `aws-kms`:** AWS KMS ap-south-1. Key specs and the tenant-key policy are in section 9 (C-14, C-15). Multi-region replica keys to ap-south-2 are a routing option that PL6 provisions.
- **Alternative `vault-transit`:** Vault/OpenBao Transit engine.
- **Residency:** both `IN`, `SECRET`.
- **Failover:** `none`. A KMS outage fails decryption of REGULATED fields closed with `IPB-KMS-001`. There is no plaintext fallback. Data keys are cached for at most 5 min (PL1 C-04).
- **Contract tests:**
  - encrypt/decrypt with AAD (a wrong AAD fails);
  - data key round-trip through PL1 field encryption;
  - sign/verify with ECDSA P-256 against the public key alone;
  - tenant key creation;
  - `scheduleKeyDeletion(<30)` refused;
  - algorithm list;
  - PL1 anchor signing (`@IPB-02-AT-15` chain/anchor verify) re-run against both adapters.
- **Targets:** hermetic: moto (KMS; ECC signing support **[VERIFY at implementation]**, with LocalStack as fallback) and OpenBao Transit. Sandbox: AWS sandbox account, from the first staging deployment (D-01).
- **Secrets needed:** none stored (OIDC; container token).
- **Config:** `int.kms.platform_key_id`, `int.kms.tenant_key_policy`, `int.kms.data_key_cache_seconds`, `int.kms.algorithms_allowed`; env `STORAGE_KMS_KEY_REF` where S3 uses it.
- **Routing:** `KMS: { primary: { adapter: aws-kms, residency: IN, max_data_class: SECRET }, secondary: { adapter: vault-transit, mode: none } }`.

### 6.3 OBSERVABILITY

- **Interface:** `startSpan(name, attrs)`, `recordMetric(name, value, attrs)`, `log(level, msg, ctx)`, `aiTrace(op, attrs)` (OTel GenAI semantic conventions; content capture off, `eng.otel.genai.capture_content=false`), `exportConfig()`, `health()`.
- **Reference `otel`:** OpenTelemetry Node SDK → OTLP → in-cluster Collector → Grafana stack (Tempo, Loki, Mimir). The adapter applies the PL1 mask rules and the IPB-02-23 scrubber before export. IDs are hashed (C-21).
- **Alternative (A-05):** OTel is vendor-neutral, so every IPB alternative (CloudWatch/X-Ray, Elastic, Datadog, Dynatrace) is a _backend_ behind OTLP, not a second SDK. The alternative kept green is a second **exporter profile** of the same adapter: direct OTLP/HTTP with auth headers to a vendor intake. The contract suite runs both profiles against a Collector with two receivers and asserts identical spans, metrics and logs and an empty scrubber diff. Change request PR-011 asks the IPB editor to confirm this reading of IPB-01-15 for this port.
- **Residency:** `IN`, `maxDataClass: INTERNAL` (scrubbed); logs stay in India (`eng.logs.region=IN`, locked).
- **Failover:** the Collector buffers to disk (2 GB) and drops metrics before logs; the audit ledger never depends on this port.
- **Contract tests:** span names and attributes per 3.4; GenAI attributes; a REGULATED value placed in a log context is masked; hashed tenant ID; exporter outage does not block the caller.
- **Targets:** hermetic: `otel/opentelemetry-collector-contrib` with a file exporter. There is no sandbox leg.
- **Secrets needed:** `OBS_OTLP_HEADERS_REF` (vendor intake key; only when a vendor backend is chosen, none in PL2 CI) and `OBS_AUDIT_HASH_CHAIN_KEY_REF` (PL1 HMAC key, reused for ID hashing per PL1 C-02).
- **Config:** `eng.otel.endpoint`, `eng.otel.sampling_ratio`, `eng.otel.genai.capture_content`, `eng.logs.retention_days` (180, locked), `eng.logs.region` (locked); env `OBS_OTLP_ENDPOINT`, `OBS_OTLP_INSECURE` (local only), `OBS_TRACE_SAMPLE_RATIO`, `OBS_SERVICE_NAMESPACE`, `OBS_LOG_LEVEL`, `OBS_LOG_FORMAT`.

### 6.4 FEATURE_FLAG

- **Interface (PL1):** OpenFeature evaluation methods plus `snapshot()`; management `createFlag`, `setTargeting`, `kill`, `listFlags`, `flagDebt` (IPB-01). Writes stay governed by PL1-D-11: `kill.*` ledgered by PLT_RELEASE_MANAGER/PLT_SECURITY_OFFICER, and `fut.*` through R3 maker-checker.
- **Reference `unleash`:** self-hosted Unleash OSS. The flag registry (`kill.*`, `fut.*` with owner and expiry) is synced to Unleash through the admin API. Evaluation contexts carry hashed tenant and user IDs only (C-21).
- **Alternative `config-db`:** the PL1 PostgreSQL provider (listed in the IPB catalogue as "database-backed provider in `packages/config`").
- **Residency:** both `IN`, `INTERNAL`.
- **Failover:** last-known snapshot (≤ 24 h), then registry defaults; an unknown `kill.*` evaluates **on** (PL1 evaluator, re-used).
- **Contract tests:** typed evaluation, targeting by hashed tenant, snapshot fallback, registry sync idempotent, `@IPB-02-AT-20` (provider down with stale snapshot gives `kill.payments` on) re-run against Unleash.
- **Targets:** hermetic: `unleashorg/unleash-server` plus PostgreSQL. There is no sandbox leg.
- **Secrets needed:** `FLAGS_UNLEASH_API_TOKEN_REF` (client token) and `secrets/<env>/feature_flag/unleash/admin_token` (registry sync only). In CI both are generated at container start.
- **Config:** `eng.flags.provider`, `eng.flags.url`, `eng.flags.snapshot_ttl_hours`; env `FLAGS_ADAPTER`, `FLAGS_UNLEASH_URL`, `FLAGS_FILE_PATH` (flagd later).

### 6.5 IDENTITY

- **Interface:** `authenticate(assertion)`, `getUser(id)`, `provisionUser(spec)`, `linkFederation(userId, idp)`, `issueToken(claims, ttl)` (client-credentials and RFC 8693 token exchange for the impersonation `act` claim), `verifyToken(jwt) → VerifiedClaims` (PL1 schema), `scimSync(ops)`, and two additions, `handleLogoutToken(jwt)` and `revokeSessions(userId)`, so de-provisioned sessions die within 60 s (IPB-02-05; PR-012). `health()`.
- **Reference `keycloak`:** Keycloak 26.x. The realm is configuration as code in `infra/identity/keycloak/realm-<product>.json`:
  - passkeys first (WebAuthn passwordless policy, conditional UI);
  - TOTP and hardware keys, with SMS OTP never an MFA factor;
  - a conditional MFA flow that forces enrolment for `PLT_*`, `OPS_*`, `ORG_OWNER`, `ORG_ADMIN`, `ORG_CHECKER` (IPB-02-02);
  - session idle 30/15 min and absolute 12/8 h (IPB-02-03);
  - refresh-token rotation;
  - back-channel logout to the API;
  - token signing per C-12.

  `scimSync` maps SCIM 2.0 operations to the Keycloak Admin API; no SCIM plugin is needed.

- **Alternative `zitadel`:** Zitadel, self-hosted on PostgreSQL. The same settings go through its management API: login policy, MFA policy, session lifetimes. Native SCIM 2.0 and token exchange are **[VERIFY at implementation]**.
- **Residency:** both `IN`, `maxDataClass: CONFIDENTIAL` (identity data). Production Keycloak runs in ap-south-1 on the platform PostgreSQL.
- **Failover:** `none` (no cross-vendor failover). `verifyToken` uses cached JWKS for 24 h, so API calls survive an IdP outage. New logins fail with `IPB-IDN-002`.
- **Contract tests:**
  - token verification: algorithm allow-list, `kid`, `iss`/`aud`/`exp`/`nbf`, skew;
  - JWKS cache across an IdP outage;
  - unknown `kid` refresh, rate-limited;
  - `IPB-IDN-001` on bad tokens;
  - provision → login with password → forced password change and MFA enrolment, which the PL1 seed credentials need (IPB-02-31);
  - SCIM create/update/deactivate, with old tokens refused within 60 s (`@IPB-02-05`);
  - token exchange carries `act`, and the PL1 kernel refuses a mutation with `IPB-SEC-003`;
  - realm settings read back equal to the IPB values;
  - a token for an MFA-required role without `amr` MFA is refused with `IPB-SEC-001` at the API guard helper (`@IPB-02-AT-02`, API half; the browser half is PL5).
- **Targets:** hermetic: `quay.io/keycloak/keycloak:26.x` and Zitadel with a PostgreSQL database in the same service container. There is no sandbox leg (both self-hosted).
- **Secrets needed:** `AUTH_CLIENT_SECRET` → `secrets/<env>/identity/<adapter>/client_secret`; `AUTH_ADMIN_CLIENT_SECRET` → `…/admin_client_secret`; `AUTH_SESSION_SECRET` → `…/session_secret`; `AUTH_SCIM_BEARER_REF` → `…/scim_bearer`. In CI all are generated at container start.
- **Config:** `int.identity.issuer_url`, `int.identity.realm`, `int.identity.jwks_cache_seconds`, `int.identity.passkeys.enabled`, `int.identity.scim.enabled`, `int.identity.session.idle_minutes`; env `AUTH_ADAPTER`, `AUTH_ISSUER_URL`, `AUTH_CLIENT_ID`, `AUTH_ADMIN_CLIENT_ID`, `AUTH_JWKS_CACHE_S`, `AUTH_PASSKEYS_RP_ID`, `AUTH_PASSKEYS_ORIGINS`, `AUTH_MFA_REQUIRED_ROLES`, `AUTH_SESSION_TTL_MIN`.
- **Routing:** `IDENTITY: { primary: { adapter: keycloak, residency: IN, max_data_class: CONFIDENTIAL }, secondary: { adapter: zitadel, mode: none } }`.

### 6.6 AUTHZ

- **Interface:** `check(principal, resource, action, ctx)`, `checkBatch`, `planResources(principal, action)` (list filtering), `loadPolicies(bundle)`, `explain(decision)`, `health()`.
- **Reference `cerbos`:** a Cerbos PDP sidecar. Policies live in `infra/policy/cerbos/` and PL2 writes the platform base:
  - the role floor (PL1-D-05);
  - ABAC on `tenant_id`, `entity_id`, `product_scope`, `data_class`, `maker_id`;
  - a derived role that **denies `approve`, `sign`, `disburse`, `delete`, `grant` to every `AGT_*` principal** (IPB-02-10);
  - `product_scope` bounds for Hub staff (IPB-02-11).

  Cerbos policy tests run in CI (`cerbos compile` and `cerbos test`).

- **Alternative `openfga` (D-04):** OpenFGA, self-hosted. The same model is expressed as an FGA model with CEL conditions. `planResources` maps to `ListObjects`.
- **Residency:** both `IN`, `CONFIDENTIAL`.
- **Failover:** `none`. If the PDP is unavailable the result is **deny** with `IPB-AUTHZ-001`, never allow. Allow decisions are cached for at most 5 s.
- **Contract tests:** one decision table (principal × resource × action → allow/deny), run unchanged against both adapters (parity); agent denials (`@IPB-02-AT-11`, Cerbos policy leg, alongside the PL1 kernel leg); product-scope denial with no disclosure (`IPB-SEC-005` semantics); PDP down gives deny; cache expiry.
- **Targets:** hermetic: `ghcr.io/cerbos/cerbos` and `openfga/openfga` (memory store). There is no sandbox leg.
- **Secrets needed:** none in PL2 (in-cluster, mTLS later); OpenFGA preshared key `secrets/<env>/authz/openfga/preshared_key` when enabled.
- **Config:** `int.authz.pdp_url`, `int.authz.bundle_version`, `int.authz.decision_cache_seconds`.

### 6.7 STORAGE

- **Interface (PL1):** `put`, `putWithRetention`, `get`, `presign`, `delete` (soft: tombstone and lifecycle), `list`, `assertImmutable`, `replicateTo`, `health()`. Keys are tenant-prefixed (PL1 `storageKey`).
- **Reference `s3`:** Amazon S3 ap-south-1. The buckets per class (`int.storage.bucket.<class>`) use:
  - Object Lock in **compliance** mode (PL1-D-06: compliance mode wins);
  - versioning;
  - SSE-KMS (C-17);
  - replication to ap-south-2 (checked, not created; PL6 creates it).

  Presigned URLs are bound to method and content type with TTL ≤ 300 s (IPB-02-15).

- **Alternative `minio`:** MinIO with Object Lock and versioning; same code base with path-style addressing and MinIO-specific health. The image source is D-02.
- **Residency:** both `IN`, `maxDataClass: SECRET`. REGULATED and SECRET classes require `assertImmutable`.
- **Failover:** `read_only_failover`: reads move to the DR replica after 3 failures. **Writes fail fast with `IPB-STOR-002`** and the caller's outbox or resumable upload session retries. File bytes are never put in QUEUE, which carries INTERNAL IDs only. This replaces the IPB-01 catalogue's "writes queue in QUEUE for up to 15 minutes" (IPB-DEV-06, PR-014). Writes never fail over across clouds (Object Lock continuity).
- **Contract tests:**
  - put/get/list/presign (expiry, wrong method, wrong content type);
  - soft delete;
  - `putWithRetention` then delete or overwrite gives `IPB-STOR-003` (`@IPB-01-AT-09`);
  - an AUDIT-class anchor file survives a break-glass delete attempt (`@IPB-02-AT-13`);
  - parity between s3 and minio (`@IPB-01-AT-10` for `s3` and `minio`; `azure-blob` and `gcs` rows wait for those adapters);
  - `replicateTo` with SHA-256 manifest verification;
  - cross-tenant key refused.
- **Targets:** hermetic: MinIO container for both adapters (S3 API), plus moto S3 for the AWS-only calls (replication and lock configuration reads). Sandbox: AWS sandbox bucket with Object Lock and 1-day retention, from the first staging deployment (D-01); a `port-contract` issue until then.
- **Secrets needed:** production uses none (IRSA). Local and CI use `STORAGE_ACCESS_KEY_ID` and `STORAGE_SECRET_ACCESS_KEY` for MinIO only, generated at container start.
- **Config:** `int.storage.bucket.<class>`, `int.storage.region`, `int.storage.presign_ttl_seconds`, `int.storage.retention.<class>_days`, `int.storage.replication.target`; env `STORAGE_ADAPTER`, `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_BUCKET_*`, `STORAGE_OBJECT_LOCK_MODE`, `STORAGE_PRESIGN_TTL_S`, `STORAGE_KMS_KEY_REF`.
- **Routing:** `STORAGE: { primary: { adapter: s3, IN, SECRET }, secondary: { adapter: s3 (ap-south-2) or minio, mode: read_only_failover } }`.

### 6.8 QUEUE

- **Interface:** `enqueue(queue, job, {delay, priority, idempotencyKey})`, `schedule(cron, job)`, `consume(queue, handler, concurrency)`, `moveToDLQ(job, reason)`, `replay(dlq, filter)`, `stats(queue)`, `health()`. Payloads carry IDs and INTERNAL data only; the router refuses anything above INTERNAL.
- **Reference `bullmq`:** BullMQ on Redis 7 (production ElastiCache with TLS; Valkey compatibility **[VERIFY]**).
- **Alternative `pg-boss` (D-05):** pg-boss on the platform PostgreSQL. Its DDL is generated once from pg-boss's construction plan into `connectors` migration `0002_pgboss.sql`, with data-class comments added for migration-lint. At runtime it starts with `migrate: false`, because application roles have no DDL rights (PL1 kernel).
- **Residency:** both `IN`, `INTERNAL`.
- **Failover:** an enqueue failure writes to the module outbox (PL1) and the dispatcher retries. Consumers are idempotent. Switching adapters drains the old queue first (runbook).
- **Contract tests:** enqueue/consume, delay, priority, idempotent enqueue, retry with exponential backoff (`int.queue.default_attempts` 5, `exponential:2000`), DLQ after attempts, replay from DLQ, cron schedule, stats, canary round-trip ≤ 5 s, a payload above INTERNAL refused.
- **Targets:** hermetic: `public.ecr.aws/docker/library/redis:7` and the CI PostgreSQL. There is no sandbox leg.
- **Secrets needed:** `QUEUE_REDIS_URL` carries no password locally. Production uses `secrets/<env>/queue/bullmq/auth_token` (ElastiCache AUTH).
- **Config:** `int.queue.url`, `int.queue.default_attempts`, `int.queue.backoff`, `int.queue.dlq_retention_days`; env `QUEUE_REDIS_URL`, `QUEUE_CONCURRENCY`.

### 6.9 WORKFLOW

- **Interface:** `startWorkflow(type, input, {id, taskQueue})`, `signal(id, name, payload)`, `query(id, name)`, `cancel(id, reason)`, `listOpen(filter)`, `describe(id)`, `health()`. Inputs over 32 KB are stored in STORAGE and passed by reference. Worker registration helpers support Worker Versioning. Maker-checker workflows themselves are PL3.
- **Reference `temporal`:** Temporal self-hosted (TypeScript SDK).
- **Alternative `temporal-cloud` (D-06, PL2-D-16):** the same SDK with API-key auth (or mTLS) to a pay-as-you-go namespace in AWS ap-south-1 (Mumbai), which the owner creates (`docs/runbooks/temporal-cloud.md`). Recorded as `IN` from the start. Region evidence goes to the Vendor Assurance Room.
- **Residency:** `temporal` is `IN`, `CONFIDENTIAL`. `temporal-cloud` (Mumbai, ap-south-1) is `IN` from the start (PL2-D-16), with `maxDataClass: INTERNAL` until PL6.
- **Do codec-encrypted payloads count as INTERNAL? No.** A class follows the content, not its protection; IPB-02 §02.4.3.1 assigns classes by what the data is. The codec also does not cover everything Temporal stores: workflow IDs, workflow and signal names, search attributes, and (unless enabled) failure messages and stack traces stay readable.
- Workflows whose inputs are CONFIDENTIAL therefore run on self-hosted Temporal, or pass STORAGE references only, which are INTERNAL (as Udofin's UDF-D-07). The router enforces this from each workflow type's declared input class. The codec (C-16) stays on as defence in depth.
- **Failover:** `none` (no live cross-engine failover). An outage pauses timers, and a catch-up job reconciles overdue timers.
- **Contract tests:** start/signal/query/cancel/describe, deterministic replay of a sample workflow, ID reuse is idempotent, the 32 KB reference path, codec round-trip (payload unreadable without the key), listOpen.
- **Targets:** hermetic: the Temporal CLI dev server image, pinned; the `temporal-cloud` connection path (mTLS and API key) runs against a Temporal server container with TLS on. Sandbox: the Mumbai namespace once confirmed; a `port-contract` issue until then.
- **Secrets needed:** `WORKFLOW_TEMPORAL_TLS_CERT_REF`, `WORKFLOW_TEMPORAL_TLS_KEY_REF` (mTLS) or `secrets/<env>/workflow/temporal-cloud/api_key`; CI `SANDBOX_TEMPORAL_CLOUD_API_KEY`; variables `SANDBOX_TEMPORAL_CLOUD_NAMESPACE` and `…_ADDRESS`.
- **Config:** `int.workflow.address`, `int.workflow.namespace`, `int.workflow.task_queue_prefix`, `int.workflow.history_ttl_days`; env `WORKFLOW_TEMPORAL_ADDRESS`, `WORKFLOW_TEMPORAL_NAMESPACE`, `WORKFLOW_TASK_QUEUE`.

### 6.10 EMAIL

- **Interface:** `send({to, template, vars, attachments, tags, idempotencyKey})`, `sendRaw(mime)`, `getStatus(messageId)`, `verifyWebhook` and `handleWebhook(payload)` (bounces, complaints, deliveries), `verifyDomain(domain)`, `suppress(address, reason)`, `health()`. CONFIDENTIAL content goes as a secure link, never inline.
- **Reference `ses`:** Amazon SES v2 ap-south-1 with configuration sets per brand and DKIM/DMARC per `brand_pack.email_domain`. Events arrive through SNS (signature per C-13).
- **Alternative `brevo` (D-08):** Brevo transactional API. Webhooks have no vendor signature, so they are authenticated by a per-endpoint bearer secret in the URL credentials plus a source-IP allow-list. `verifyDomain` is emulated (it reads status and lists the DNS records the owner must add).
- **Residency:** `ses` is `IN` and `brevo` is `GLOBAL` (EU processing). Both have `maxDataClass: INTERNAL` for bodies. Recipient addresses may go to Brevo for delivery only, under its DPA (`dpa_ref`, 3.12). CONFIDENTIAL content goes only as a secure link.
- **Failover:** `active_failover` on primary 5xx or a reputation block, **only for brands whose DKIM is already provisioned on Brevo**. Otherwise the message is queued and an alert raised.
- **Contract tests:** send with template and tags, idempotent send, status, bounce becomes a suppression, complaint becomes a suppression, attachment size cap, a CONFIDENTIAL inline body is refused, webhook signature and replay (`@IPB-02-AT-05` scenario 2), failover only with DKIM present.
- **Targets:** hermetic: moto (SES v2 **[VERIFY coverage]**) and a Brevo stub. Sandbox: SES in sandbox mode to the SES mailbox simulator addresses; Brevo with the `X-Sib-Sandbox: drop` header (validated, never sent).
- **Secrets needed:** `secrets/<env>/email/brevo/api_key` (CI `SANDBOX_BREVO_API_KEY`); `secrets/<env>/email/brevo/webhook_bearer`; `MSG_EMAIL_DKIM_KEY_REF` when DKIM keys are self-managed; SES uses IRSA, or OIDC in CI.
- **Config:** `int.email.provider`, `int.email.from.<brand>`, `int.email.reply_to`, `int.email.dkim_selector`, `int.email.bounce_webhook_path`, `int.email.brand_domain` (PL1); env `MSG_EMAIL_ADAPTER`, `MSG_EMAIL_FROM`; local `MSG_SMTP_*` to Mailpit (IPB-11-12).

### 6.11 SMS

- **Interface:** `send(to, templateId, vars, {senderId, dltEntityId, idempotencyKey})`, `getStatus(id)`, `registerTemplate(dlt)`, `verifyWebhook` and `handleWebhook()` (delivery reports), `health()`. Indian traffic uses DLT-registered templates and headers only. SMS OTP is never an MFA factor for admin roles (IPB-02-02).
- **Reference `msg91` (OWN-07, D-07):** MSG91 Flow/SMS API with DLT template mapping.
- **Alternative `gupshup-sms` (OWN-07, D-07):** Gupshup Enterprise SMS with the same DLT template mapping.
- **Residency:** both `IN` **[VERIFY processing location in vendor DPA]**, `maxDataClass: INTERNAL` for bodies (OTP, references; never REGULATED). Recipient numbers follow 3.12.
- **Failover:** `active_failover` on provider error or delivery report timeout > 60 s, to the secondary with the same DLT mapping.
- **Contract tests:** template send, an unregistered template is refused before sending, a non-DLT header is refused, idempotent send, delivery report webhook verified and de-duplicated, status, balance health, failover on simulated timeout.
- **Targets:** hermetic: MSG91 and Gupshup stubs. Sandbox: read-only calls (balance, template list, status) nightly; one real send per week to the owner's test number, **only after DLT registration** (D-07; costs paise).
- **Secrets needed:** `MSG_SMS_API_KEY` → `secrets/<env>/sms/msg91/auth_key` (CI `SANDBOX_MSG91_AUTH_KEY`); `secrets/<env>/sms/gupshup-sms/{user_id,password}` (CI `SANDBOX_GUPSHUP_SMS_USER_ID`, `SANDBOX_GUPSHUP_SMS_PASSWORD`); variables `MSG_SMS_DLT_ENTITY_ID` and the template map.
- **Config:** `int.sms.provider`, `int.sms.dlt_entity_id`, `int.sms.sender_id.<brand>`, `int.sms.template_map`; env `MSG_SMS_ADAPTER`.

### 6.12 WHATSAPP

- **Interface:** `sendTemplate(to, templateName, lang, components, idempotencyKey)`, `sendSession(to, message)`, `uploadMedia(file)`, `getTemplateStatus(name)`, `submitTemplate(spec)`, `verifyWebhook` and `handleWebhook()`, `getConversationCost(category)` (category and cost exposed for OH8 billing), `health()`. Media of class CONFIDENTIAL goes as a secure link.
- **Reference `gupshup` (OWN-07, OWN-08, D-07):** Gupshup BSP.
- **Alternative `meta-cloud`:** Meta WhatsApp Cloud API direct (the IPB catalogue reference). Webhooks are verified with `X-Hub-Signature-256` (C-13).
- **Residency:** both `GLOBAL` (Meta processes globally), `maxDataClass: INTERNAL` for bodies. Recipient numbers go only for delivery, with a DPA on file for each (`dpa_ref`, 3.12). A product whose routing forbids GLOBAL recipients cannot use WhatsApp.
- **Failover:** `none` between BSPs, because the WABA number is not portable on the fly. On outage the channel falls back to SMS or EMAIL with notice (NOTIFY, PL3).
- **Flags:** marketing templates stay **off** (`mkt.meta.enabled=false`, OWN-08). PL2 builds the utility and authentication template path, test-mode only.
- **Contract tests:** template send, session send inside the 24 h window only, media upload, template status, webhook verify and de-duplication, cost category exposed, quality-rating health.
- **Targets:** hermetic: Gupshup and Meta stubs. Sandbox: the Gupshup sandbox app and the Meta test business number (allow-listed recipient numbers only).
- **Secrets needed:** `MSG_WHATSAPP_ACCESS_TOKEN_REF` → `secrets/<env>/whatsapp/<adapter>/access_token` (CI `SANDBOX_GUPSHUP_WA_API_KEY`, `SANDBOX_META_WA_ACCESS_TOKEN`); `secrets/<env>/whatsapp/meta-cloud/app_secret` (CI `SANDBOX_META_WA_APP_SECRET`); `MSG_WHATSAPP_VERIFY_TOKEN` → `…/webhook_verify_token`; variables `MSG_WHATSAPP_PHONE_NUMBER_ID` and the Gupshup app name.
- **Config:** `int.whatsapp.provider`, `int.whatsapp.waba_id.<brand>`, `int.whatsapp.phone_id.<brand>`, `int.whatsapp.template_namespace`, `int.whatsapp.webhook_verify_token`, `int.whatsapp.brand_number` (PL1); env `MSG_WHATSAPP_ADAPTER`.

### 6.13 PAYMENTS

See section 8 (locked list). Nothing in the PAYMENTS adapters is built until section 8 is approved item by item.

## 7. `@infrabyx/testing` additions

- `ports/<port>.contract.ts` for all 13 ports, built on the PL1 `defineContractSuite`. Each suite is parametrised by adapter factory, so products run the same suites against their routing.
- Container helpers (`startKeycloak`, `startZitadel`, `startCerbos`, `startOpenFga`, `startMinio`, `startRedis`, `startTemporalDev`, `startOpenBao`, `startUnleash`, `startOtelCollector`, `startMoto`), each pinned by digest and each returning config ready for `createRouter`.
- Vendor stubs (`stubs/<vendor>`) for Razorpay, Cashfree, Brevo, MSG91, Gupshup (SMS and WhatsApp) and Meta. They replay recorded sandbox responses. Recordings are refreshed by the nightly sandbox leg and scrubbed of IDs, numbers and any secret before commit; the existing gitleaks and pre-commit guard also run on them.
- A fault-injection helper: an in-process HTTP proxy that returns N × 5xx or delays, for breaker and failover tests (`@IPB-01-AT-08`).
- Memory fakes for the new ports, counted as the second IPB-01-15 alternative where no other exists.

## 8. PAYMENTS — locked list (approved 26 Oct 2026; P-05 and P-07 revised per the owner)

PAYMENTS collects customer fees through hosted checkout only (PCI DSS SAQ A). The billing engine of record is OH8 (IPB-D-07). Products emit `in.infrabyx.billing.SubscriptionPaymentReceived.v1` (Ecosystem Spec §6.27), and this port never computes invoices. PAYOUTS (money out) is a separate port and is **not** in PL2.

| ID       | Choice                         | Recommendation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Basis                                                                             |
| -------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **P-01** | Adapters                       | Reference **`razorpay`**, alternative kept green **`cashfree`** (both RBI PA-authorised Dec 2023, per IPB-01). PayU, PhonePe PG and Stripe are not built in PL2. IPB-01's routing example and `@IPB-01-AT-08` name PayU as the secondary; I adapt the AT to the configured secondary and raise PR-009                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Owner pair; IPB-01 catalogue                                                      |
| **P-02** | Methods built                  | `createOrder`, `createCheckoutSession`, `verifySignature` (checkout return), `capture`, `refund`, `createMandate` (UPI AutoPay / eNACH via the PA's subscription API), `verifyWebhook` and `handleWebhook`, `reconcile(dateRange)`, `health()`. All of them run in **test mode only** in PL2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | IPB-01 catalogue interface                                                        |
| **P-03** | Live keys                      | **No live key anywhere in this repository, CI or non-prod.** Routing and the env guard refuse a live credential outside `prod`/`dr` (Razorpay `rzp_live_` key-ID prefix, Cashfree `PROD` environment) and refuse a test credential in `prod` except for the health probe (P-14). Live keys are entered only into the production SECRETS store at go-live (PL6/product), by you                                                                                                                                                                                                                                                                                                                                                                                                           | IPB-11 guards; IPB-02-28                                                          |
| **P-04** | Money representation           | Integer **minor units** (`amountMinor`, paise), a safe integer > 0; currency ISO 4217, **`INR` only** in PL2; no floating point anywhere; no rounding in the adapter; vendor amounts are converted and checked for exact equality on return                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Correctness                                                                       |
| **P-05** | Idempotency                    | `idempotencyKey` **mandatory** on `createOrder`, `refund`, `createMandate`. The record is written as `pending` **before** the vendor call (3.5). Razorpay: the key is the order `receipt`, and lookup lists orders by `receipt`. Cashfree: our `order_id`/`refund_id` are derived from the key, lookup is by those IDs, and `x-idempotency-key` is also sent. A retry that finds `pending` looks the operation up at the PA before any new call. Same key with a different payload gives `IPB-PORT-004` (`@IPB-02-AT-05` scenario 1)                                                                                                                                                                                                                                                     | IPB-01 §01.4.4.1; IPB-10-07; owner 26 Oct 2026                                    |
| **P-06** | Capture                        | **Auto-capture** at the PA (no authorised-but-uncaptured state). `capture()` exists for a manual-capture plan but is unused in PL2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Fewer failure states                                                              |
| **P-07** | Refunds                        | Refund is **R3 financial** (IPB-02 §02.4.6.1: maker-checker, locked). `refund()` requires an `approvalRef`; the port checks through the PL1 approvals engine that the request is approved for action `payments.refund` with the same payload hash, else `IPB-SEC-006`. An agent can be the maker only (IPB-02-10). A refund goes to the PA that captured the payment, never fails over, and cannot exceed the captured amount minus prior refunds. **A refund is never retried blindly.** On an unknown outcome the retry first lists the payment's refunds at the PA by our reference (Cashfree `refund_id`; Razorpay refund `receipt` and notes). It calls again only if the PA authoritatively shows no such refund; otherwise the refund stays `pending` and goes to the human queue | IPB-02 §02.4.6.1; IPB-03 locked actions enforced in the kernel; owner 26 Oct 2026 |
| **P-08** | Failover                       | Routing `mode: active_failover`, `failover_rule: { success_rate_below: 0.8, over_minutes: 10 }`, or the breaker on API 5xx. Only **new checkout sessions** move to the secondary; an order records its PA and completes there; mandates and refunds never fail over. The secondary must be onboarded for the same merchant of record (OWN-02 entity). The adapter records success and failure outcomes for the rate                                                                                                                                                                                                                                                                                                                                                                      | IPB-01 catalogue; OWN-02                                                          |
| **P-09** | Webhooks and return signatures | Verified inside the adapter (C-13): Razorpay `X-Razorpay-Signature`; Cashfree `x-webhook-signature` with `x-webhook-timestamp` (±5 min); checkout return `razorpay_signature` and the Cashfree order status fetch. Client-side "success" is never trusted; final state comes from the verified webhook or a server-side fetch. De-duplication by vendor event ID in the module inbox                                                                                                                                                                                                                                                                                                                                                                                                     | IPB-10-27                                                                         |
| **P-10** | Data kept                      | The port returns PA IDs, amount, currency, status, method category (card, UPI, netbanking, wallet) and timestamps. Card data never touches Infrabyx. VPA and bank account values are masked by the PL1 mask rules before they leave the adapter. Payment metadata is REGULATED. Persistence is the calling module's (OH8/product); the platform stores only idempotency records (5.4)                                                                                                                                                                                                                                                                                                                                                                                                    | IPB-02-22; IPB-01 catalogue                                                       |
| **P-11** | Reconciliation                 | `reconcile(dateRange)` is **read-only**: it fetches payments, refunds and settlements and returns a normalised report with differences. It makes no automatic corrections; differences go to a human queue (PL3)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Money-movement caution                                                            |
| **P-12** | Kill switch                    | `kill.payments` on gives `createOrder`, `createCheckoutSession`, `createMandate` and `refund` a maintenance error (`@IPB-02-AT-20`); webhook intake and `reconcile` continue so in-flight payments settle                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | IPB-02-83, IPB-02-AT-20                                                           |
| **P-13** | Residency                      | Both adapters `IN`, `maxDataClass: REGULATED`. The schema refuses a GLOBAL secondary (Stripe) with failover for REGULATED (`IPB-PORT-005`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | IPB-01 §01.4.5                                                                    |
| **P-14** | Health in production           | PA status endpoint plus an **hourly synthetic order in test mode** (IPB-01 catalogue). In production this needs a **separate test-mode credential** at `secrets/prod/payments/<adapter>/healthcheck_key_*`, used only by the probe                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | IPB-01 catalogue                                                                  |
| **P-15** | Tests                          | Contract suite on both adapters in test mode (sandbox leg) and against stubs (hermetic leg); `@IPB-01-AT-08` with Razorpay sandbox behind the fault-injection proxy (6 × 5xx) then a real Cashfree sandbox order, plus `AdapterFailedOver.v1` from `razorpay` to `cashfree`; `@IPB-01-AT-06`/`07` residency rules; refund approval checks; webhook replay                                                                                                                                                                                                                                                                                                                                                                                                                                | IPB-01-AT-08                                                                      |
| **P-16** | Secrets (names only)           | `PAYMENTS_RAZORPAY_KEY_ID` (not secret), `PAYMENTS_RAZORPAY_KEY_SECRET` → `secrets/<env>/payments/razorpay/key_secret`, `PAYMENTS_RAZORPAY_WEBHOOK_SECRET` → `…/razorpay/webhook_secret`; `PAYMENTS_CASHFREE_APP_ID` (not secret), `PAYMENTS_CASHFREE_SECRET_REF` → `…/cashfree/secret_key` (Cashfree signs webhooks with it). CI environment `sandbox`: `SANDBOX_RAZORPAY_KEY_ID`, `SANDBOX_RAZORPAY_KEY_SECRET`, `SANDBOX_RAZORPAY_WEBHOOK_SECRET`, `SANDBOX_CASHFREE_APP_ID`, `SANDBOX_CASHFREE_SECRET_KEY` — **test-mode values only**                                                                                                                                                                                                                                               | IPB-11 names; IPB-02 §02.4.4                                                      |
| **P-17** | Config                         | `int.payments.primary`, `int.payments.secondary`, `int.payments.webhook_path`, `int.payments.settlement_account_ref`, `int.payments.methods_enabled` (default `upi,card,netbanking`; wallets off), `PAYMENTS_HOSTED_CHECKOUT_ONLY=true` (locked)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | IPB-01; IPB-11                                                                    |
| **P-18** | Connector manifests            | `packages/connectors/marketplace/{razorpay,cashfree}.manifest.json` (IPB-10-29/30, `data_class_max: REGULATED`, residency `IN`), so a tenant collecting its own fees can install them later (UI in PL5/PL6)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | IPB-10 §10.4.6.2                                                                  |

## 9. Cryptography choices — locked list (approved 26 Oct 2026; C-11 per the owner)

All of these are implemented in `@infrabyx/crypto` as the single call-site (IPB-12-05, PL1-C-01) using `node:crypto`, plus `jose` for JOSE only (C-11, PL2-C-01). `connectors` calls `crypto`; adapters never import `node:crypto` or `jose`. Where a vendor dictates the algorithm, the choice is only how strictly we verify.

| ID       | Choice                                    | Recommendation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Basis                                   |
| -------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| **C-11** | JWT/JWS verification (IDENTITY)           | Implemented with **`node:crypto` inside `@infrabyx/crypto`** (PL1-C-09 stands). `jose` is a **test-only devDependency** for a differential test, never used at runtime (PL2-C-02). Rules:<br>• ES256 verified with `dsaEncoding: 'ieee-p1363'`.<br>• PS256 with PSS padding, MGF1-SHA-256, salt length 32.<br>• RSA keys ≥ 2048 bits.<br>• Algorithm allow-list **per issuer** (what that IdP signs with under C-12), not the union.<br>• `none` and `HS*` refused; `alg` must match the JWK; `kid` required.<br>• `crit`, `jku`, `x5u`, `x5c` headers and any embedded `jwk` refused; keys come only from the configured JWKS URL.<br>• Strict base64url, exactly three segments.<br>• `iss`, `aud`, `exp`, `nbf`, `iat` checked with ±60 s skew.<br>• JWKS cached 24 h, refetched on unknown `kid` at most once per minute.<br>Tests: RFC 7515 Appendix A and RFC 7520 vectors, the negative cases, and the differential test against `jose` | IPB-01 IDENTITY; owner 26 Oct 2026      |
| **C-12** | Token signing at the IdPs                 | **ES256 (P-256)** for access and ID tokens on Keycloak and Zitadel (FAPI 2.0 allows ES256/PS256; same curve as C-03); keys rotated with two `kid`s overlapping 7 days (IPB-02 §02.4.4)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | IPB-02-29; IPB-10-17                    |
| **C-13** | Vendor signature verification             | HMAC-SHA-256 as each vendor defines (Razorpay hex over the raw body; Cashfree base64 over timestamp ‖ raw body; Meta `sha256=` hex); constant-time comparison on raw bytes; timestamp window ±5 min where sent. **SNS (SES events): SignatureVersion 2 (RSA-SHA256) only, v1 SHA-1 refused**; `SigningCertURL` must match `https://sns.ap-south-1.amazonaws.com/…pem`, fetched through the egress allow-list and cached                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | IPB-10-27                               |
| **C-14** | KMS key specs                             | AWS KMS: `SYMMETRIC_DEFAULT` for encrypt/decrypt/generateDataKey (AES-256 data keys); `ECC_NIST_P256` with `ECDSA_SHA_256` and `MessageType: DIGEST` for signing (continues PL1 C-03, PL1-D-09); encryption context = `{tenant_id, purpose}` as the AAD map. Vault Transit: `aes256-gcm96` and `ecdsa-p256`. ML-DSA listed as `planned` behind `crypto.pqc.sign_hybrid` **[VERIFY AWS KMS ML-DSA in ap-south-1]**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | PL1-C-01; IPB-02 §02.4.3.2              |
| **C-15** | Tenant keys                               | **One customer-managed key per tenant that holds REGULATED fields** (IPB-01 KMS: "one customer-managed key per tenant for REGULATED fields"); other tenants use the platform key with `tenant_id` in the encryption context. Automatic annual rotation on symmetric keys. `scheduleKeyDeletion` only with **30 days** (AWS maximum; IPB-02-20 minimum) after an R5 maker-checker approval with its 72 h delay                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | IPB-01 KMS; IPB-02-20; IPB-02 §02.4.6.1 |
| **C-16** | Temporal payload codec                    | AES-256-GCM on every payload with a KMS data key per namespace (the PL1 C-04 field path), **always on for `temporal-cloud`**, optional for self-hosted                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Defence in depth for OWN-05             |
| **C-17** | Storage encryption and presigning         | S3: SSE-KMS with the platform key per bucket class (S3 Bucket Keys on); MinIO: SSE-S3 auto-encryption in test (production MinIO choice in PL6, D-02); presigned URLs are SigV4 (vendor-defined), TTL ≤ 300 s, bound to method and content type                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | IPB-02-15, IPB-02-20                    |
| **C-18** | Secrets at rest and in use                | AWS Secrets Manager encrypted with the platform key (not the AWS-managed key); values held in memory only (15-min cache), never written to disk or logs; TLS with system CAs and hostname verification to every vendor; `NODE_TLS_REJECT_UNAUTHORIZED` refused by the env guard                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | IPB-02-28; IPB-02-21                    |
| **C-19** | Inbound webhook secrets we generate       | 32 bytes from `randomBytes`, base64url, stored in SECRETS; rotation every 180 days with two secrets accepted during overlap where the vendor allows (Razorpay, Brevo bearer)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | IPB-02-29; IPB-10-21 pattern            |
| **C-20** | Idempotency request hash                  | SHA-256 over JCS (RFC 8785) of the request, excluding transport headers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Same canonical form as PL1 C-01         |
| **C-21** | Hashed identifiers in telemetry and flags | HMAC-SHA-256 with the PL1 hashing key (`OBS_AUDIT_HASH_CHAIN_KEY_REF`, PL1 C-02), **truncated to 128 bits (32 hex)** for `tenant_id`, user IDs and Unleash context IDs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | IPB-01 OBSERVABILITY, FEATURE_FLAG      |

## 10. Acceptance tests by ID

| Test                                                                 | PL2 coverage                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@IPB-01-AT-04` vendor-import                                        | Re-run with real SDK imports in `connectors` (allowed) and a fixture outside it (fails)                                                                                                                                                                    |
| `@IPB-01-AT-06` residency fail-closed                                | Router-level, with a stub LLM port exactly as the scenario (REGULATED call to a GLOBAL `fast-small` primary: `IPB-PORT-003`, no request leaves, event emitted); re-run against real LLM adapters in PL4. Also run for EMAIL, WHATSAPP and `temporal-cloud` |
| `@IPB-01-AT-07` failover never crosses residency                     | Routing load fails with `IPB-PORT-005`                                                                                                                                                                                                                     |
| `@IPB-01-AT-08` circuit-breaker failover                             | Razorpay → **Cashfree** (P-15, PR-009)                                                                                                                                                                                                                     |
| `@IPB-01-AT-09` Object Lock                                          | s3 and minio                                                                                                                                                                                                                                               |
| `@IPB-01-AT-10` storage parity                                       | `s3`, `minio` rows (azure-blob and gcs wait for those adapters)                                                                                                                                                                                            |
| `@IPB-01-AT-13` health aggregation                                   | `aggregateHealth()` with a CACHE fake down gives `degraded`                                                                                                                                                                                                |
| `@IPB-01-AT-19` no `process.env` in adapters                         | Re-run over `connectors`                                                                                                                                                                                                                                   |
| `@IPB-01-15`, `@IPB-01-16`, `@IPB-01-17`, `@IPB-01-18`, `@IPB-01-20` | Contract harness for every port; residency unit tests; health contract; chaos test; routing schema test                                                                                                                                                    |
| `@IPB-02-AT-02` MFA (API half)                                       | Token without MFA `amr` for ORG_ADMIN gives `IPB-SEC-001`                                                                                                                                                                                                  |
| `@IPB-02-05` SCIM de-provisioning                                    | Sessions revoked and old token refused within 60 s, both IdPs                                                                                                                                                                                              |
| `@IPB-02-AT-05` replay (scenarios 1 and 2)                           | PAYMENTS refund idempotency; webhook replay de-duplicated                                                                                                                                                                                                  |
| `@IPB-02-AT-11` agents makers only                                   | Cerbos policy test (adds to the PL1 kernel leg)                                                                                                                                                                                                            |
| `@IPB-02-AT-13` Object Lock protects audit                           | AUDIT bucket anchor file                                                                                                                                                                                                                                   |
| `@IPB-02-AT-15` ledger tamper and anchors                            | Anchors signed through `aws-kms` and `vault-transit`                                                                                                                                                                                                       |
| `@IPB-02-AT-20` kill switch                                          | Against Unleash, and `kill.payments` at the PAYMENTS port                                                                                                                                                                                                  |
| `@IPB-10-27` inbound webhooks                                        | Vendor signature tests per adapter and inbox de-duplication                                                                                                                                                                                                |
| `@IPB-10-29` connector manifest lint                                 | Four manifests (Razorpay, Cashfree, Gupshup, Meta)                                                                                                                                                                                                         |
| `@IPB-01-16` data-class floor (3.1)                                  | A `call.dataClass` below the port default is refused; payload annotations below the default are honoured only when complete; `ipb/port-data-class` lint fixtures                                                                                           |
| `@IPB-01-16` messaging recipients (3.12)                             | GLOBAL adapter without `dpa_ref` refuses recipient fields; `allow_global: false` refuses; a product file that loosens `residency_policy` fails with `IPB-PORT-005`                                                                                         |
| `@IPB-01-18` STORAGE fail-fast                                       | Primary down: writes return `IPB-STOR-002` at once, nothing is enqueued, reads served by the replica                                                                                                                                                       |
| `@IPB-02-AT-05` pending idempotency                                  | Timeout after send leaves `pending`; retry looks up first; a refund the lookup cannot resolve goes to the human queue and is not re-sent                                                                                                                   |
| `@NN-01`, `@NN-02`, `@NN-45`                                         | Re-run with `connectors.idempotency_record` included (RLS, ledgered purge)                                                                                                                                                                                 |

Deferred, with phase: `@IPB-02-AT-01` and the browser half of `-AT-02` (UI, PL5); `@IPB-02-AT-14` (Kyverno and pod spec, PL6); `@IPB-01-AT-20` provider swap drill in staging (PL6); IPB-10 outbound webhook ATs (PL6).

## 11. CI additions and exit gate

- **`port-contract`** job (PRs, matrix per port, Testcontainers on `ubuntu-latest`): unit and hermetic legs. It is required on PRs that touch the packages listed in 3.11 and is cheap enough to always run.
- **`port-contract-sandbox`** workflow (nightly cron, `workflow_dispatch`, same-repository PRs that touch an adapter folder): uses the GitHub environment **`sandbox`** with the secrets named in section 6 and section 8, and AWS access through **GitHub OIDC** (no long-lived cloud keys, IPB-02-08). A failure opens or updates an issue labelled `port-contract`.
- `routing-check` (`infrabyx-routing check infra/routing/**/*.yaml`), `cerbos compile`/`cerbos test`, and connector manifest lint join `verify`.
- `ipb:check` gains: every port in the PL2 list has a contract suite and two adapter folders; every adapter declares residency, `maxDataClass` and capabilities.

**Exit gate, split so vendor accounts cannot block the products (owner decision 26 Oct 2026; IPB-DEV-04):**

_Gate A — publish (closes PL2):_

- [ ] All IPB-09 required checks green (existing plus the additions above)
- [ ] All 13 ports: **unit and hermetic legs green for the reference and the alternative**
- [ ] **Sandbox legs green for every adapter whose account exists** at gate time
- [ ] Each missing sandbox leg is an open issue labelled `port-contract`, naming the adapter, the account it needs and the owner action. The adapter is marked `unproven` in `packages/connectors/sandbox-status.json`
- [ ] Acceptance tests in section 10 present by tag and passing; `pnpm at:report` lists them
- [ ] `provider_routing` loader refuses the broken fixtures; reference routing files validate
- [ ] `@NN-01/02/45` still green with the new schema; migration-lint and rls-lint clean on `connectors`
- [ ] Changesets: `connectors` 0.1.0 (flipped to publishable), `contracts`/`crypto`/`config`/`testing` 0.2.0 (D-12)
- [ ] `docs/STATUS.md`, `docs/DECISIONS.md` and `docs/platform-requests.md` updated
- [ ] Published through `release.yml` (the version PR now runs CI itself, PL1-D-21)

_Gate B — per adapter, before any product uses it in staging:_

- [ ] Its `port-contract` issue is closed by a green sandbox run, and the closing PR marks it `proven` in `sandbox-status.json`
- [ ] `infrabyx-routing check` enforces this: a `staging`, `pre-prod`, `prod` or `dr` routing file that names an `unproven` adapter fails (`IPB-PORT-005`)

Expected at gate A, given D-01 and D-06:

| Adapter or leg                   | Waiting for                                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------------- |
| `s3`, `aws-sm`, `aws-kms`, `ses` | the AWS sandbox account (before the first staging deployment)                                     |
| `temporal-cloud`                 | the Mumbai namespace (owner, `docs/runbooks/temporal-cloud.md`)                                   |
| The weekly live SMS send         | DLT registration                                                                                  |
| Every other SaaS leg             | whichever of these test accounts you have opened: Razorpay, Cashfree, Brevo, MSG91, Gupshup, Meta |

_CI hygiene (PL2-D-07):_ `actions/checkout` v7.0.1 and `actions/setup-node` v7.1.0 (Node 24 releases, SHA-pinned) and `runs-on: ubuntu-24.04` are in place. Moving to Ubuntu 26.04 is a PR of its own.

## 12. Deviations and change requests (recorded 26 Oct 2026)

Deviations, owner-approved and recorded in `docs/DECISIONS.md`:

| ID         | Deviation                                                                                                                                                                             | Spec section                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| IPB-DEV-03 | SMS reference MSG91 (alternative Gupshup SMS); WHATSAPP reference Gupshup (alternative Meta Cloud API), per OWN-07/OWN-08                                                             | IPB-01 §01.4.4.2 SMS, WHATSAPP    |
| IPB-DEV-04 | Split exit gate: publish on unit + hermetic + available sandbox legs; each missing sandbox leg blocks only staging use of that adapter (section 11)                                   | IPB-14 §14.3 PL2, IPB-01-15       |
| IPB-DEV-05 | Recipient email address or phone number may go to a GLOBAL provider for delivery only, under a DPA; bodies INTERNAL; CONFIDENTIAL only as a secure link (3.12)                        | IPB-02 §02.4.3.1, IPB-02-25       |
| IPB-DEV-06 | STORAGE writes fail fast with `IPB-STOR-002` on primary outage; no file bytes in QUEUE (6.7)                                                                                          | IPB-01 §01.4.4.2 STORAGE failover |
| IPB-DEV-07 | **Time-bound:** ESIGN reference Leegality (alternative Digio) until LawDocs ships its eSign API; then `lawdocs-esign` becomes the group reference with Leegality and Digio beneath it | IPB-01 §01.4.4.2 ESIGN            |
| PL2-C-02   | C-11 implemented with `node:crypto`; `jose` test-only (supersedes PL2-C-01; PL1-C-09 stands)                                                                                          | PL1-C-09                          |

Change requests, written to `docs/platform-requests.md`:

| ID     | Request                                                                                                                                                                                                                                         | Why                                    |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| PR-007 | Add Brevo to the EMAIL catalogue alternatives (IPB-01 §01.4.4.2)                                                                                                                                                                                | Owner pair SES + Brevo                 |
| PR-008 | SMS and WHATSAPP reference adapters per IPB-DEV-03                                                                                                                                                                                              | OWN-07, OWN-08                         |
| PR-009 | `@IPB-01-AT-08` and the §01.4.5 example name PayU; parametrise on the configured secondary (Cashfree here)                                                                                                                                      | Owner pair Razorpay + Cashfree         |
| PR-010 | New code `IPB-PORT-006` "operation not supported by this adapter"                                                                                                                                                                               | Capability gaps (3.3)                  |
| PR-011 | Clarify IPB-01-15 for OBSERVABILITY: alternatives are OTLP backends, not SDKs                                                                                                                                                                   | A-05                                   |
| PR-012 | IDENTITY interface: add `handleLogoutToken` and `revokeSessions`                                                                                                                                                                                | IPB-02-05 needs revocation within 60 s |
| PR-013 | Reconcile IPB-02 §02.4.3.1 (contact details CONFIDENTIAL, `IN`/`IN-ZR` only) with the EMAIL/SMS/WHATSAPP catalogue (INTERNAL, GLOBAL providers): adopt the delivery-only recipient rule of IPB-DEV-05 and a `recipient_delivery` key in §01.4.5 | Owner decision 26 Oct 2026             |
| PR-014 | IPB-01 STORAGE failover: replace "writes queue in QUEUE for up to 15 minutes" with fail-fast `IPB-STOR-002` and caller-side retry                                                                                                               | QUEUE is INTERNAL only; IPB-DEV-06     |

Assumptions logged as PL2-D-nn when implemented (small points where the spec is silent): A-01 trailing `PortCall` argument (3.1); A-02 capability flags (3.3); A-03 in-house circuit breaker (3.6); A-04 vendor stubs plus sandbox legs (3.11); A-05 OBSERVABILITY exporter profiles (6.3); A-06 `connectors` schema and 24 h idempotency purge (5.4); A-07 pg-boss DDL as a checked-in migration (6.8); A-08 Keycloak SCIM through the Admin API (6.5).

## 13. Owner decisions (decided 26 Oct 2026)

| ID            | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D-01**      | Approved: a new AWS Organization (management account holds nothing else), sandbox member account in ap-south-1, production account in PL6 (PL2-D-11). Runbook and CloudFormation template in `docs/runbooks/` and `infra/aws/sandbox/`. AWS adapters are proven with moto, LocalStack and MinIO until the account exists                                                                                                                                                         |
| **D-02**      | Approved; status confirmed (PL2-D-14). CI pins the last official MinIO image by digest (test only); production object storage is a PL6 decision                                                                                                                                                                                                                                                                                                                                  |
| **D-03**      | As recommended: OpenBao image in CI; adapter named `vault`, compatible with both                                                                                                                                                                                                                                                                                                                                                                                                 |
| **D-04**      | As recommended: OpenFGA as the AUTHZ alternative                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **D-05**      | Approved: pg-boss as the QUEUE alternative. On Supabase use the Supavisor session pooler, because the direct host is IPv6 and GitHub Actions is IPv4-only; pg-boss on the transaction pooler is settled in the session-1 spike (PL2-D-15)                                                                                                                                                                                                                                        |
| **D-06**      | Approved, changed (PL2-D-16): Temporal Cloud namespace in ap-south-1 on pay-as-you-go; `temporal-cloud` is `IN` from the start, `maxDataClass: INTERNAL` until PL6; codec on for both engines (C-16). Steps in `docs/runbooks/temporal-cloud.md`                                                                                                                                                                                                                                 |
| **D-07**      | Approved: both pairs and the weekly live SMS, only after DLT registration; the test phone number is a secret (PL2-D-17). Checklist in `docs/runbooks/messaging-vendors.md`                                                                                                                                                                                                                                                                                                       |
| **D-08**      | As recommended: Brevo as the EMAIL alternative, subject to 3.12                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **D-09**      | Approved: LLM pair in PL4; ESIGN in PL3 with Leegality as interim reference and Digio as alternative, as a time-bound deviation (IPB-DEV-07)                                                                                                                                                                                                                                                                                                                                     |
| **D-10**      | As recommended: sandbox legs nightly plus same-repository PRs touching an adapter; one automatic retry; a red or missing leg opens a `port-contract` issue                                                                                                                                                                                                                                                                                                                       |
| **D-11**      | Approved with three changes (PL2-D-18): session 1 starts with a spike on every `[VERIFY]` item; one PR per session; no waiting for owner accounts (latest-by dates in `docs/runbooks/README.md`). Order: (1) contracts, config keys, routing schema, testing harness; (2) connectors core, OBSERVABILITY, FEATURE_FLAG; (3) SECRETS, KMS, crypto additions; (4) IDENTITY, AUTHZ; (5) STORAGE, QUEUE, WORKFLOW; (6) EMAIL, SMS, WHATSAPP; (7) PAYMENTS; (8) exit gate and release |
| **D-12**      | As recommended: `connectors` 0.1.0; `contracts`, `crypto`, `config`, `testing` 0.2.0                                                                                                                                                                                                                                                                                                                                                                                             |
| **P-01…P-18** | Approved with conditions (PL2-D-08 to PL2-D-10, section 15)                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **C-11…C-21** | Approved with conditions (PL2-C-02 to PL2-C-04, section 15)                                                                                                                                                                                                                                                                                                                                                                                                                      |

Owner actions that unlock sandbox legs (none blocks gate A):

- test accounts for Razorpay, Cashfree, Brevo, MSG91 and Gupshup (SMS and WhatsApp sandbox app);
- a Meta developer app with a test number;
- DLT registration and one test template, plus one test phone number;
- the Temporal Cloud Mumbai namespace (pay-as-you-go);
- the AWS sandbox account before staging.

Secrets go into the GitHub environment `sandbox` under the names in sections 6 and 8.

## 14. Risks

| Risk                                                                                  | Mitigation                                                                                                                        |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Vendor sandboxes are slow, rate-limited or change without notice                      | Hermetic leg on every PR; sandbox leg nightly with one retry; recordings refreshed nightly so stubs track the vendor              |
| SDK support for Node 24.22.1 (Temporal native core, BullMQ, Cerbos gRPC) **[VERIFY]** | Checked at the start of each port; a gap is a stop-and-ask, not a Node change (IPB-01-01)                                         |
| Docker Hub pull limits in CI                                                          | Official images from `public.ecr.aws/docker/library`; others from quay.io and ghcr.io; digests pinned                             |
| MinIO distribution status                                                             | D-02                                                                                                                              |
| pg-boss on Supabase (dev): the direct host is IPv6 and GitHub Actions is IPv4-only    | Supavisor session pooler from IPv4 hosts; transaction-pooler behaviour settled in the session-1 spike (PL2-D-15)                  |
| `connectors` install size (AWS SDK, Temporal, BullMQ)                                 | Subpath exports and dynamic import per adapter (3.10); size reported in the PR                                                    |
| Live money or messages by accident                                                    | P-03 guard; test-mode keys only in CI; WhatsApp and SMS sandbox recipients allow-listed; weekly live SMS to one owner number only |
| Session budget                                                                        | D-11                                                                                                                              |

## 15. Owner conditions of 26 Oct 2026 (approval with conditions)

Each item is an `[OWNER]` row in `docs/DECISIONS.md`. These conditions take precedence over earlier sections.

### 15.1 PR #12 and CI (PL2-D-07)

- PR #12 is accepted as built, including the version-PR skip of `changeset-required` and `pr-checklist`.
- `actions/checkout` and `actions/setup-node` move to their current Node 24 releases, SHA-pinned.
- `runs-on` is pinned to `ubuntu-24.04`; moving to 26.04 is a PR of its own.
- After the next version PR runs CI by itself, I report whether the organisation setting "Allow GitHub Actions to create and approve pull requests" is still needed.

### 15.2 Vendor pairs (PL2-D-06)

The six pairs are an owner decision of 26 Oct 2026. The earlier product references (EQ-R25, LD-R21, FBX-B11) were wrong and are dropped.

### 15.3 PAYMENTS (PL2-D-08 to PL2-D-10)

| Item | Condition                                                                                                                                                                                                                                                                                                                                                                   |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P-04 | Cashfree takes rupees as a decimal. Convert from paise with integer arithmetic and string formatting, never float division. Keep the exact-equality check on return                                                                                                                                                                                                         |
| P-05 | Razorpay refunds also send the documented `X-Refund-Idempotency` header (≥ 10 characters: letters, digits, `-`, `_`). Cashfree refunds use our `refund_id`. A retry always reuses the same key or `refund_id`, never a new one. Razorpay's `receipt` is a reference, not unique: an unclear `createOrder` outcome is looked up by `receipt` before another order is created |
| P-07 | The "cannot exceed captured minus prior refunds" check reads the PA's own refund list at execution time, not only our records                                                                                                                                                                                                                                               |
| P-08 | The success rate counts PA technical outcomes only (API errors, timeouts, gateway-side failures), never customer drop-offs or bank/issuer declines. It fires only above a minimum sample (20 attempts in the window). New sessions return to the primary when its breaker closes. Every switch is ledgered and alerts the owner                                             |
| P-09 | Razorpay webhooks are de-duplicated on `x-razorpay-event-id`                                                                                                                                                                                                                                                                                                                |
| P-13 | Regulatory basis for `IN`: RBI Storage of Payment System Data circular, RBI/2017-18/153, DPSS.CO.OD No.2785/06.08.005/2017-2018, 6 Apr 2018                                                                                                                                                                                                                                 |
| P-14 | Only the probe's service identity can read the healthcheck key path. Probe orders are tagged and never reach OH8, billing or reconciliation. Any other use of a test credential in prod raises an alert                                                                                                                                                                     |
| P-18 | Constraint for PL5/PL6: a tenant-installed connector settles only into that tenant's own account. No Infrabyx or Udofin account ever sits in a borrower's repayment or disbursal flow (RBI (NBFC – Credit Facilities) Directions, 2025, RBI/DOR/2025-26/347, 28 Nov 2025, Chapter III, para 10(1)–(3))                                                                      |

P-01, P-02, P-03, P-06, P-10, P-11, P-12, P-15, P-16 and P-17 are approved as written.

### 15.4 Cryptography (PL2-C-02 to PL2-C-04)

| Item | Condition                                                                                                                                                                                                                                                                                           |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C-11 | `node:crypto` implementation with the hardening in section 9; `jose` is a test-only devDependency for the differential test                                                                                                                                                                         |
| C-12 | Zitadel signs ES256 only through its web-keys feature, which its docs describe as feature-flagged. Confirm in the pinned version. If unavailable, the Zitadel adapter stays RS256, its C-11 allow-list entry matches, and that is recorded                                                          |
| C-13 | Every SES event topic is created with `SignatureVersion=2` (sandbox template now, PL6 Terraform later). `SigningCertURL` hosts allowed only for ap-south-1 (plus ap-south-2 for DR). `TopicArn` must equal the configured topic, and only that topic's `SubscriptionConfirmation` is auto-confirmed |
| C-15 | A tenant-key deletion request carries the tenant's written purge instruction and the data-return confirmation from its exit plan, and is refused while any legal hold applies to that tenant                                                                                                        |
| C-16 | The codec is on for both `temporal` and `temporal-cloud`. Failure messages and stack traces are encrypted too (`encodeCommonAttributes: true`). Workflow IDs, search attributes, signal/query names and task-queue names may contain no personal or REGULATED data                                  |
| C-17 | When a tenant has its own CMK (C-15), its S3 objects use that key (per-object SSE-KMS key ID), so a tenant purge covers documents as well as fields                                                                                                                                                 |
| C-21 | The telemetry/flag hashing key is derived from the PL1 key with HKDF-SHA-256 under the label `ipb/telemetry-id/v1`, so these hashes cannot be joined to the ledger's hashed actor IDs                                                                                                               |

C-14, C-18, C-19 and C-20 are approved as written.

### 15.5 Decisions, GitHub and CI minutes (PL2-D-11 to PL2-D-18, IPB-DEV-07)

- **D-01:** see section 13; runbook `docs/runbooks/aws-organization-and-sandbox.md`; template `infra/aws/sandbox/sandbox-account.cfn.yaml`.
- **GitHub Team (PL2-D-12):** the `sandbox` environment design stands. When the `main` ruleset is applied it requires only checks, signed commits and linear history, with no approving review until a second reviewer exists (`infra/policy/github/rulesets.json`).
- **CI minutes (PL2-D-13):**
  - the `port-contract` matrix has per-port path filters;
  - the full matrix runs nightly and before each release;
  - minutes per PR and per nightly run go into `docs/STATUS.md`;
  - the owner is warned at 70 % of the monthly allowance (2,100 of 3,000 on Team).
- **D-02, D-05, D-06, D-07, D-09, D-11:** see section 13 and the rows named there. Owner runbooks and the latest-by date for each account are in `docs/runbooks/`.

### 15.6 Standing authority (PL2-D-19)

I may merge a session PR myself when all required checks are green and it changes no approved decision or locked-list item. I stop and ask only for:

- a locked-list change;
- a departure from an approved decision;
- any scope cut;
- any new paid service or account;
- anything that could move live money or send a live message.
