---
"@infrabyx/fakes": minor
---

`MemoryStorage.keyRefStatuses` and the `keyStateError(tenantId, keyRef)` option (Udofin PR-UDF-076; R1-D-261): `"unavailable"` makes the key-state read (`describeKey`) of that reference throw `IPB-PORT-002`, from `keyRefStatus` and `keyRefStatuses`; `"not_described"` answers `storage_key_not_described` from `keyRefStatuses` and `storage_key_unavailable` from `keyRefStatus`, as the `s3` adapter does. Without the option nothing changes.
