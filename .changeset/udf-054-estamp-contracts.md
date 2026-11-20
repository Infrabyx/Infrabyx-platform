---
"@infrabyx/contracts": minor
---

PR-UDF-054 (E8; R1-D-245): recording a stamp the regulated entity already paid for. Additive: no existing field, type or export changes shape, and existing ESTAMP adapters and fakes compile unchanged.

- **`EstampPort.recordCertificate?(req, idempotencyKey, call?)`** (optional; `capabilities.recordCertificate`): records an e-stamp certificate, a franking impression or physical stamp paper bought through the RE's own channel. Not a money call: nothing is bought, and an adapter that offers it refuses `purchase` with the fixed label `STAMP_PURCHASE_NOT_PERMITTED` (`purchase_not_permitted`).
- **`StampCertificateRecord`** (strict, REGULATED): `channel` (`STAMP_RECORD_CHANNELS`: `E_STAMP`, `FRANKING`, `PHYSICAL_PAPER`, the evidence's names), `state`, `instrument` (the Stamp Act article), `certificateNumber` (`StampCertificateNumber`, the evidence's rule), `dutyMinor`, `statedDutyMinor?` (the duty paid is never less), `issuedAt`, `purchaser`, `stampedDocument`, `certificateDocumentId?`, `vendorLicence?`, `vendorCertificateId?` and `recordedBy` (`StampRecorder`: a user or a service, never an agent). Paper and franking require the licence and the scanned certificate. `StampRecordKey` is the idempotency-key rule, and `assertStampRecord(port, raw, key, adapter?)` the first check of every adapter and fake: an agent recorder `IPB-SEC-004`, deficient stamping `IPB-PORT-001` `deficient_stamping`, anything else malformed `IPB-PORT-001` `invalid_request`.
- **`EstampCertificate`** gains optional `channel`, `statedDutyMinor`, `stampedDocumentSha256`, `certificateDocumentId`, `vendorLicence`, `vendorCertificateId` and `verification` (`STAMP_VERIFICATIONS`: `ISSUER_READBACK`, `MANUAL_RECORD`, usable as `EStampCompleted.stamp_verification_method`).
- **`stampEvidenceOf(cert)`** (`@infrabyx/contracts/events`): a recorded certificate as the pack's `PackStampEvidence` (State `MH` becomes `IN-MH`), parsed, so incomplete or deficient evidence throws.
