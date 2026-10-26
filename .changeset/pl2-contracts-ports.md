---
"@infrabyx/contracts": minor
---

PL2 session 1: port interfaces for AUTHZ, QUEUE, WORKFLOW, EMAIL, SMS, WHATSAPP, PAYMENTS and
OBSERVABILITY and the full IDENTITY interface; `PortCall`, capability flags and idempotency lookup;
payload data-class annotations with `effectiveDataClass` (a caller may only raise the port default,
PL2-D-03); delivery-recipient fields (IPB-DEV-05); integer-only paise/decimal conversion (P-04);
the `provider_routing` schema and `checkRouting` (IPB-01 §01.4.5: secrets paths, residency,
tighten-only policy, recipient delivery, unproven adapters refused in staging and above); the
IPB-10 connector manifest schema with the P-18 settlement rule; provider-routing event payloads.
