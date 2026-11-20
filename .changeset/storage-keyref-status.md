---
"@infrabyx/contracts": minor
"@infrabyx/connectors": minor
"@infrabyx/fakes": minor
"@infrabyx/testing": minor
---

Named tenant key status (Udofin PR-UDF-068; R1-D-239). `contracts`: optional `StoragePort.keyRefStatus(tenantId, keyRef, { bucketClass, compartment?, describeKey? })` answering `{ status: "resolves", keyState? }` or `{ status: "refused", reason, keyState? }` with a write's refusal label or `storage_key_unavailable`, never a key id; `STORAGE_KEY_STATES`, `STORAGE_KEY_UNAVAILABLE`, `isValidStorageTenantId` and `storageKeyRefStatusRefusal`. `connectors`: `S3Storage.keyRefStatus` runs the write's own checks and, with `describeKey`, one read-only KMS `DescribeKey` (a key that is not `Enabled`, or that the role may not describe, answers `storage_key_unavailable`); `MinioStorage` declares it `unsupported`. `fakes`: `MemoryStorage.keyRefStatus` and a `keyStates` option. `testing`: a STORAGE built-in contract case. Read-only, not ledgered; no setting, no migration.
