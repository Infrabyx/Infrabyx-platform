---
"@infrabyx/testing": minor
---

Udofin PR-UDF-080 (R1-D-269): `storageIntegrityContractCases({ tamper, outage, tenantId? })` (`StorageIntegrityFixture`): STORAGE contract cases that a tampered object is `IPB-STOR-005` `hash_mismatch` (a 500 without a retry hint, no bytes, a fixed detail without the key, tenant, bucket or a hash, and an untouched object still reads) and that a store that cannot be read is `IPB-PORT-002`. Run on `MemoryStorage` (through its new `readError` option, re-exported type `MemoryStorageOptions`) and on the `s3` and `minio` legs; run them against your own STORAGE fixture so it cannot pass what the `s3` adapter refuses.
