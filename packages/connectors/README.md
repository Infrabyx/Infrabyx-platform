# @infrabyx/connectors

Vendor adapters behind the IPB-01 ports, one folder per port, and the `provider_routing` runtime that chooses between them.

**Specified by:** `docs/ipb/` — IPB-01 §01.4.4 (ports, routing, failover), IPB-01-15/16/20, IPB-02-23 (scrubbing), IPB-02 §02.4.6 (egress). Plan: `docs/phases/PL2-plan.md` §3.

Vendor SDKs are imported only here (IPB-01-14). Each adapter has a unit leg, a hermetic leg (pinned containers, `infra/docker/TEST_IMAGES.md`) and a sandbox leg; `pnpm test:contract -- --port <PORT>` runs the first two and the third when its `IPB_TEST_SANDBOX_*` variables are set.

## Core (`src/core/`)

- **Router** (`Router.create`): reads a checked routing file (`@infrabyx/contracts` `checkRouting`), builds each port's primary and secondary, and returns a facade per port. Every call:
  - computes the effective data class (a caller may only raise it, PL2 plan §3.1) and refuses an adapter whose residency or max class cannot carry it, before any I/O (`IPB-PORT-003`, `ResidencyViolationBlocked`); GLOBAL messaging recipients need `allow_global` and a `dpa_ref` (IPB-DEV-05);
  - runs through a per-adapter circuit breaker and fails over only when the routing mode allows (STORAGE writes fail fast with `IPB-STOR-002`); emits `AdapterFailedOver` and `AdapterRecovered`;
  - wraps money and other idempotent methods in the idempotency store; a money call without a key is refused;
  - runs in an OBSERVABILITY span `port.<PORT>.<method>` with adapter, residency, data class and a hashed tenant id.
- **Circuit breaker**: opens on 5 consecutive failures or a 50 % error rate over the window; half-open trials. State is per replica (PL2-D-33).
- **Idempotency** (`runIdempotent`, `PgIdempotencyStore`): a pending record is written before the vendor call. A replay returns the stored result; a different request under the same key is `IPB-PORT-004`. A pending record found later is resolved through the adapter's vendor lookup; a money call whose outcome stays unknown is never re-sent (`IPB-PORT-002`, `pending_unresolved`) and goes to `onUnresolved` for reconciliation. Results at CONFIDENTIAL and above are sealed with tenant field encryption. Every write goes through `kernel.mutate` with an audit entry; expired records are purged, pending money records never.
- **Health registry**: periodic adapter probes; `ready()` fails when a critical port (IDENTITY, KMS, SECRETS) is down (@IPB-01-AT-13).
- **Egress client** (`createEgress`): HTTPS only, host allow-list (IPB-SEC-018), no redirects, timeouts, bounded retries honouring `Retry-After`, response size cap.
- **Inbound webhooks** (`acceptWebhook`): verify the signature, de-duplicate through the inbox, enqueue, ledger `connectors.webhook.received`; 401 on a bad signature.

## OBSERVABILITY (`@infrabyx/connectors/observability`)

`OtelObservability`: OpenTelemetry SDK → OTLP/HTTP, `IN` / `INTERNAL`. Two exporter profiles share one code path (A-05): `collector` (in-cluster Collector, no headers) and `otlp-direct` (a vendor intake with auth headers resolved from SECRETS, `OBS_OTLP_HEADERS_REF`). The endpoint must be HTTPS unless `OBS_OTLP_INSECURE` (local and test only).

- Every span attribute, metric attribute, log context and log message passes the IPB-02-23 scrubber: keys named in the PL1 mask rules are masked, PAN, Aadhaar, card, mobile and e-mail patterns in text are masked, credential keys are redacted, payload keys (`body`, `headers`, `prompt`, …) are dropped, and tenant/user/actor IDs become C-21 hashes (`telemetryIdHasher` from `@infrabyx/crypto`).
- `aiTrace` follows the OTel GenAI conventions with content capture locked off: message, prompt and tool-argument attributes are dropped.
- `callObserver()` plugs into the Router: span `port.<PORT>.<method>`, `port_call_duration_ms` and `port_call_total`.
- Exporter failures never reach the caller; `health()` reports `degraded`, never `down`.

## FEATURE_FLAG (`@infrabyx/connectors/feature-flag`)

Both adapters are `IN` / `INTERNAL` and plug into the PL1 `FlagService`, which keeps the last-known-good snapshot (≤ 24 h) and turns an unknown `kill.*` on when the provider and snapshot both fail (@IPB-02-AT-20). Evaluation contexts must carry C-21 hashes (32 hex); a raw tenant or user ID is `IPB-PORT-003`.

- **`unleash`** (reference): Unleash OSS through the Node SDK, with toggle state held in memory only. Once the SDK has gone `maxStalenessMs` without a successful poll, every evaluation throws `FlagProviderUnavailable`, so FlagService serves the snapshot instead. Non-boolean values come from strategy-variant payloads. `syncRegistry(defs)` creates every exact registry flag through the admin API (kill switches as `kill-switch`, off; default-on `fut.*` enabled), updates only the description and type afterwards, never flips an existing toggle, and is idempotent. `setValue` switches a boolean in the adapter's environment; call it through `FlagAdmin` so the change is governed and ledgered (PL1-D-11). Tokens come from SECRETS (`FLAGS_UNLEASH_API_TOKEN_REF`, `secrets/<env>/feature_flag/unleash/admin_token`).
- **`config-db`** (alternative): the PL1 `PgFlagProvider` on `config.flag_value`; no targeting (capability `targeting: unsupported`).

## SECRETS (`@infrabyx/connectors/secrets`)

Both adapters are `IN` / `SECRET`; paths are `secrets/<env>/<port>/<adapter>/<key>` and an adapter with a `pathPrefix` refuses any path outside it (`IPB-PORT-003`). A missing secret is `IPB-PORT-001` with `meta.reason: not_found` (a configuration gap, never a breaker trip). Wrap either adapter in `CachedSecrets`: values stay in memory for `int.secrets.cache_seconds` (900); a failed refresh after expiry keeps serving the last value but reports `down` so the pod goes not-ready, and a value older than 24 h is never served.

- **`aws-sm`** (reference): AWS Secrets Manager in ap-south-1 or ap-south-2 only; new secrets are created with the platform CMK (C-18); metadata as `ipb:*` tags; `rotate` keeps the previous version readable (overlap); `lease` emulated; `audit` reads CloudTrail `LookupEvents` for the secret's ARN. Credentials from workload identity (IRSA, OIDC); the AWS SDK is loaded only when the adapter is created.
- **`vault`** (alternative): Vault or OpenBao KV v2 over HTTPS through the egress client; Kubernetes service-account login (or a token in dev and CI); `lease` issues dynamic database credentials for paths mapped in `dynamic`; `audit` unsupported.

## KMS (`@infrabyx/connectors/kms`)

Both adapters are `IN` / `SECRET`, sign only with `ecdsa-p256-sha256` (DER) and fail decryption closed with `IPB-KMS-001` (`meta.reason`: `integrity`, `unavailable`, `pending_deletion`); there is no plaintext fallback. AAD binds every ciphertext and data key: pass `kmsContext({ tenant_id, purpose })` (C-14). Tenant keys are created once per tenant with annual rotation (C-15); key deletion is accepted only exactly 30 days ahead, after the R5 maker-checker approval, the tenant's purge instruction and the legal-hold check upstream.

- **`aws-kms`** (reference): AWS KMS in ap-south-1 or ap-south-2. `SYMMETRIC_DEFAULT` keys with the AAD as the encryption context (a canonical string map as is, any other AAD under `ipb:aad`); signing with `ECDSA_SHA_256` and `MessageType: DIGEST` over a locally computed SHA-256; tenant keys behind `alias/ipb/tenant/<id>`.
- **`vault-transit`** (alternative): Vault or OpenBao Transit; AAD as `associated_data`; signatures verified against every key version's public key, so rotation does not break old signatures. `scheduleKeyDeletion` is unsupported, because Transit can only delete at once.

## Migrations

`migrations/0001_init.sql`: schema `connectors` with `idempotency_record` (RLS forced, tenant policy). `infrabyx-migrate` applies it after seed whenever this package is installed (PL2-D-34), so a product keeps one migrate command.
