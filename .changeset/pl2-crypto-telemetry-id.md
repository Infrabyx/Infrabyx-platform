---
"@infrabyx/crypto": minor
---

`telemetryIdHasher` and `deriveSubKey`: HKDF-SHA-256 sub-key under `ipb/telemetry-id/v1` and
HMAC-SHA-256 truncated to 128 bits for tenant, user and flag-context IDs in telemetry (C-21,
PL2-C-04).
