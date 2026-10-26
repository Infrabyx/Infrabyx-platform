# IPB-10 — API, Integration and Event Standard  (Infrabyx Platform Baseline Standard v1.0, 25 October 2026)

> **Status:** Binding for LD, LDC, EQ, FBX, UDF, OH unless a product records an `IPB-DEV` deviation.
> **Related:** IPB-01 (ports, QUEUE, internal event bus, outbox), IPB-02 (authentication controls, rate limits, SSRF guards, scopes for agents), IPB-09 (breaking-change process, release notes, developer-facing notice periods), IPB-04 (Developer portal pages in `apps/public`), Vidhi/AI file (MCP tool behaviour), Ecosystem Spec v1.2 §3 (CloudEvents, cross-product events — prevails for cross-product contracts).

## 10.1 Purpose and scope

This file defines the public and partner API surface of every Infrabyx product, the webhook and event contracts, the connector marketplace pattern, SDK and MCP exposure rules, API governance, and the developer portal. It exists so that every product's API looks and behaves the same, so that a partner who integrates one product can integrate the next in a day, and so that Vidhi and third-party agents can use the same contracts through MCP without a second code path.

Scope: HTTP API conventions (`/v1`, headers, errors, pagination, idempotency, concurrency, rate limits); authentication and scopes; webhooks; the connector marketplace; sandbox tenants and test keys; SDK generation; MCP server exposure; the event standard (CloudEvents envelope, outbox/inbox, catch-up and replay); API governance; developer portal pages.

Out of scope: internal module-to-module calls (IPB-01 §01.4.3), UI routing, product-specific resource models.

## 10.2 Definitions

| Term | Meaning |
|---|---|
| **Public API** | `https://api.<brand-host>/v1/...` resources available to tenants with API keys or OAuth clients. |
| **Partner API** | A subset of the public API under `/v1/partner/...` requiring the FAPI 2.0 profile (lending partners, banks, AA/ULI gateways). |
| **Problem** | An RFC 9457 `application/problem+json` error body. |
| **Cursor** | An opaque, base64url-encoded, signed pagination token. |
| **Idempotency-Key** | A client-supplied UUIDv7 header on POST/PATCH making a retried request safe. |
| **ETag** | A version token for a resource used with `If-Match` for optimistic concurrency. |
| **Scope** | A permission string `<domain>.<resource>:<action>` attached to a key or token. |
| **API key** | A long-lived credential `<prd>k_live_…` or `<prd>k_test_…` bound to a tenant, with scopes and an optional IP allow-list. |
| **Webhook endpoint** | A tenant-registered HTTPS URL that receives signed event deliveries. |
| **Delivery** | One attempt to send one event to one endpoint; has an ID, status, response code and timing. |
| **DLQ** | Dead-letter queue: deliveries that exhausted retries, retained for replay. |
| **Connector** | An installable integration (Slack, Google, Razorpay, …) described by a manifest and backed by one or more port adapters. |
| **Manifest** | The connector's declarative description: auth type, scopes needed, events consumed/produced, settings schema, health check. |
| **Sandbox tenant** | A tenant whose keys are `_test_` keys and whose ports are fakes or vendor sandboxes (IPB-09-45). |
| **MCP** | Model Context Protocol; the server exposes tools derived from the OpenAPI document. |
| **CloudEvents** | CNCF CloudEvents 1.0.2 envelope **[VERIFY: date]** used for every event, internal and external. |
| **Outbox / inbox** | Per-module tables that make event publication transactional and consumption idempotent (IPB-01 §01.4.3.3). |
| **Replay window** | How far back a consumer may request events to be re-delivered (default 30 days). |
| **Dual-run** | The period during which an old and a new major API version (or export map) are both served (90 days minimum). |

## 10.3 Requirements

### 10.3.A HTTP API conventions

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-10-01 | All public resources live under `/v1/`. Version is in the path only; no header or query versioning. A new major is `/v2/` with a 90-day minimum dual-run; deprecated versions send `Deprecation: @<unix-ts>` and `Sunset: <HTTP-date>` headers and a `Link: <docs>; rel="deprecation"` header. | PLATFORM | Contract test: deprecated route returns headers; route table has only `/v1` (and `/v2` during dual-run). |
| IPB-10-02 | The OpenAPI 3.1 document is generated from Zod schemas (`packages/contracts`) via the NestJS integration; hand-written OpenAPI is forbidden; the document is published at `/v1/openapi.json` and in the developer portal; CI fails on drift between code and the committed snapshot. | PLATFORM | `openapi-drift` check. |
| IPB-10-03 | Async contracts (webhooks, events) are described in AsyncAPI 3.0 generated from the event catalogue and published at `/v1/asyncapi.json`. | PLATFORM | `asyncapi-drift` check. |
| IPB-10-04 | Errors use RFC 9457 `application/problem+json` with members `type` (URL to help page), `title`, `status`, `detail`, `instance`, plus extensions `code` (`<PRODUCT>-<AREA>-<NNN>`), `help_key` (`hlp.<module>.<term>`), `trace_id`, and `errors[]` for field-level validation (`{path, code, message}`). No stack traces, SQL or internal hostnames. | PRODUCT | Exception filter tests for 400/401/403/404/409/412/422/425/429/500. |
| IPB-10-05 | List endpoints use cursor pagination: `?limit=` (default 50, max 500) and `?cursor=`; responses carry `data[]`, `next_cursor` (null at end), and `has_more`. Offset pagination is forbidden on public endpoints. | PRODUCT | Pagination contract test; `limit=501` returns 400. |
| IPB-10-06 | Filtering grammar: `?filter[<field>]=<value>`, `?filter[<field>][<op>]=<value>` with ops `eq, ne, gt, gte, lt, lte, in, nin, contains, starts, exists, between`; sorting `?sort=<field>,-<field>`; sparse fields `?fields=<a,b>`; expansion `?expand=<rel>` (one level, allow-listed per resource). Unknown filter fields return 400 with `errors[]`. | PRODUCT | Grammar parser tests; per-resource allow-list enforced. |
| IPB-10-07 | `Idempotency-Key` (UUIDv7) is mandatory on every POST and PATCH that creates or mutates state; requests without it return 400 `IPB-API-010`. The server stores the key, request hash and response for 24 h per tenant; an identical replay returns the stored response with `Idempotent-Replayed: true`; a replay with a different body returns 409 `IPB-PORT-004`; a key in progress returns 409 `IPB-API-011`. | PRODUCT | Idempotency contract tests. |
| IPB-10-08 | Concurrency: every mutable resource returns an `ETag` (strong, from `version` column); PATCH/PUT/DELETE require `If-Match`; mismatch returns 412 `IPB-API-012`; missing `If-Match` on PATCH returns 428 `IPB-API-013`. | PRODUCT | ETag tests. |
| IPB-10-09 | Rate limits are communicated with IETF `RateLimit` and `RateLimit-Policy` headers (draft-ietf-httpapi-ratelimit-headers **[VERIFY: current draft/RFC status]**) and `Retry-After` on 429; limits follow the IPB-02 matrix and the tenant plan. | PLATFORM | Header presence tests. |
| IPB-10-10 | JSON conventions: `snake_case` fields; ISO 8601 UTC timestamps with `Z`; money as `{amount: "1234.56", currency: "INR"}` strings (never floats); IDs as prefixed ULIDs; enums as `UPPER_SNAKE`; nulls explicit; no envelope besides `data`/pagination; `Content-Type: application/json; charset=utf-8`. | PRODUCT | Schema lint on Zod definitions. |
| IPB-10-11 | Every response includes `X-Request-Id` (= `trace_id`), `Cache-Control: no-store` on authenticated routes, and the security headers from IPB-02-47. | PLATFORM | Header tests. |
| IPB-10-12 | Bulk endpoints (`POST /v1/<resource>/batch`, ≤ 100 items) return per-item results with the same problem schema; partial success is explicit (`207`-style body with `status: 200`). | PRODUCT | Batch tests. |
| IPB-10-13 | `GET /v1/meta` returns product, version, region, supported API versions, sunset dates and the OpenAPI/AsyncAPI URLs. | PLATFORM | Contract test. |

### 10.3.B Authentication and scopes

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-10-14 | Supported credentials: (a) OAuth 2.0 client credentials (RFC 6749 §4.4) with JWT access tokens (15 min) issued by IDENTITY_PORT; (b) scoped API keys `<prd>k_live_<32 base62>` / `<prd>k_test_<32 base62>` where `<prd>` is `ld`, `ldc`, `eq`, `fbx`, `udf`, `oh`; (c) user session tokens for first-party apps only. Basic auth and query-string credentials are forbidden. | PLATFORM | Auth tests; key-format regex. |
| IPB-10-15 | API keys are shown once at creation, stored hashed (SHA-256 + per-tenant pepper), carry `scopes[]`, optional `ip_allow_list[]`, `expires_at` (default 12 months, max 24), `last_used_at`; rotation creates a new key with an overlap window; revocation is immediate. Keys never have more scopes than the creating user's permissions. | TENANT | Key lifecycle tests. |
| IPB-10-16 | mTLS is optional for public API clients (tenant uploads a CA or leaf certificate; the edge enforces client certificates on `api-mtls.<host>`), mandatory for `/v1/partner/*` when the FAPI 2.0 profile is enabled. | TENANT | mTLS handshake tests. |
| IPB-10-17 | FAPI 2.0 Security Profile for `/v1/partner/*` behind `api.oauth.fapi2_profile`: PAR (RFC 9126), PKCE, sender-constrained tokens via DPoP (RFC 9449) or mTLS (RFC 8705), `private_key_jwt` client authentication, no implicit/hybrid flows, access tokens ≤ 10 min, `iss` in authorisation responses. Conformance against the OpenID FAPI 2.0 test suite (released 9 July 2025) before any bank partner goes live. | PLATFORM | FAPI conformance run archived. |
| IPB-10-18 | Scope grammar `<domain>.<resource>:<action>` where domain = module name, resource = plural noun, action ∈ `read, write, delete, approve, export, admin`; wildcards only at the action level (`documents.files:*`), never at domain level; `admin` scopes cannot be attached to `_test_` keys in production. Every route declares its required scope in the Zod/OpenAPI metadata; a route without a scope fails CI. | PLATFORM | `scope-coverage` check = 100 %. |
| IPB-10-19 | Agent principals (`AGT_*`) calling the API (directly or via MCP) use tokens with `act` claims and scopes bounded by the acting user's permissions; `approve`, `delete` and `admin` actions are denied to agents (IPB-02-10). | PLATFORM | Agent scope tests. |
| IPB-10-20 | Optional RFC 9421 HTTP Message Signatures (`Signature-Input`, `Signature`) for partners who need non-repudiation; covered components include `@method`, `@target-uri`, `content-digest`, `created`, `nonce`; nonces are single-use for 10 minutes; `Content-Digest` (RFC 9530) required when signatures are used. | TENANT | Signature verification tests; replay rejected. |

### 10.3.C Webhooks

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-10-21 | Outbound webhooks follow Standard Webhooks 1.0: headers `webhook-id` (delivery ID), `webhook-timestamp` (unix seconds), `webhook-signature` (`v1,<base64 HMAC-SHA256>` over `<id>.<timestamp>.<body>`; multiple signatures during secret rotation); secrets are `whsec_` prefixed, 32 bytes, per endpoint; receivers must reject timestamps older than 5 minutes. Optional `v1a` ed25519 signatures behind `webhooks.asymmetric`. | PLATFORM | Signature tests with the Standard Webhooks reference library. |
| IPB-10-22 | Payload is the CloudEvents 1.0.2 structured-mode JSON envelope (10.4.9.1); the `data` member is the event schema from AsyncAPI; payloads contain IDs and summaries, never REGULATED fields (receivers fetch details via API with their scopes). | PLATFORM | Payload schema tests; REGULATED-field scanner. |
| IPB-10-23 | Delivery: HTTPS only; SSRF guard (IPB-02-43) at registration and delivery; timeout 10 s; success = 2xx; retries with exponential backoff and jitter (schedule 10.4.5.3) up to 24 attempts over ~72 h; then DLQ; endpoint auto-disabled after 7 consecutive days of failure with tenant notification. | PLATFORM | Retry schedule tests; DLQ tests; auto-disable test. |
| IPB-10-24 | Optional RFC 9421 message signature on deliveries for receivers that require it (`Signature-Input` covering `content-digest`, `webhook-id`, `webhook-timestamp`). | TENANT | Verification test. |
| IPB-10-25 | Replay endpoint: `POST /v1/webhooks/endpoints/{id}/replay` with `{event_ids[] \| from, to, types[]}` re-delivers within the replay window; `GET /v1/webhooks/endpoints/{id}/deliveries` lists deliveries with status, attempts, response code/time; `POST /v1/webhooks/endpoints/{id}/test` sends a sample payload of a chosen type. | TENANT | Endpoint tests. |
| IPB-10-26 | Webhook designer UI (Settings › Integrations › Webhooks): create endpoint, pick event types (tree by module), add filters (CEL expression over `data`, validated), set secret (rotate with overlap), test with sample payload and see the response, view deliveries and errors, replay, pause/resume, see health. | TENANT | e2e. |
| IPB-10-27 | Inbound webhooks (from PAs, ESPs, BSPs, KYC vendors) are verified with the vendor's signature scheme inside the adapter, de-duplicated via the module inbox table by vendor event ID, processed asynchronously via QUEUE_PORT, and answered 2xx within 2 s. Unverified payloads return 401 and are logged. | PRODUCT | Vendor-signature tests per adapter; inbox dedup test. |

### 10.3.D Connector marketplace

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-10-28 | Settings › Integrations shows a catalogue of connectors from `packages/connectors/marketplace/*.manifest.json`; each is install / configure / toggle; installing requests the listed scopes and auth; configuration is per tenant (or per entity where the manifest allows) and stored via SECRETS_PORT for credentials. | TENANT | e2e install flow for every reference connector. |
| IPB-10-29 | Manifest schema (10.4.6.1) is validated in CI; a connector cannot ship without `auth`, `scopes`, `events`, `health`, `data_class_max`, `residency`, `settings_schema`, `support_url`, `privacy_url`. | PLATFORM | Manifest lint. |
| IPB-10-30 | Reference connectors: Generic webhook (Zapier/Make style), Slack, Microsoft Teams, Google Workspace, Microsoft 365, Tally, Zoho Books, Razorpay (and PAYMENTS alternates), WhatsApp BSPs, Google Tag Manager / analytics, Calendar (Google/Microsoft), plus product-specific. Each has a health status, last sync, error count, and a "disconnect" that revokes tokens and deletes stored credentials. | PLATFORM | Connector health tests. |
| IPB-10-31 | Connectors respect data classes: a connector with `data_class_max: INTERNAL` never receives CONFIDENTIAL payloads (the event filter strips or blocks); residency is enforced per IPB-01-16. | PLATFORM | Data-class filter tests. |
| IPB-10-32 | Toggling a connector off pauses deliveries (kept in DLQ for replay); uninstalling deletes credentials, revokes OAuth grants where the vendor supports it, and is ledgered; `kill.integrations` pauses all connectors. | TENANT | Toggle/uninstall tests. |

### 10.3.E Sandbox, SDKs, MCP

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-10-33 | Every tenant can create one sandbox tenant (IPB-09-45); `_test_` keys work only against the sandbox tenant and `api-sandbox.<host>`; `_live_` keys are rejected on the sandbox host and vice versa; sandbox webhooks deliver to any HTTPS endpoint but with `webhook-environment: test` header. | TENANT | Cross-environment key tests. |
| IPB-10-34 | SDKs for TypeScript, Python and Java are generated from the OpenAPI document on every minor release (OpenAPI Generator or Speakeasy **[OWNER: tool choice]**), published to npm, PyPI and Maven Central under `@infrabyx/<prd>-sdk`, `infrabyx-<prd>`, `in.infrabyx:<prd>-sdk`; SDKs implement idempotency-key generation, ETag handling, pagination iterators, retries honouring `Retry-After`, and webhook signature verification. | PLATFORM | SDK smoke tests in CI against preview. |
| IPB-10-35 | MCP server (`apps/api/src/modules/mcp`) exposes tools derived from the OpenAPI document: one tool per operation with `x-mcp` metadata; read operations are exposed by default (`ai.mcp.server_enabled`), write operations only when `x-mcp.write: true` is set and each call requires per-action human confirmation surfaced by the client; `approve`, `delete`, `admin` operations are never exposed; an operation that performs an action on the IPB-03-71 locked human-approval list (or a product's IPB-03-74 list) may never carry `x-mcp.write: true` — the OpenAPI lint fails the build (`IPB-MCP-005`) and the runtime refuses the tool even if the metadata slipped through, so the locked action can only be *prepared* (L2) and confirmed by a human in the product UI. Transport: *(rev. 26 Oct 2026)* Streamable HTTP with OAuth; per-tool rate limits; tool descriptions derive from OpenAPI summaries and help keys. | PLATFORM | Tool catalogue test; write-tool confirmation test; forbidden-operation absence test. |
| IPB-10-36 | MCP tool calls run under the authenticated user's token with `act` claim; results are filtered by the same scopes and RLS as the API; tool outputs are wrapped as data with provenance (IPB-02-72) and never contain REGULATED fields unless the user's scope and the client's residency allow it. | PLATFORM | Scope and RLS tests through MCP. |

### 10.3.F Event standard

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-10-37 | Every event, internal or external, is a CloudEvents 1.0.2 envelope with required attributes `specversion`, `id` (ULID), `source` (`/infrabyx/<product>/<module>`), `type` (`in.<product>.<module>.<Event>.v<n>` or `in.infrabyx.<domain>.<Event>.v<major>`), `time`, `datacontenttype: application/json`, `dataschema` (URL to the versioned schema), plus extensions `tenantid`, `traceid`, `actorid` (hashed), `dataclass`, `sequence` (per aggregate). | PLATFORM | Envelope schema tests. |
| IPB-10-38 | Publication is transactional via the module outbox (IPB-01-11); consumers are idempotent via the inbox keyed by `id`; ordering is guaranteed per aggregate (`sequence`) and not across aggregates. | PRODUCT | Outbox/inbox tests; duplicate delivery test. |
| IPB-10-39 | Catch-up: a consumer may call `GET /v1/events?types[]=&since=<cursor\|time>&limit=` to read events it missed (replay window 30 days default, 90 for regulated plans); `POST /v1/events/replay` requests re-delivery to a webhook endpoint. | TENANT | Catch-up tests. |
| IPB-10-40 | Event schema evolution: additive fields in the same `v<n>`; removal or type change requires `v<n+1>` with both versions published for the dual-run; schemas live in `packages/contracts/events/<type>.schema.json` and are referenced by `dataschema`. | PLATFORM | Schema compatibility check (backwards) in CI. |
| IPB-10-41 | Cross-product events use only `in.infrabyx.<domain>.<Event>.v<major>` types defined in the Ecosystem Spec §3; products never improvise; proposals are listed in 10.6.2 and submitted to the Ecosystem Spec owner. | PLATFORM | Event catalogue lint: any `in.infrabyx.*` type not in the Ecosystem Spec registry fails. |

### 10.3.G Governance and developer portal

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-10-42 | API design review (checklist 10.4.10.1) is required for every new resource or breaking change; the review is recorded in the PR; `packages/contracts` changes require `PLT_RELEASE_MANAGER` or architecture CODEOWNER review (IPB-09-06). | PLATFORM | PR checklist item + CODEOWNERS. |
| IPB-10-43 | Breaking-change policy: any change in 10.4.10.2 is breaking → new major path, 90-day dual-run minimum (longer for regulated plans by contract), `Deprecation`/`Sunset` headers from day one, developer-portal notice, email to key owners, and usage telemetry per version that gates sunset (no sunset while a key used the old version in the last 30 days without written notice). | PLATFORM | `breaking-change-detector` (oasdiff) in CI; sunset gate test. |
| IPB-10-44 | Developer portal at `/developers` on each `apps/public`: Docs (guides, auth, webhooks, errors, pagination), API reference (rendered from OpenAPI), Events reference (AsyncAPI), Changelog (API section of the release notes), Status (link to the status page), Keys (link into the tenant app), SDK downloads, MCP guide, Postman/Bruno collection export, sandbox guide. Content is CMS-managed with generated sections locked. | PLATFORM | Pages exist; reference renders from the live document. |
| IPB-10-45 | API usage telemetry per key, per version, per operation (counts, errors, latency) is visible to the tenant (Settings › Integrations › API keys, IPB-07 node 14) and to the super admin; it drives sunset decisions and plan limits. | TENANT | Usage dashboard test. |
| IPB-10-46 *(rev. 26 Oct 2026)* | **No scope escalation through credentials.** The `scopes[]` of an API key, OAuth client or `act` token are a subset of the creating user's effective permissions at creation time *and* at every use (re-evaluated from the role graph; a demoted creator shrinks the key, `IPB-API-020` on the excess scope). `approve`, `delete` and `admin` scopes are never grantable to an API key or MCP tool; `approve` is reserved for interactive human sessions (maker-checker), `admin` for OAuth clients created under maker-checker by `ORG_OWNER`. Key creation and scope widening are maker-checker above `read`; a key cannot create another key; `_test_` keys never reach `prod` data. | PLATFORM | Scope-subset test; demotion shrink test; `approve` on key → 422 `IPB-API-021`; @IPB-10-AT-26. |

## 10.4 Design

### 10.4.1 URL and resource conventions

```
https://api.lawdocs.in/v1/documents                 collection
https://api.lawdocs.in/v1/documents/{doc_id}        item
https://api.lawdocs.in/v1/documents/{doc_id}/versions
https://api.lawdocs.in/v1/documents/{doc_id}:sign   custom action (colon verb), POST only
https://api.lawdocs.in/v1/documents/batch           bulk
https://api.lawdocs.in/v1/partner/loans/offers      FAPI-profiled partner surface (FBX)
https://api-sandbox.lawdocs.in/v1/...               sandbox host
https://api-mtls.lawdocs.in/v1/...                  mTLS host
```

Rules: plural nouns; kebab-case path segments; no verbs except colon actions; nested at most two levels; IDs are prefixed ULIDs; white-label brands get `api.<brand-host>` via `brand_pack.hosts`.

### 10.4.2 Problem details

```json
{
  "type": "https://developers.lawdocs.in/errors/LD-DOC-004",
  "title": "Document is locked",
  "status": 423,
  "detail": "Document doc_01J8Z… is under an Object Lock retention and cannot be modified.",
  "instance": "/v1/documents/doc_01J8Z…",
  "code": "LD-DOC-004",
  "help_key": "hlp.documents.locked",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "errors": [
    {"path": "/retain_until", "code": "LD-VAL-001", "message": "must be after current retention"}
  ]
}
```

Status mapping: 400 validation (`errors[]`), 401 authentication, 403 authorisation/scope, 404 not found (also for cross-tenant IDs, IPB-02-14), 409 conflict/idempotency, 412 ETag mismatch, 413 payload too large, 415 unsupported media type, 422 semantic refusal (residency, policy), 423 locked, 425 too early (delay window), 428 precondition required, 429 rate limited, 500 generic (no detail), 503 dependency unavailable (circuit open).

### 10.4.3 Pagination, filtering and sorting

Cursor: `base64url(HMAC-signed JSON {k: [sort values], id: last_id, f: filter_hash})`; a cursor from a different filter/sort returns 400 `IPB-API-014`. Stable sort always appends `id`. Example:

```
GET /v1/cases?filter[status][in]=OPEN,HEARING&filter[filed_at][gte]=2026-04-01T00:00:00Z&sort=-filed_at&limit=100&fields=id,title,status
→ { "data": [...], "next_cursor": "eyJrIjpb...", "has_more": true }
```

Full-text search uses `?q=` (SEARCH_PORT) and may not be combined with `sort` other than `relevance`.

### 10.4.4 Idempotency and concurrency

Idempotency store: table `api.idempotency_key` (`tenant_id`, `key`, `route`, `request_hash`, `response_status`, `response_body_ref`, `state` ∈ `in_progress|completed`, `expires_at` = +24 h); unique on (`tenant_id`, `key`). UUIDv7 is required because its time prefix allows cheap expiry and ordering; non-UUIDv7 keys return 400 `IPB-API-010`. The response for a replay includes `Idempotent-Replayed: true` and the original `X-Request-Id` in `Idempotent-Original-Request-Id`.

ETags are `"<version>"` from an integer `version` column incremented on every write in the same transaction as the audit ledger entry. `If-Match: *` is accepted for "I do not care" only on resources flagged `concurrency: relaxed` in OpenAPI metadata (none by default).

### 10.4.5 Webhooks

#### 10.4.5.1 Endpoint model

`webhooks.endpoint` (`id wh_…`, `tenant_id`, `url`, `description`, `event_types[]`, `filter_cel`, `secret_current_ref`, `secret_previous_ref`, `secret_rotated_at`, `state` ∈ `active|paused|disabled`, `signature_profile` ∈ `standard|standard+rfc9421`, `environment` ∈ `live|test`, `created_by`), `webhooks.delivery` (`id whd_…`, `endpoint_id`, `event_id`, `attempt`, `scheduled_at`, `sent_at`, `response_status`, `response_ms`, `error`, `state` ∈ `pending|succeeded|failed|dlq`).

#### 10.4.5.2 Headers on each delivery

```
POST /hooks/infrabyx HTTP/1.1
content-type: application/cloudevents+json; charset=utf-8
webhook-id: whd_01J9…
webhook-timestamp: 1761400000
webhook-signature: v1,K5oZfzN95Z9UVu1EsfQmfVNQhnkZ2pj9o9NDN/H/pI4= v1,<previous-secret-signature-during-rotation>
webhook-environment: live
content-digest: sha-256=:X48E9qOokqqrvdts8nOJRJN3OWDUoyWxBf7kbu9DBPE=:
signature-input: sig1=("content-digest" "webhook-id" "webhook-timestamp");created=1761400000;keyid="whk_…"    (optional RFC 9421)
signature: sig1=:...:
user-agent: Infrabyx-Webhooks/1.0 (+https://developers.<host>/webhooks)
```

#### 10.4.5.3 Retry schedule

Attempts at +0 s, 5 s, 30 s, 2 min, 10 min, 30 min, 1 h, 2 h, 4 h, 8 h, then every 8 h until attempt 24 (~72 h), each with ±20 % jitter; 410 Gone from the receiver disables the endpoint immediately; 429 honours `Retry-After` up to 1 h. After attempt 24 the delivery moves to DLQ (retained 30 days) and the tenant is notified; replay from DLQ resets attempts.

#### 10.4.5.4 Webhook designer UI (screen outline)

1. **Endpoints list**: URL, environment, state, health (success rate 24 h), last delivery, actions.
2. **Create/edit**: URL (SSRF-validated live), description, event picker (tree by module with search; counts), filter (CEL editor with validation and sample evaluation), signature profile, secret (reveal once; rotate with overlap), environment.
3. **Test**: choose event type → sample payload (from AsyncAPI examples, tenant-specific IDs) → send → show request headers, response code, body (truncated), timing.
4. **Deliveries**: table with status, attempts, next retry, response code/time; filters; row → detail with request/response; replay button; bulk replay by range.
5. **DLQ**: list with reason; replay/discard (discard is ledgered).

### 10.4.6 Connector marketplace

#### 10.4.6.1 Manifest schema

```json
{
  "id": "slack",
  "name": "Slack",
  "version": "1.2.0",
  "category": "messaging",
  "vendor": {"name": "Slack Technologies", "privacy_url": "…", "support_url": "…"},
  "auth": {"type": "oauth2", "authorize_url": "…", "token_url": "…", "scopes": ["chat:write", "channels:read"], "pkce": true},
  "scopes_required": ["notifications.channels:write"],
  "events_consumed": ["in.ld.documents.DocumentSigned.v1", "in.ld.cases.HearingScheduled.v1"],
  "events_produced": [],
  "actions": [{"id": "post_message", "input_schema": "…", "write": true}],
  "settings_schema": {"type": "object", "properties": {"default_channel": {"type": "string"}}},
  "data_class_max": "INTERNAL",
  "residency": "GLOBAL",
  "health": {"type": "api_ping", "interval_seconds": 300},
  "ports": ["NOTIFY"],
  "tiers": ["PLAN:pro", "PLAN:enterprise"],
  "help_key": "hlp.int.connectors.slack"
}
```

#### 10.4.6.2 Reference connector set

| Connector | Auth | Direction | Data class max | Notes |
|---|---|---|---|---|
| Generic webhook (Zapier/Make style) | per-endpoint secret | out (events), in (generic trigger URL with HMAC) | INTERNAL | The universal adapter; Zapier/Make apps are thin wrappers |
| Slack | OAuth2 | out (notifications), actions (post) | INTERNAL | |
| Microsoft Teams | OAuth2 (Graph) / incoming webhook | out | INTERNAL | |
| Google Workspace (Drive, Calendar, Gmail send-as for staff) | OAuth2 | both | CONFIDENTIAL (Drive export only with tenant approval) | WORKSPACE/CALENDAR ports |
| Microsoft 365 (OneDrive/SharePoint, Outlook calendar) | OAuth2 (Graph) | both | CONFIDENTIAL (as above) | |
| Tally | file export / Tally connector agent | out (vouchers) | CONFIDENTIAL | XML voucher export; OH8 billing data |
| Zoho Books | OAuth2 | out (invoices, payments) | CONFIDENTIAL | India DC **[VERIFY]** |
| Razorpay / PayU / Cashfree / PhonePe PG | API key (SECRETS) + webhooks | both | REGULATED (metadata) | PAYMENTS port adapters; tenant-level keys for tenants collecting their own fees |
| WhatsApp BSPs (Meta Cloud, Gupshup, Exotel, Infobip) | API key / embedded sign-up | both | INTERNAL | WABA per brand; template management |
| Google Tag Manager / analytics | container ID | out (consent-gated events) | PUBLIC | Only on `apps/public`; TAG_MANAGER port |
| Calendar (Google / Microsoft) | OAuth2 | both | INTERNAL | CALENDAR port |
| SIEM export (generic S3/HTTPS) | key/secret | out (security events) | INTERNAL | IPB-02-54 |
| Product-specific | varies | | | e.g. FBX bureau, AA, bank statements; EQ court data; LDC MCA watch |

#### 10.4.6.3 Install flow

Browse → Install (shows scopes, data class, residency, vendor privacy) → Authenticate (OAuth popup or key entry; keys go to SECRETS_PORT) → Configure (settings schema form; event selection where applicable) → Test (health check + sample action) → Enabled. Maker-checker applies when the connector's `data_class_max` ≥ CONFIDENTIAL or any action is `write: true` (R2 under IPB-02 §02.4.6.1).

### 10.4.7 Sandbox tenants and test keys

- Sandbox tenant created from Settings › Integrations › Sandbox (IPB-07 node 14; IPB-09-45): same schema, `demo` or anonymised data, fakes/vendor sandboxes, no billing, no live messaging.
- `_test_` keys bind to the sandbox tenant only; `api-sandbox.<host>` resolves to the same cluster with environment tagging, not to a separate deployment, so API behaviour is identical.
- Sandbox webhooks carry `webhook-environment: test`; sandbox events carry extension `environment: test`.
- Sandbox AI runs use the same residency rules (no relaxation) but a cost cap.

### 10.4.8 SDK and MCP

#### 10.4.8.1 SDK generation

Pipeline: `openapi.json` → generator config per language (`infra/sdk/<lang>.yaml`) → generated package → hand-written helpers layer (idempotency, ETag, pagination, webhooks) → tests against preview → publish on tag. Breaking API versions produce a new SDK major. Each SDK ships `verifyWebhook(headers, body, secret)` using the Standard Webhooks library.

#### 10.4.8.2 MCP exposure rules

| Rule | Detail |
|---|---|
| Source of truth | OpenAPI operations with `x-mcp: {expose: true, write: boolean, confirm: 'per_action', summary_override?}`; defaults: `GET` → expose read; `POST/PATCH/DELETE` → not exposed unless marked |
| Never exposed | Operations with scope action `approve`, `delete`, `admin`; payment/payout execution; key management; settings writes above R1 |
| Identity | Streamable HTTP transport with OAuth 2.1 (PKCE); token carries the user's scopes and `act` for the agent client |
| Confirmation | Write tools return a `confirmation_required` result with a human-readable summary; the client must present it and call again with the confirmation token (single-use, 5 min) |
| Rate limits | Per tool per user: reads 120/min, writes 20/min; `kill.mcp` pauses all |
| Output | Tool results wrapped `{data, provenance: {source, as_of, trace_id}, data_class}`; REGULATED fields masked unless scope + residency allow |
| Catalogue | `GET /v1/mcp/tools` lists exposed tools with scopes; the developer portal renders it |
| Vidhi | Vidhi uses the same MCP tool surface internally (one code path); skill allow-lists (IPB-02-73) restrict which tools a skill may call |

### 10.4.9 Event standard

#### 10.4.9.1 Envelope example

```json
{
  "specversion": "1.0",
  "id": "01J9ZC9Q2K7M8N3P4R5S6T7V8W",
  "source": "/infrabyx/ld/documents",
  "type": "in.ld.documents.DocumentSigned.v1",
  "time": "2026-10-25T09:30:00.000Z",
  "datacontenttype": "application/json",
  "dataschema": "https://developers.lawdocs.in/events/in.ld.documents.DocumentSigned.v1.schema.json",
  "subject": "doc_01J8Z…",
  "tenantid": "ten_01H…",
  "traceid": "4bf92f3577b34da6a3ce929d0e0e4736",
  "actorid": "sha256:…",
  "dataclass": "INTERNAL",
  "sequence": "42",
  "environment": "live",
  "data": {
    "document_id": "doc_01J8Z…",
    "signed_at": "2026-10-25T09:29:58Z",
    "signature_type": "AADHAAR_ESIGN",
    "hash_sha256": "…"
  }
}
```

Alignment with Ecosystem Spec §3: the envelope attributes and the `in.infrabyx.*` type grammar are the Ecosystem Spec's; this file adds the product-internal `in.<product>.*` grammar and the `environment` extension. Where the two differ, the Ecosystem Spec prevails for cross-product events.

#### 10.4.9.2 Outbox, inbox, catch-up, replay

| Component | Table | Key fields | Behaviour |
|---|---|---|---|
| Outbox | `<module>.outbox` | `id`, `type`, `envelope jsonb`, `created_at`, `published_at`, `attempts` | Written in the mutation transaction; dispatcher publishes in `id` order per aggregate; rows retained for the replay window then archived to STORAGE (AUDIT class) |
| Inbox | `<module>.inbox` | `consumer`, `event_id`, `processed_at` | Unique (`consumer`, `event_id`); consumer processes inside a transaction that inserts the inbox row |
| Event log | `events.log` (read model) | all published envelopes, indexed by `tenantid`, `type`, `time`, `id` | Serves `GET /v1/events` and webhook replay; retention = replay window (30/90 days), then archived |
| Replay | `POST /v1/events/replay` / `POST /v1/webhooks/endpoints/{id}/replay` | range or IDs | Re-delivers from `events.log` with `replayed: true` extension; rate-limited |

Catch-up cursor is the event `id` (ULID, time-ordered). Consumers that need strict per-aggregate ordering use `sequence` and buffer gaps for ≤ 60 s before requesting catch-up.

### 10.4.10 API governance

#### 10.4.10.1 Design review checklist

1. Resource naming and nesting per 10.4.1; no verbs; colon actions justified.
2. Zod schema is the source; OpenAPI regenerated; examples present for every schema.
3. Scope declared per route; least-privilege default; agent restrictions respected.
4. Idempotency on all POST/PATCH; ETag on mutable resources.
5. Pagination cursor-based; filter/sort allow-lists defined.
6. Problem codes registered with help keys; no new ad hoc error shapes.
7. Data classes on every field; REGULATED fields masked by default; residency implications noted.
8. Events emitted for every state change; schemas in `packages/contracts/events`; AsyncAPI regenerated.
9. Rate-limit class assigned.
10. IDOR test coverage auto-generated; threat model updated if CONFIDENTIAL+.
11. Backwards compatibility verified with `oasdiff`; breaking → new major with dual-run plan.
12. SDK impact reviewed; MCP exposure flags set deliberately.
13. Developer-portal docs updated; changeset with `audience: developer`.

#### 10.4.10.2 Breaking changes (always a new major)

Removing or renaming a field, path or query parameter; changing a field type or format; making an optional field required; changing default behaviour (sort, limit, filter semantics); narrowing enum values; changing error codes for an existing condition; changing authentication or scope requirements upward; changing pagination shape; changing webhook payload shape or signature scheme; removing an event type or field. Non-breaking: adding optional fields, new endpoints, new enum values (documented as open enums), new optional headers, new event types, relaxed limits.

#### 10.4.10.3 Dual-run and sunset

Day 0: `/v2` live; `/v1` returns `Deprecation` and `Sunset` (≥ 90 days) and `Link rel="deprecation"`; developer portal banner; email to key owners. Day 30/60/80: reminder emails to keys still using `/v1`. Sunset day: `/v1` returns 410 with a problem pointing to the migration guide — only if no key used `/v1` in the last 30 days or written notice was acknowledged; otherwise the release manager extends the sunset (ledgered). Regulated plans may contract longer dual-run periods.

### 10.4.11 Developer portal pages

| Page | Source | Notes |
|---|---|---|
| `/developers` | CMS | Overview, quick start, sandbox guide |
| `/developers/docs/*` | CMS + generated snippets | Auth, keys, idempotency, ETags, pagination, errors, webhooks, events, rate limits, MCP, FAPI partner guide |
| `/developers/reference` | Generated from `/v1/openapi.json` | Try-it against sandbox with `_test_` key |
| `/developers/events` | Generated from `/v1/asyncapi.json` | Event catalogue with schemas and examples |
| `/developers/changelog` | Release notes (`audience: developer`) | Deprecations highlighted with dates |
| `/developers/status` | Link/embed | Status page |
| `/developers/keys` | Link | Deep link into Settings › Integrations › API keys in `apps/web` |
| `/developers/sdks` | Generated | Install snippets, versions |
| `/developers/mcp` | Generated + CMS | Tool catalogue and connection guide |
| `/developers/collections` | Generated | Postman/Bruno collection export |
| `/.well-known/openapi`, `/.well-known/asyncapi` **[REC]** | Redirects | Discovery |

## 10.5 Settings keys

| Key | Tier | Type | Default | Who may change | Maker-checker |
|---|---|---|---|---|---|
| `int.api.default_limit` | PLATFORM | int | 50 | PLT_RELEASE_MANAGER | No |
| `int.api.max_limit` | PLATFORM | int | 500 (ceiling, locked) | — | — |
| `int.api.idempotency_ttl_hours` | PLATFORM | int | 24 (floor) | PLT_RELEASE_MANAGER | No |
| `int.api.key_default_expiry_months` | TENANT | int | 12 (max 24) | ORG_ADMIN | No |
| `int.api.keys_require_ip_allow_list` | TENANT | bool | false | ORG_OWNER | Yes |
| `int.api.mtls_enabled` | TENANT | bool | false | ORG_OWNER | Yes |
| `int.api.fapi2_enabled` | PLATFORM/TENANT | bool | false (`api.oauth.fapi2_profile`) | PLT_SECURITY_OFFICER | Yes |
| `int.api.rfc9421_required` | TENANT | bool | false | ORG_OWNER | Yes |
| `int.api.rate_limit.read_per_min` | PLAN | int | 600 | PLT_SUPER_ADMIN | No |
| `int.api.rate_limit.write_per_min` | PLAN | int | 120 | PLT_SUPER_ADMIN | No |
| `int.api.dual_run_days` | PLATFORM | int | 90 (floor) | PLT_RELEASE_MANAGER | Yes |
| `int.api.sunset_gate_days` | PLATFORM | int | 30 | PLT_RELEASE_MANAGER | No |
| `int.webhooks.enabled` | TENANT | bool | true | ORG_ADMIN | No |
| `int.webhooks.max_endpoints` | PLAN | int | 10 | PLT_SUPER_ADMIN | No |
| `int.webhooks.max_attempts` | PLATFORM | int | 24 | PLT_RELEASE_MANAGER | No |
| `int.webhooks.auto_disable_days` | PLATFORM | int | 7 | PLT_RELEASE_MANAGER | No |
| `int.webhooks.asymmetric` | PLATFORM | bool | false (`webhooks.asymmetric`) | PLT_SECURITY_OFFICER | Yes |
| `int.webhooks.dlq_retention_days` | PLATFORM | int | 30 | PLT_RELEASE_MANAGER | No |
| `int.events.replay_window_days` | PLAN | int | 30 (90 regulated) | PLT_SUPER_ADMIN | No |
| `int.events.catchup_enabled` | TENANT | bool | true | ORG_ADMIN | No |
| `int.connectors.enabled` | TENANT | bool | true | ORG_ADMIN | No |
| `int.connectors.allowed` | TENANT | string[] | all on plan | ORG_OWNER | Yes |
| `int.connectors.require_checker_above` | TENANT | enum | CONFIDENTIAL | ORG_OWNER | Yes |
| `int.sandbox.enabled` | PLAN | bool | true | PLT_SUPER_ADMIN | No |
| `int.sandbox.ai_cost_cap_inr_day` | PLAN | number | 500 | PLT_SUPER_ADMIN | No |
| `ai.mcp.server_enabled` | PLATFORM/TENANT | bool | false | PLT_SECURITY_OFFICER (platform), ORG_OWNER (tenant) | Yes |
| `ai.mcp.write_tools_enabled` | TENANT | bool | false | ORG_OWNER | Yes |
| `ai.mcp.rate_limit.read_per_min` | PLATFORM | int | 120 | PLT_RELEASE_MANAGER | No |
| `ai.mcp.rate_limit.write_per_min` | PLATFORM | int | 20 | PLT_RELEASE_MANAGER | No |
| `int.sdk.publish_enabled` | PLATFORM | bool | true | PLT_RELEASE_MANAGER | No |
| `int.portal.try_it_enabled` | PLATFORM | bool | true (sandbox only, locked) | — | — |

## 10.6 Events and error codes

### 10.6.1 Internal events

| Event | Emitted when |
|---|---|
| `in.<product>.api.KeyCreated.v1` / `.KeyRotated.v1` / `.KeyRevoked.v1` | API key lifecycle (key id, scopes, expiry; never the secret) |
| `in.<product>.api.VersionDeprecated.v1` / `.VersionSunset.v1` | Governance milestones |
| `in.<product>.api.RateLimitExceeded.v1` | Aggregated per key per hour |
| `in.<product>.webhooks.EndpointCreated.v1` / `.Paused.v1` / `.Disabled.v1` | Endpoint lifecycle |
| `in.<product>.webhooks.DeliveryFailed.v1` / `.MovedToDlq.v1` / `.Replayed.v1` | Delivery lifecycle (aggregated for failures) |
| `in.<product>.int.ConnectorInstalled.v1` / `.Configured.v1` / `.Toggled.v1` / `.Uninstalled.v1` / `.Unhealthy.v1` | Connector lifecycle |
| `in.<product>.int.SandboxCreated.v1` / `.Refreshed.v1` | Sandbox lifecycle |
| `in.<product>.mcp.ToolCalled.v1` | Aggregated tool usage (tool, user hash, outcome) |
| `in.<product>.mcp.WriteConfirmed.v1` / `.WriteDeclined.v1` | Confirmation outcomes |
| `in.<product>.events.ReplayRequested.v1` | Catch-up/replay requests |

### 10.6.2 Proposed Ecosystem events

Submitted to the Ecosystem Spec owner for registration under `in.infrabyx.<domain>.<Event>.v1`. Payloads list minimum fields; all carry the standard envelope.

| Proposed event | Domain | Producer(s) | Consumers | Minimum `data` fields | Purpose |
|---|---|---|---|---|---|
| `in.infrabyx.trust.VendorAssuranceDocumentPublished.v1` | trust | OH (OH14.6) | all products | `vad_id`, `title`, `category` (cert/audit/affidavit/DPA/policy), `cadence`, `valid_from`, `valid_until`, `storage_ref`, `hash_sha256`, `visibility` | Products refresh Settings › Security & trust document lists (IPB-D-09) |
| `in.infrabyx.feedback.FeedbackSubmitted.v1` | feedback | all products | OH (product backlog, support) | `fbk_id`, `product`, `tenant_id`, `module`, `flag_key?`, `release?`, `severity`, `category`, `summary`, `attachments_count` | Cross-product backlog and beta programme loop (IPB-09-46) |
| `in.infrabyx.crm.LeadCaptured.v1` | crm | all `apps/public` | OH (OH3 CRM) | `lead_id`, `product`, `brand_id`, `source` (form/chat/pricing/webinar), `consent_ref`, `utm?`, `contact_hash`, `fields_ref` (CONFIDENTIAL fetched via API) | Single CRM intake with consent evidence |
| `in.infrabyx.vidhi.VidhiTaskDelegated.v1` | vidhi | any product's Vidhi | target product / OH | `msn_id`, `from_product`, `to_product`, `task_type`, `tenant_id`, `requested_by`, `autonomy_ceiling`, `due_at`, `inputs_ref` | Cross-product agent delegation with human approval list intact (IPB-D-03) |
| `in.infrabyx.tenancy.WhiteLabelTenantProvisioned.v1` | tenancy | FBX, UDF, OH | OH (billing, CRM, support), DNS_CDN automation | `tenant_id`, `brd_id`, `hosts[]`, `legal_entity_ref`, `plan_id`, `store_identity?`, `email_domain`, `provisioned_by` | Triggers host verification, certificate issuance, billing set-up (IPB-D-10) |
| `in.infrabyx.consent.MarketingConsentUpdated.v1` | consent | all products, OH | OH (marketing), ANALYTICS/TAG_MANAGER gates | `consent_id`, `principal_hash`, `purpose` (marketing_email/sms/whatsapp/analytics), `state` (granted/withdrawn), `channel`, `notice_version`, `occurred_at` | Propagates DPDP consent state group-wide within 60 s (IPB-02-26) |
| `in.infrabyx.messaging.WhatsAppTemplateApproved.v1` | messaging | OH (template registry) / product adapters | all products using the WABA | `template_name`, `waba_id`, `brand_id`, `language`, `category` (marketing/utility/authentication), `status`, `approved_at`, `rejection_reason?` | Shared template status across products on one WABA; cost category for OH8 |
| `in.infrabyx.cms.BlogPostPublished.v1` | cms | all `apps/public` | OH (marketing, social scheduling), sibling products (cross-links) | `pst_id`, `product`, `brand_id`, `title`, `slug`, `url`, `author_type` (staff/user), `tags[]`, `published_at`, `ai_assisted` | Group content calendar and syndication (IPB-D-08) |
| `in.infrabyx.cms.ResourcePublished.v1` | cms | all `apps/public` | OH, LDC (knowledge), sibling products | `res_id`, `product`, `brand_id`, `title`, `type` (guide/template/checklist/whitepaper), `url`, `gated`, `published_at` | Resource library syndication and lead gating |
| `in.infrabyx.eng.ReleaseNotePublished.v1` | eng | all products | OH (group changelog, account managers, status) | `rel_id`, `product`, `version`, `channels[]`, `audiences[]`, `regulatory_tags[]`, `url`, `published_at` | Group-wide release communication (IPB-09-42) |

### 10.6.3 Error codes

| Code | Meaning | HTTP |
|---|---|---|
| `IPB-API-001` | Unsupported API version | 404 |
| `IPB-API-002` | API version sunset | 410 |
| `IPB-API-003` | Invalid API key format | 401 |
| `IPB-API-004` | API key revoked or expired | 401 |
| `IPB-API-005` | Key environment mismatch (test key on live host or vice versa) | 401 |
| `IPB-API-006` | Insufficient scope (required scope named) | 403 |
| `IPB-API-007` | Action not permitted for agent principal | 403 |
| `IPB-API-008` | Source IP not in key allow-list | 403 |
| `IPB-API-009` | mTLS client certificate required or invalid | 401 |
| `IPB-API-010` | Idempotency-Key missing or not UUIDv7 | 400 |
| `IPB-API-011` | Idempotent request in progress | 409 |
| `IPB-API-012` | ETag mismatch | 412 |
| `IPB-API-013` | If-Match required | 428 |
| `IPB-API-014` | Cursor invalid for this query | 400 |
| `IPB-API-015` | Unknown filter/sort/expand field | 400 |
| `IPB-API-016` | Limit exceeds maximum | 400 |
| `IPB-API-017` | FAPI profile violation (PAR/PKCE/DPoP missing) | 400 |
| `IPB-API-018` | HTTP message signature invalid or nonce reused | 401 |
| `IPB-API-019` | Content-Digest mismatch | 400 |
| `IPB-API-020` | Credential scope exceeds the creator's current permissions; excess scope refused | 403 |
| `IPB-API-021` | Scope not grantable to this credential type (`approve`, `delete`, `admin` on an API key or MCP tool) | 422 |
| `IPB-WHK-001` | Endpoint URL blocked (SSRF guard or non-HTTPS) | 422 |
| `IPB-WHK-002` | Event type not permitted for this key/plan | 403 |
| `IPB-WHK-003` | Filter expression invalid | 400 |
| `IPB-WHK-004` | Endpoint disabled after repeated failures | 409 |
| `IPB-WHK-005` | Replay range outside replay window | 400 |
| `IPB-WHK-006` | Endpoint limit reached for plan | 403 |
| `IPB-INT-001` | Connector not available on plan | 403 |
| `IPB-INT-002` | Connector authentication failed | 401 |
| `IPB-INT-003` | Connector data class exceeds manifest maximum | 422 |
| `IPB-INT-004` | Connector residency incompatible with tenant floor | 422 |
| `IPB-INT-005` | Connector manifest invalid | CI |
| `IPB-MCP-001` | MCP server disabled | 503 |
| `IPB-MCP-002` | Tool not exposed | 404 |
| `IPB-MCP-003` | Write tool requires confirmation (token issued) | 202 |
| `IPB-MCP-004` | Confirmation token invalid or expired | 401 |
| `IPB-MCP-005` | Operation on the locked human-approval list exposed as an MCP write tool (lint and runtime refusal) | build / 403 |
| `IPB-EVT-001` | Event type not in catalogue | CI/500 |
| `IPB-EVT-002` | Schema incompatible change without version bump | CI |
| `IPB-EVT-003` | Unregistered Ecosystem event type | CI |

Products re-export as `<PRODUCT>-API-NNN` etc.

## 10.7 Product adoption notes

**LD (LawDocs).** API prefix `ldk_`. Primary resources: documents, versions, templates, envelopes (eSign), stamps. Since LD's eSign is the group's ESIGN adapter, LD publishes a stable `/v1/esign/*` surface with Pact provider tests consumed by all products, and webhooks `in.ld.esign.EnvelopeCompleted.v1` etc. Connectors: Google Drive/OneDrive import-export, Slack/Teams notifications, Tally/Zoho for invoices via OH8.

**LDC (LawDocsComply).** Prefix `ldck_`. Resources: obligations, controls, evidence, filings, entities, registers. Partners (auditors, consultants) use OAuth client credentials with `export` scopes; the SIEM export connector and the AI system register are read via API. LDC publishes the consent-manager-shaped API (IPB-02-26) under `/v1/consent/*` with FAPI 2.0 ready for registered consent managers after 13 Nov 2026 **[VERIFY: technical standards for consent managers under DPDP Rules]**.

**EQ (Equator Resolution).** Prefix `eqk_`. Resources: cases, parties, filings, hearings, awards, panels. Institutional clients (banks, MIIs) may require FAPI 2.0 and mTLS for bulk case filing; `in.eq.cases.*` events drive client case-management systems. Hearing recording access is API-only with REGULATED masking and time-boxed presigned URLs.

**FBX (Finbyx).** Prefix `fbxk_`. `/v1/partner/*` with FAPI 2.0 is mandatory for bank/NBFC co-lending partners, AA FIU flows and ULI gateway integration (`los.data.uli_gateway`); RFC 9421 signatures recommended for disbursement instructions; webhooks for loan lifecycle events never include account numbers. Bureau and bank-statement connectors are product-specific manifests. Regulated plans default to a 90-day replay window and longer dual-run.

**UDF (Udofin).** Prefix `udfk_`. Mostly a consumer of partner APIs (lenders via FBX or external); exposes a small partner surface for LSP reporting to lenders (RBI Digital Lending Directions 2025 reporting needs) and a webhook set for white-label partners (`WhiteLabelTenantProvisioned`). Mobile app uses first-party session tokens only; no API keys in the app bundle.

**OH (Operations Hub).** Prefix `ohk_`. Server side of BILLING (OH8) and CRM (OH3) ports: publishes `in.infrabyx.billing.*` and consumes `LeadCaptured`, `FeedbackSubmitted`, `ReleaseNotePublished`, `VendorAssuranceDocumentPublished` (as producer). Hosts the group developer portal index linking each product's portal. Owns the WhatsApp template registry and emits `WhatsAppTemplateApproved`.

## 10.8 Acceptance tests

```gherkin
@IPB-10-AT-01
Feature: Path versioning and deprecation headers
  Scenario: Deprecated version
    Given /v1 is deprecated with sunset 2027-03-31
    When GET /v1/meta is called
    Then the response includes Deprecation, Sunset: Wed, 31 Mar 2027 00:00:00 GMT and a Link header with rel="deprecation"
  Scenario: Header versioning rejected
    When a request carries Accept-Version: 2 against /v1
    Then the header is ignored and /v1 semantics apply

@IPB-10-AT-02
Feature: OpenAPI generated from Zod
  Scenario: Drift
    Given a Zod schema field renamed without regenerating the snapshot
    When openapi-drift runs
    Then it fails and shows the diff

@IPB-10-AT-03
Feature: Problem details
  Scenario: Validation error
    When POST /v1/documents is sent with an invalid retain_until
    Then the response is 400 application/problem+json with code, help_key, trace_id and errors[0].path "/retain_until"
    And the body contains no stack trace or SQL

@IPB-10-AT-04
Feature: Cursor pagination
  Scenario: Limit cap
    When GET /v1/cases?limit=501
    Then 400 IPB-API-016
  Scenario: Cursor reuse with different filter
    Given a cursor from filter[status]=OPEN
    When it is used with filter[status]=CLOSED
    Then 400 IPB-API-014
  Scenario: Stable iteration
    Given 1,200 cases
    When iterating with limit 500 until has_more is false
    Then exactly 1,200 unique IDs are returned

@IPB-10-AT-05
Feature: Idempotency
  Scenario: Missing key
    When POST /v1/payments/orders without Idempotency-Key
    Then 400 IPB-API-010
  Scenario: Replay
    Given POST with key K body B returned 201 with X-Request-Id R1
    When the same request is repeated within 24 hours
    Then 201 with identical body, Idempotent-Replayed: true and Idempotent-Original-Request-Id R1
  Scenario: Conflict
    When key K is reused with a different body
    Then 409 IPB-PORT-004
  Scenario: Non-UUIDv7
    When Idempotency-Key is a UUIDv4
    Then 400 IPB-API-010

@IPB-10-AT-06
Feature: ETag concurrency
  Scenario: Stale update
    Given a case with ETag "7"
    When PATCH with If-Match "6"
    Then 412 IPB-API-012
  Scenario: Missing precondition
    When PATCH without If-Match
    Then 428 IPB-API-013

@IPB-10-AT-07
Feature: Rate-limit headers
  Scenario: Under limit
    When any authenticated request succeeds
    Then RateLimit and RateLimit-Policy headers are present
  Scenario: Over limit
    When the per-key write limit is exceeded
    Then 429 with Retry-After and problem code IPB-SEC-019

@IPB-10-AT-08
Feature: API keys
  Scenario: Format and environment
    Given key fbxk_test_… 
    When used against api.<host>
    Then 401 IPB-API-005
  Scenario: Scope ceiling
    Given a user with documents.files:read only
    When they create a key requesting documents.files:write
    Then 403 IPB-API-006
  Scenario: Revocation
    Given a key revoked at T
    When it is used at T+1s
    Then 401 IPB-API-004

@IPB-10-AT-09
Feature: Scopes grammar and coverage
  Scenario: Route without scope
    Given a controller route lacking scope metadata
    When scope-coverage runs
    Then it fails naming the route
  Scenario: Agent forbidden action
    Given an agent token with act claim and scope cases.filings:approve granted in error
    When POST /v1/filings/{id}:approve
    Then 403 IPB-API-007

@IPB-10-AT-10
Feature: FAPI 2.0 partner profile
  Scenario: Missing DPoP
    Given api.oauth.fapi2_profile on
    When a partner calls /v1/partner/loans/offers with a bearer token and no DPoP proof
    Then 400 IPB-API-017
  Scenario: Replayed DPoP proof
    Given a valid proof used once
    When it is presented again
    Then 401

@IPB-10-AT-11
Feature: RFC 9421 signatures
  Scenario: Nonce reuse
    Given a signed request with nonce N accepted
    When another request with nonce N arrives within 10 minutes
    Then 401 IPB-API-018
  Scenario: Digest mismatch
    When Content-Digest does not match the body
    Then 400 IPB-API-019

@IPB-10-AT-12
Feature: Standard Webhooks signatures
  Scenario: Valid delivery
    Given endpoint secret whsec_…
    When a DocumentSigned event is delivered
    Then webhook-id, webhook-timestamp and webhook-signature v1 verify with the Standard Webhooks library
  Scenario: Rotation overlap
    Given the secret was rotated 1 hour ago with 24-hour overlap
    Then deliveries carry two v1 signatures and either secret verifies
  Scenario: Old timestamp
    Given a receiver policy of 5 minutes
    When a delivery is replayed by an attacker after 10 minutes
    Then the receiver reference implementation rejects it

@IPB-10-AT-13
Feature: Webhook retries and DLQ
  Scenario: Receiver down
    Given an endpoint returning 503
    When deliveries are attempted
    Then retries follow the schedule with jitter until attempt 24, then the delivery is in DLQ and the tenant is notified
  Scenario: 410 Gone
    When the receiver returns 410
    Then the endpoint is disabled immediately with IPB-WHK-004 on subsequent enable attempts until re-verified
  Scenario: Auto-disable
    Given 7 days of continuous failures
    Then the endpoint state is disabled and EndpointDisabled is emitted

@IPB-10-AT-14
Feature: Webhook SSRF guard
  Scenario: Private URL
    When an endpoint with URL https://10.0.0.5/hook is created
    Then 422 IPB-WHK-001 and no request is made

@IPB-10-AT-15
Feature: Webhook designer
  Scenario: Test and replay
    Given a configured endpoint
    When the user picks CaseFiled and clicks Test
    Then a sample payload is sent, and the response code and timing are shown
    When the user replays a DLQ delivery
    Then a new delivery row appears with attempt 1 and replayed: true in the envelope

@IPB-10-AT-16
Feature: Webhook payload data class
  Scenario: REGULATED field scan
    Given an event schema containing a field tagged REGULATED
    When the AsyncAPI generation runs
    Then it fails IPB-EVT-002 until the field is removed or referenced by ID

@IPB-10-AT-17
Feature: Connector marketplace
  Scenario: Install Slack
    When ORG_ADMIN installs Slack, authorises via OAuth and selects DocumentSigned events
    Then the connector shows healthy, a test message posts, and credentials are stored only in SECRETS_PORT
  Scenario: Data class filter
    Given Slack manifest data_class_max INTERNAL
    When a CONFIDENTIAL event is produced
    Then the Slack delivery carries only INTERNAL summary fields and a link
  Scenario: Uninstall
    When the connector is uninstalled
    Then the OAuth grant is revoked, credentials deleted, and the ledger records the uninstall

@IPB-10-AT-18
Feature: Sandbox tenant and test keys
  Scenario: Isolation
    Given a sandbox tenant with a _test_ key
    When a payment order is created
    Then the fake PAYMENTS adapter responds and no live PA call is made
    And webhooks from the sandbox carry webhook-environment: test

@IPB-10-AT-19
Feature: SDK generation
  Scenario Outline: Smoke
    Given the generated <language> SDK for the current OpenAPI
    When it lists cases with pagination and verifies a webhook sample
    Then both succeed against the preview environment
    Examples:
      | language |
      | TypeScript |
      | Python |
      | Java |

@IPB-10-AT-20
Feature: MCP exposure
  Scenario: Catalogue
    Given ai.mcp.server_enabled on
    When GET /v1/mcp/tools
    Then every GET operation with x-mcp.expose is listed, no approve/delete/admin operation is present, and each tool shows its scope
  Scenario: Write confirmation
    Given ai.mcp.write_tools_enabled on
    When a client calls the create_note tool
    Then the result is confirmation_required with a summary and a token
    When the client calls again with the token within 5 minutes
    Then the note is created under the user's identity with act claim and the ledger shows the agent client
  Scenario: Scope and RLS through MCP
    Given a user without cases.cases:read
    When the client calls list_cases
    Then the tool returns 403 IPB-API-006

@IPB-10-AT-21
Feature: CloudEvents envelope and outbox
  Scenario: Transactional publish
    Given a mutation that fails after writing the outbox row
    When the transaction rolls back
    Then no event is published
  Scenario: Duplicate delivery
    Given consumer C processed event E
    When E is delivered again
    Then the inbox prevents reprocessing and the handler is not invoked

@IPB-10-AT-22
Feature: Catch-up and replay window
  Scenario: Catch-up
    Given 50 events since cursor X
    When GET /v1/events?since=X&limit=100
    Then 50 events in id order are returned
  Scenario: Outside window
    When replay is requested for 40 days ago on a 30-day plan
    Then 400 IPB-WHK-005

@IPB-10-AT-23
Feature: Breaking-change detection and sunset gate
  Scenario: Field removal
    Given a PR removing a response field from /v1
    When breaking-change-detector runs
    Then it fails and requires a /v2 path with dual-run plan
  Scenario: Sunset blocked by usage
    Given a key used /v1 3 days ago
    When sunset is executed on the sunset date
    Then the job refuses and extends the sunset with a ledger entry

@IPB-10-AT-24
Feature: Ecosystem event registry
  Scenario: Improvised cross-product event
    Given code emitting in.infrabyx.cases.CaseFiled.v1 not in the Ecosystem Spec registry
    When the event catalogue lint runs
    Then it fails IPB-EVT-003

@IPB-10-AT-26
Feature: API key scope escalation is impossible
  Scenario: Key asks for more than its creator holds
    Given ORG_MEMBER M holds documents.files:read only
    When M creates an API key requesting documents.files:write
    Then the response is 403 IPB-API-020 and no key is stored
  Scenario: Approve scope on a key
    Given ORG_OWNER O
    When O creates an API key with scope workflows.approvals:approve
    Then the response is 422 IPB-API-021
  Scenario: Creator demoted after key issued
    Given key K was created by M with documents.files:write
    When M is demoted to a role without documents.files:write
    Then the next call with K using that scope returns 403 IPB-API-020
    And the key's stored scopes are shrunk and the owner notified

@IPB-10-AT-25
Feature: Developer portal
  Scenario: Reference renders live document
    When /developers/reference loads
    Then it renders from /v1/openapi.json and Try-it only accepts _test_ keys against api-sandbox
```

## 10.9 Open items

| ID | Item | Owner | Flag (default OFF) |
|---|---|---|---|
| IPB-OI-10-01 | Confirm status of the IETF RateLimit header fields draft (RFC number if published) and finalise header names. **[VERIFY]** | PLT_RELEASE_MANAGER | `api.ratelimit.ietf_final` |
| IPB-OI-10-02 | SDK generator choice (OpenAPI Generator vs Speakeasy vs Fern) and publishing accounts (npm/PyPI/Maven). **[OWNER]** | PLT_RELEASE_MANAGER | `int.sdk.publish_enabled` |
| IPB-OI-10-03 | Ecosystem Spec owner to register the ten proposed events in 10.6.2 and confirm domain names (`trust`, `feedback`, `crm`, `vidhi`, `tenancy`, `consent`, `messaging`, `cms`, `eng`). **[OWNER]** | Ecosystem Spec owner | `events.ecosystem.proposals_v1` |
| IPB-OI-10-04 | Technical standards for registered consent managers under DPDP Rules 2025 (API shape, Rule 4 schedule) for LDC's consent API. **[VERIFY] [COUNSEL]** | LDC lead | `privacy.dpdp.consent_manager_api` |
| IPB-OI-10-05 | FAPI 2.0 conformance suite run and certification listing before the first bank partner. **[VERIFY]** | FBX lead | `api.oauth.fapi2_profile` |
| IPB-OI-10-06 | ed25519 (`v1a`) webhook signatures: offer by default or on request. **[OWNER]** | PLT_SECURITY_OFFICER | `webhooks.asymmetric` |
| IPB-OI-10-07 | MCP spec version to target (2026-07-28 stateless) and OAuth 2.1 server choice (Keycloak capability check). **[VERIFY]** | PLT_RELEASE_MANAGER | `ai.mcp.server_enabled` |
| IPB-OI-10-08 | A2A Agent Card publication for Vidhi (`ai.a2a.agent_card`) once agent identity standards settle (expected 2027). **[VERIFY]** | AI lead | `ai.a2a.agent_card` |
| IPB-OI-10-09 | Zoho Books India data-centre confirmation and Tally connector mechanism (XML export vs TallyPrime connector). **[VERIFY]** | OH lead | `int.connectors.zoho_books` |
| IPB-OI-10-10 | Whether `/v1/events` catch-up is available on all plans or regulated/enterprise only. **[OWNER]** | Owner | `int.events.catchup_all_plans` |
| IPB-OI-10-11 | OpenAPI 3.2 adoption once tooling (generators, portal renderer) supports it; stay on 3.1 until then. **[VERIFY]** | PLT_RELEASE_MANAGER | `api.openapi_32` |
