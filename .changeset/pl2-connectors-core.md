---
"@infrabyx/connectors": minor
---

First release:

- the provider_routing runtime: router, circuit breaker, health registry, HTTPS egress client,
  idempotency store with pending records and vendor lookup, and inbound-webhook helpers;
- the `connectors` schema migration;
- the OBSERVABILITY `otel` adapter, with the IPB-02-23 scrubber and two exporter profiles;
- the FEATURE_FLAG `unleash` adapter (with registry sync) and the `config-db` alternative.
