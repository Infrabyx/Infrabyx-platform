---
"@infrabyx/tenancy": minor
---

`FieldCrypto` seals with envelope format v2 under `{ tenant_id, purpose: "field" }` (PL2-D-50), adds `rewrapField` and `formatVersion`; v1 fields stay readable.
