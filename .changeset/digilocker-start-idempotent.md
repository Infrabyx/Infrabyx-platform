---
"@infrabyx/contracts": minor
"@infrabyx/fakes": minor
"@infrabyx/testing": minor
"@infrabyx/connectors": minor
---

DigiLocker start, document evidence and idempotent pulls (Udofin PR-UDF-040; R1-D-193). `KycPort.startDigilocker({ docTypes, returnUrl }, call)` returns `{ consentSession, signInUrl, expiresAt }` with the evidence; optional on the interface, provided by `FakeKyc`, `DigioKyc` and `kycMethodRouter`, refused `unsupported` by `IdfyKyc`. The return address must pass `digilockerReturnUrlAllowed` (`https:`, no user information, no 12-digit run, a host on the adapter's `digilockerReturnHosts`), else `return_url_not_allowed`. `DigilockerDocument` gains `evidence` and `signatureValid` (`null` when the vendor does not report it). `digilockerPull` is idempotent on `call.idempotencyKey` for 24 hours: a retry returns the stored documents instead of `consent_used`, the same key with another session or other types is `IPB-PORT-004`. `connectors` adds `DigilockerPullStore`, `PgDigilockerPullStore` and `MemoryDigilockerPullStore` and the migration `0010_kyc_digilocker_pull.sql` (`connectors.kyc_digilocker_pull`, forced RLS); the Digio stub gains the start and `completeDigilocker`; `kycContractCases` gains three cases and `KycFixtures.digilockerReturnUrl`.
