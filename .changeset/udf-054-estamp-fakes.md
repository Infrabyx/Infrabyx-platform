---
"@infrabyx/fakes": minor
---

PR-UDF-054 (E8; R1-D-245): `FakeEstamp.recordCertificate` records a stamp bought outside the platform, with the shared `assertStampRecord` check, once per idempotency key and a certificate number once per State and channel (`IPB-PORT-004`, `certificate_reused`); `verify` and `attach` work on recorded certificates as on bought ones. Additive; `purchase` and DDE are unchanged.
