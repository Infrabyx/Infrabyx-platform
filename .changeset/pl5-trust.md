---
"@infrabyx/trust": minor
---

The trust package (PL5 session 6), with migration `trust/0001_init.sql` (run `infrabyx-migrate`; it creates the `svc_trust_sweep` reader role).

- **Mirror:** `TrustMirror` consumes `VendorAssuranceDocumentPublished` and `StateChanged` into a read-only mirror (only the mirror consumer may write it). Each version moves ANNOUNCED → FETCHED → VERIFIED → VISIBLE. A digest mismatch keeps the previous version visible and raises `IPB-TRUST-009`; WITHDRAWN hides a version at once. `reconcile()` runs daily and `staleness()` gives the "as of" label.
- **Tenant room:** `TrustRoom` lists documents, records NDA acceptance (`NdaAccepted`), acknowledgements, public downloads with the delivered digest, requests with their SLA, and subscriptions. Gated downloads answer `IPB-TRUST-012` until watermarking exists (#44).
- **Trust Centre:** `trustCentre()` shows only certifications actually held, the fallback wording for lapsed claims, planned items with a quarter and no badge, and public documents. `securityTxt()` writes RFC 9116.
- **Sweep:** `TrustSweep.tick()` flags request SLA breaches (`IPB-TRUST-014`) and retries hand-offs; `purge()` deletes acknowledgements 10 years after their version ended, never under legal hold (#48); `legalHold()` is for PLT_LEGAL_REVIEWER.
