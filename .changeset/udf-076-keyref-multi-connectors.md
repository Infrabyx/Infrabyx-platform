---
"@infrabyx/connectors": minor
---

`S3Storage.keyRefStatuses(tenantId, keyRef, { bucketClasses, compartment?, describeKey? })` (Udofin PR-UDF-076; R1-D-261): each class by `keyRefStatus`'s checks; with `describeKey`, one read-only KMS `DescribeKey` per distinct key id the classes resolve to, `AccessDeniedException` answering `storage_key_not_described` (a missing, unshared or unusable key stays `storage_key_unavailable`), and any other KMS failure throwing `IPB-PORT-002` for the whole call, without the key id. A malformed class list, compartment or tenant is refused `IPB-PORT-003`; a class without a bucket `IPB-PORT-001`. `keyRefStatus` is unchanged. `minio` declares `keyRefStatuses` `unsupported` (after the same format checks).
