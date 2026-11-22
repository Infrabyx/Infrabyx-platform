---
"@infrabyx/fakes": minor
---

Udofin PR-UDF-080 (R1-D-269): `MemoryStorage` takes `MemoryStorageOptions` (the named-key options plus `readError(key)`): `"integrity"` makes `get` and `replicateTo` throw `IPB-STOR-005` with `meta.reason: "hash_mismatch"` for an existing object, as the `s3` adapter does for a tampered object; `"unavailable"` makes `get` throw `IPB-PORT-002` before the lookup. Opt-in: without it nothing changes, and editing `objects` directly is still not detected. `FakeFileScan` answers `ERROR` `hash_mismatch` (was `unavailable`) when STORAGE refuses the read for integrity, as `clamav` does.
