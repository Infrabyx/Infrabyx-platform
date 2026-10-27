---
"@infrabyx/connectors": minor
---

PAYMENTS adapters `razorpay` (reference) and `cashfree` (alternative), test mode only, on the approved locked list P-01 to P-18 (PL2-D-66): live credentials refused outside prod/dr, exact integer paise, references derived from the idempotency key with vendor lookup, refunds gated by an approved R3 request and read against the PA's refund list, `kill.payments`, raw-body webhook signatures, read-only reconciliation. Router: `noFailover` method specs and `router.portFor(port, adapter)` so refunds, mandates and captures stay with their PA (P-08). Subpath `@infrabyx/connectors/payments`; P-18 manifests in `marketplace/`.
