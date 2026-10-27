# @infrabyx/connectors

## 0.3.0

### Minor Changes

- ca72d67: `@infrabyx/connectors/ai` (PL4 session 3, PL4-D-04): LLM and EMBEDDING adapters on stubs, all `unproven`:

  - `bedrock_claude_in` (reference; Bedrock Converse and InvokeModel in ap-south-1 through `@aws-sdk/client-bedrock-runtime`; #63);
  - `gemini_vertex_asia_south1` (alternative; Vertex REST with an injected access token, no Google SDK; #64);
  - `self_hosted_vllm` (the SELF route for SECRET data; #65).

  Each adapter checks its region at boot, refuses cross-region inference profiles, maps 429/5xx/timeouts to retryable errors for the gateway, never logs bodies, and emulates streaming.

- f6e9a88: `googleServiceAccountToken` (C-24, PL4-C-01): exchanges a service-account assertion at Google's token endpoint and caches the access token until 5 minutes before expiry, with one shared exchange for concurrent callers. `fcm` uses it, and `vertexServiceAccountToken` gives `gemini_vertex_asia_south1` a cloud-platform token from a service-account key read through SECRETS. An injected workload-identity token provider still works for both.
- bfa324d: IMAGE_GEN adapters in `@infrabyx/connectors/ai` (PL4 session 5, PL4-D-07): `GeminiImagen` (`gemini_imagen`, Vertex AI asia-south1, PNG only, no people; #69) and `FluxSelfHosted` (`flux_self_hosted`, OpenAI-compatible images endpoint on our own host; #70), both `unproven`. `VertexBase` is shared with the Gemini adapters.

### Patch Changes

- Updated dependencies [2b07109]
- Updated dependencies [200b25a]
- Updated dependencies [f6e9a88]
- Updated dependencies [f6e9a88]
- Updated dependencies [200b25a]
- Updated dependencies [9af583a]
- Updated dependencies [288ae44]
- Updated dependencies [b205b1d]
- Updated dependencies [183c532]
- Updated dependencies [f6e9a88]
- Updated dependencies [183c532]
- Updated dependencies [200b25a]
- Updated dependencies [b205b1d]
  - @infrabyx/contracts@0.4.0
  - @infrabyx/config@0.4.0
  - @infrabyx/crypto@0.4.0
  - @infrabyx/tenancy@0.4.0

## 0.2.0

### Minor Changes

- 50093e9: ESIGN adapters (new subpath `@infrabyx/connectors/esign`): `leegality` (interim reference; the
  webhook `mac` checked with C-25) and `digio` (alternative; callbacks carry the C-19 URL token).
  Both read the PDF by reference with its SHA-256 checked, refuse any method they cannot provide as
  asked (no downgrade), return only the status read back from the vendor after a webhook, write the
  signed PDF to STORAGE, and stay `unproven` until their sandbox legs (#55, #56). `ESIGN` joins the
  port-contract matrix.
- 1ed0659: PUSH adapters (new subpath `@infrabyx/connectors/push`): `expo` (reference, Expo push API v2,
  `sendTopic` unsupported) and `fcm` (alternative, FCM HTTP v1, C-24 service-account assertion or a
  workload-identity access token, cached until 5 minutes before expiry; `receipts` unsupported).
  Both refuse anything beyond title, deep link and INTERNAL data (`IPB-NTF-006`), remove tokens the
  vendor reports unregistered, and stay `unproven` until their sandbox legs (#50, #51).
- 53697f5: RULES engine adapters (new subpath `@infrabyx/connectors/rules`): `zen` (reference,
  `@gorules/zen-engine` 2.1.7), `json-rules` (alternative, `json-rules-engine` 7.3.1) and the memory
  CEL row walk, all compiling the platform decision table through one CEL subset parsed and checked
  by `@marcbachmann/cel-js` 8.0.0; strict input checks, `UNDETERMINED` on any engine error or timeout,
  canary health, and `evaluateCel` (PL3-D-18).
- dd7a98b: `@infrabyx/connectors/workflow`: `TemporalTimers` (a `TimerEngine` over the WORKFLOW port), the
  `ipbTimer` workflow (`TIMER_WORKFLOWS_PATH`) and `timerActivities` for `@infrabyx/workflow` timers
  (PL3-D-19).

### Patch Changes

- Updated dependencies [50093e9]
- Updated dependencies [2725b6c]
- Updated dependencies [dd7a98b]
- Updated dependencies [50093e9]
- Updated dependencies [e268b60]
- Updated dependencies [1ed0659]
- Updated dependencies [2725b6c]
- Updated dependencies [1ed0659]
- Updated dependencies [53697f5]
- Updated dependencies [dd7a98b]
- Updated dependencies [e268b60]
- Updated dependencies [1ed0659]
- Updated dependencies [50093e9]
- Updated dependencies [53697f5]
- Updated dependencies [3951517]
- Updated dependencies [3951517]
- Updated dependencies [dd7a98b]
- Updated dependencies [e268b60]
- Updated dependencies [1ed0659]
- Updated dependencies [53697f5]
- Updated dependencies [dd7a98b]
  - @infrabyx/config@0.3.0
  - @infrabyx/contracts@0.3.0
  - @infrabyx/crypto@0.3.0
  - @infrabyx/tenancy@0.3.0

## 0.1.1

### Patch Changes

- 995639f: Fix `@infrabyx/connectors/workflow` and `./workflow/worker` failing to load in plain Node ESM
  ("The requested module '@temporalio/proto' does not provide an export named 'temporal'"). The
  CommonJS package is now imported through its default export. No API change.

## 0.1.0

### Minor Changes

- 2969424: AUTHZ adapters `cerbos` (Cerbos PDP over HTTP, Admin API policy loading, query plans) and
  `openfga` (contextual-tuple model, no stored tuples), with the platform policy pack in `policy/`:
  the PL1 role floor, maker ≠ checker, agents never decide, product-scoped operations staff. Deny by
  default; PDP failure denies with IPB-AUTHZ-001; allow-only cache of at most 5 s.
- 858a76a: First release:

  - the provider_routing runtime: router, circuit breaker, health registry, HTTPS egress client,
    idempotency store with pending records and vendor lookup, and inbound-webhook helpers;
  - the `connectors` schema migration;
  - the OBSERVABILITY `otel` adapter, with the IPB-02-23 scrubber and two exporter profiles;
  - the FEATURE_FLAG `unleash` adapter (with registry sync) and the `config-db` alternative.

- 2969424: IDENTITY adapters `keycloak` (Keycloak 26.x, realm as code, Admin API SCIM) and `zitadel`
  (Zitadel v4, settings and ES256 web key as code), with a shared ES256 token verifier, claim mapping,
  the `assertMfaForRoles` API guard (IPB-SEC-001) and a revocation store: `PgRevocationStore` on the
  new migration `0002_session_revocation` refuses revoked sessions and users on every replica within
  60 s. Impersonation (`issueToken` with an actor) is unsupported on both adapters.
- 9ac878e: KMS adapters `aws-kms` (encryption context per C-14, DIGEST signing, tenant CMKs with rotation,
  30-day deletion only) and `vault-transit` (associated data, version-aware verification). Both fail
  decryption closed with IPB-KMS-001.
- 9ac878e: SECRETS adapters `aws-sm` (AWS Secrets Manager with the platform CMK, CloudTrail audit) and `vault`
  (Vault/OpenBao KV v2, dynamic database leases), plus `CachedSecrets` (15-minute cache, not-ready on
  a failed refresh, never older than 24 h). AWS SDK clients 3.1152.0, loaded on demand.
- 9c774b9: STORAGE adapters `s3` and `minio` (Object Lock compliance, write-once retention, soft delete,
  SSE-KMS with class or tenant keys, presigned URLs bound to method and content type, SHA-256
  verified replication); QUEUE adapters `bullmq` (Redis or Valkey) and `pg-boss` (new migration
  `0003_pgboss`, no DDL at runtime) with dead-letter queues and replay; WORKFLOW adapters `temporal`
  and `temporal-cloud` with the C-16 payload codec, encrypted failures, the 32 KB reference path and
  a worker helper at `@infrabyx/connectors/workflow/worker`.
- 7a36249: KMS adapters refuse `generateDataKey` without a valid C-14 context (IPB-PORT-003) and use the registered `health` context for canaries (PL2-D-50).
- 13c7379: EMAIL adapters `ses` (SES v2 in ap-south-1, configuration set per brand, SNS events verified per C-13 with a timestamp window) and `brevo` (GLOBAL with a DPA reference, idempotencyKey and tag lookup, DKIM-checked failover target, shared-secret webhooks with Brevo's source ranges); SMS adapters `msg91` (Flow API v5, CRQID, bearer delivery reports, balance health) and `gupshup-sms` (Enterprise GatewayAPI as a POST form, rendered DLT text, URL-token delivery reports) with a shared DLT registry that refuses unregistered templates and headers before any request; WHATSAPP adapters `gupshup` (BSP API) and `meta-cloud` (Graph API v26.0, `X-Hub-Signature-256`, verify-token handshake) with the 24-hour window check, marketing templates off while `mkt.meta.enabled` is false, and a configuration rate card. New subpath exports `@infrabyx/connectors/email`, `/sms` and `/whatsapp`. `@aws-sdk/client-sesv2` 3.1152.0 (PL2-D-64).
- 0c4535d: PAYMENTS adapters `razorpay` (reference) and `cashfree` (alternative), test mode only, on the approved locked list P-01 to P-18 (PL2-D-66): live credentials refused outside prod/dr, exact integer paise, references derived from the idempotency key with vendor lookup, refunds gated by an approved R3 request and read against the PA's refund list, `kill.payments`, raw-body webhook signatures, read-only reconciliation. Router: `noFailover` method specs and `router.portFor(port, adapter)` so refunds, mandates and captures stay with their PA (P-08). Subpath `@infrabyx/connectors/payments`; P-18 manifests in `marketplace/`.

### Patch Changes

- 543c70d: Owner conditions for the Gupshup URL secret (PL2-D-65): an `ipb_token` shorter than 32 random bytes is refused; the telemetry scrubber redacts credential-named query parameters (`ipb_token`, tokens, secrets, keys, signatures, passwords); Gupshup SMS reports and WhatsApp events are passed on only after `confirmStatus` confirms them and are withheld (with `onWithheld`) without it.
- 2f29ec8: STORAGE: MinIO-server contract leg (presigned-URL expiry, method, content-type and signature
  enforcement; SSE-S3). `minio` stays unproven and refused outside dev and test (PL2-D-61).
- d7cb4fd: Ship `sandbox-status.json` in the package, so products can run `infrabyx-routing check --sandbox-status node_modules/@infrabyx/connectors/sandbox-status.json` and keep unproven adapters out of staging and above (IPB-DEV-04 gate B). Each unproven adapter now names its open `port-contract` issue (PL2-D-67).
- 5482043: WORKFLOW: the personal-data check on workflow ids, names and task queues now looks at whole tokens (split on `.` `_` `:` `-`), so a phone number or PAN used as an id part is still refused while a ULID or hex id that merely contains a PAN-shaped or long digit run is accepted (about 1 % of ULID ids were refused before).
- Updated dependencies [5482043]
- Updated dependencies [efd00ab]
- Updated dependencies [2969424]
- Updated dependencies [858a76a]
- Updated dependencies [9ac878e]
- Updated dependencies [ded1ae2]
- Updated dependencies [9c774b9]
- Updated dependencies [9ac878e]
- Updated dependencies [9ac878e]
- Updated dependencies [858a76a]
- Updated dependencies [7a36249]
- Updated dependencies [7a36249]
- Updated dependencies [7a36249]
- Updated dependencies [13c7379]
- Updated dependencies [13c7379]
- Updated dependencies [13c7379]
- Updated dependencies [0c4535d]
- Updated dependencies [0c4535d]
- Updated dependencies [858a76a]
  - @infrabyx/crypto@0.2.0
  - @infrabyx/config@0.2.0
  - @infrabyx/contracts@0.2.0
  - @infrabyx/tenancy@0.2.0
