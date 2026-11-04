---
"@infrabyx/connectors": minor
---

The Operations Hub provisioning adapter's request half and failure path (Ecosystem Spec v1.3; PR-LDC-11, M38; R1-D-70): `request()` writes `ProvisioningRequested` to the product's outbox, idempotent on the request id; `signForDelivery()` signs it at delivery; `receive()` and `drain()` take `ProvisioningFailed` once per request (one outcome per request), refuse personal data in `detail`, and hand it to `onFailed` with the 30-day purge deadline.
