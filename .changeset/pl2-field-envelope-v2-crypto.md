---
"@infrabyx/crypto": minor
---

Field-encryption format v2 (PL2-D-50): `FieldEnvelope.seal/open` take the C-14 context `{ tenant_id, purpose }`, wrap every data key under it and cache keys per tenant and purpose; v1 stays readable and `rewrapToV2` re-wraps a v1 data key without changing the field ciphertext. `encodeKmsContext`, `decodeKmsContext`, `assertKmsContext`; `LocalKms.generateDataKey` requires a valid context. Also fixes a flaky tamper step in the C-11 differential test.
