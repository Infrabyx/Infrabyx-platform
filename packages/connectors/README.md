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

## Migrations

`migrations/0001_init.sql`: schema `connectors` with `idempotency_record` (RLS forced, tenant policy). `infrabyx-migrate` applies it after seed whenever this package is installed (PL2-D-34), so a product keeps one migrate command.
