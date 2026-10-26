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

## AUTHZ (`@infrabyx/connectors/authz`)

Deny by default. Both adapters are `IN` / `CONFIDENTIAL` and share three rules:

- an `AGT_*` principal asking to approve, sign, disburse, delete or grant is denied in the adapter, before any PDP call (IPB-02-10); the policy pack denies it as well;
- a PDP failure is a deny carrying `IPB-AUTHZ-001` in `ref`, never an allow;
- allow decisions are cached for at most 5 s (`int.authz.decision_cache_seconds`); denials are never cached.

The platform policy pack ships in `policy/` and is loaded with `loadPolicies(await platformPolicyBundle("cerbos" | "openfga"))` (PL2-D-51). It has:

- derived roles for the PL1 role floor: tenant reader, writer, checker (never the maker), admin and owner; AI agents; product-scoped `OPS_*` staff;
- a reference resource `ipb_record` that products copy for their own kinds.

The adapters:

- **`cerbos`** (reference): a Cerbos PDP over HTTP. `planResources` returns Cerbos query plans; policies load through the Admin API into a dynamic store.
- **`openfga`** (alternative): the same decision table as an OpenFGA model. Every check sends contextual tuples built from the principal's roles and attributes and the resource's attributes, so the store holds no tuples. `planResources` is unsupported (PL2-D-52).

## IDENTITY (`@infrabyx/connectors/identity`)

Both adapters are `IN` / `CONFIDENTIAL` and share one verifier and one revocation store:

- `verifyToken` uses the C-11 verifier from `@infrabyx/crypto` with ES256 only (C-12) and a JWKS cache of `int.identity.jwks_cache_seconds` (24 h), so API calls survive an IdP outage; new logins then fail with `IPB-IDN-002`;
- claims map to the PL1 `VerifiedClaims`: roles outside the platform role format are dropped, the principal type travels as `ptyp`, and `mfa` is true only for an MFA method in `amr` (SMS is not one);
- `assertMfaForRoles(claims)` is the API guard for IPB-02-02: a privileged role without MFA is `IPB-SEC-001`;
- revoked sessions and users are refused through a `RevocationStore`. `PgRevocationStore` writes `connectors.session_revocation` (hashed subjects, RLS, a ledger entry per revocation) and every replica refreshes within 15 s, inside the 60 s of IPB-02-05 (PL2-D-53). SCIM deactivation, `revokeSessions`, a role change and an OIDC back-channel logout token all revoke.

The adapters:

- **`keycloak`** (reference): Keycloak 26.x. `KeycloakIdentity.applyRealm` applies the realm as code (`ipbRealm`): ES256 key, IPB-02-03 session lifetimes, refresh-token rotation, brute-force protection, passkeys, back-channel logout, the platform roles, admin-only user attributes and the claim mappers. A temporary password and an MFA-required role become Keycloak required actions, so the first login forces a password change and MFA enrolment. SCIM operations go to the Admin API (PL2-D-54).
- **`zitadel`** (alternative): Zitadel v4. `ZitadelIdentity.applyInstance` applies the same settings, an ES256 web key, the platform project and roles, the API app and a service principal. Tenant, type and product scope travel in admin-set user metadata; roles are project roles. Zitadel cannot require MFA per role, so the API guard enforces it and staff organisations use `forceMfa` (PL2-D-56).

`issueToken` gives client-credentials tokens for the platform service principal. RFC 8693 tokens with an `act` claim are unsupported on both adapters, so impersonation stays off (PL2-D-55).

## Migrations

`migrations/0001_init.sql`: schema `connectors` with `idempotency_record` (RLS forced, tenant policy). `migrations/0002_session_revocation.sql`: `session_revocation` for the IDENTITY revocation store (RLS forced, tenant policy). `infrabyx-migrate` applies it after seed whenever this package is installed (PL2-D-34), so a product keeps one migrate command.
