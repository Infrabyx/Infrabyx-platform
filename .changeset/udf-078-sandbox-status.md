---
"@infrabyx/connectors": minor
---

Udofin PR-UDF-078 (R1-D-268; IPB-DEV-04 gate B): `sandbox-status.json` lists every adapter this package publishes. Sixteen are added under `adapters`, each `unproven`: `nsdl-esign`, `nesl-dde`, `shcil-estamp`, `digio-estamp` and `manual-paper` (beside `leegality` and `digio`), and `digio-mandate`, `idfy-kyc`, `cibil`, `setu-aa`, `http-statement`, `generic-grc`, `sftp`, `tallyprime`, `native`, `turnstile` and `hcaptcha`; each names `offBy`, the settings (off by default) that keep it off, until its port-contract issue is opened. A new `hermetic` map lists the 29 self-hosted, in-process and composite adapters (with port and kind); the routing check does not read it. Behaviour visible: `infrabyx-routing check --sandbox-status` now refuses those sixteen in staging, pre-prod, prod and dr (`IPB-PORT-005`); keep them in dev and test routing files. A unit test fails when an adapter is published without an entry. No code path, setting or migration changes.
