---
"@infrabyx/connectors": minor
"@infrabyx/testing": minor
"@infrabyx/config": minor
---

The DEVICE_ATTESTATION reference adapter `native` (Udofin PR-UDF-028; owner answer #99; R1-D-59). Exported from `@infrabyx/connectors/device-attestation`:

- **Play Integrity:** `decodeIntegrityToken` with a C-24 token, the binding, package, signing certificate, licence, device level and age checked, and each token used once.
- **App Attest:** verified locally with C-27; a key registers once.

Both halves are off behind `int.device_attestation.play_integrity.enabled` and `int.device_attestation.app_attest.enabled` (`config`). `testing`: `startPlayIntegrityStub`, `nativeDeviceEvidence`, and `DeviceEvidence`, the minter the contract cases now take, so they run on `native` and on the fake. Exit map and port matrix: `DEVICE_ATTESTATION`.
