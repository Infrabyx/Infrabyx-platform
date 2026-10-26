// @infrabyx/connectors — vendor adapters behind the IPB-01 ports, one folder per port, and the
// provider_routing runtime (router, circuit breaker, health, egress, idempotency, webhooks).
// Adapters are subpath exports loaded only when routing selects them (plan §3.10).
export const PACKAGE_NAME = "@infrabyx/connectors" as const;
export * from "./core/index.js";
