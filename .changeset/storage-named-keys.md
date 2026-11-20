---
"@infrabyx/contracts": minor
"@infrabyx/connectors": minor
"@infrabyx/fakes": minor
"@infrabyx/testing": minor
---

STORAGE puts under a named tenant key (Udofin PR-UDF-058; R1-D-227), so a vault keeps each lender's files under that lender's own KMS key. `contracts/ports`: optional `ObjectMeta.keyRef` and `PresignOptions.keyRef` (a reference such as `lender:<id>`, never a key id), `isValidStorageKeyRef`, `NAMED_KEY_CLASSES` (`CONFIDENTIAL`, `REGULATED`), `STORAGE_KEY_REF_META`, `STORAGE_KEY_REF_REFUSALS` and `resolveStorageKeyRef`. `connectors`: `S3StorageOptions.tenantNamedKmsKeyIds` and `tenantKeyRefPrefixes`; a named write is encrypted under the resolved key, records the reference (`get` returns `meta.keyRef`), and is refused (never sent under the class key) for an unknown, malformed, misplaced, shared or changed reference or for a tenant with its own CMK; a disabled or revoked named key reads as `IPB-KMS-001` `storage_key_unavailable` (failures of objects under platform keys are unchanged); `minio` refuses a reference as `unsupported`. `fakes`: `MemoryStorage(now, { keyRefs, keyRefPrefixes })` records the reference (none known by default). `testing`: a built-in STORAGE contract case for named keys; a STORAGE adapter outside the platform either configures `lender:contract` and `lender:contract-b` for tenant `tnt_contract` in `REGULATED` in its contract leg or declares `put.keyRef` unsupported. Writes without a reference are unchanged.
