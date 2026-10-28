# @infrabyx/trust

## 0.1.1

### Patch Changes

- Updated dependencies [9d8cd8c]
- Updated dependencies [b3934f9]
  - @infrabyx/tenancy@0.6.0
  - @infrabyx/config@0.5.1
  - @infrabyx/ai@0.2.1

## 0.1.0

### Minor Changes

- 275d4ba: The trust package (PL5 session 6), with migration `trust/0001_init.sql` (run `infrabyx-migrate`; it creates the `svc_trust_sweep` reader role).

  - **Mirror:** `TrustMirror` consumes `VendorAssuranceDocumentPublished` and `StateChanged` into a read-only mirror (only the mirror consumer may write it). Each version moves ANNOUNCED → FETCHED → VERIFIED → VISIBLE. A digest mismatch keeps the previous version visible and raises `IPB-TRUST-009`; WITHDRAWN hides a version at once. `reconcile()` runs daily and `staleness()` gives the "as of" label.
  - **Tenant room:** `TrustRoom` lists documents, records NDA acceptance (`NdaAccepted`), acknowledgements, public downloads with the delivered digest, requests with their SLA, and subscriptions. Gated downloads answer `IPB-TRUST-012` until watermarking exists (#44).
  - **Trust Centre:** `trustCentre()` shows only certifications actually held, the fallback wording for lapsed claims, planned items with a quarter and no badge, and public documents. `securityTxt()` writes RFC 9116.
  - **Sweep:** `TrustSweep.tick()` flags request SLA breaches (`IPB-TRUST-014`) and retries hand-offs; `purge()` deletes acknowledgements 10 years after their version ended, never under legal hold (#48); `legalHold()` is for PLT_LEGAL_REVIEWER.

### Patch Changes

- Updated dependencies [de53086]
- Updated dependencies [de53086]
- Updated dependencies [de53086]
- Updated dependencies [f1a36a1]
- Updated dependencies [1fecf45]
- Updated dependencies [1fecf45]
- Updated dependencies [b0dc390]
- Updated dependencies [b0dc390]
- Updated dependencies [b0dc390]
- Updated dependencies [275d4ba]
- Updated dependencies [934355c]
- Updated dependencies [686d24b]
- Updated dependencies [686d24b]
- Updated dependencies [e8e83cb]
- Updated dependencies [275d4ba]
- Updated dependencies [36338c3]
- Updated dependencies [934355c]
- Updated dependencies [b7de3c6]
- Updated dependencies [e8e83cb]
- Updated dependencies [275d4ba]
  - @infrabyx/ai@0.2.0
  - @infrabyx/config@0.5.0
  - @infrabyx/contracts@0.5.0
  - @infrabyx/tenancy@0.5.0
  - @infrabyx/crypto@0.4.1
