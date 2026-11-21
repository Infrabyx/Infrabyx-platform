---
"@infrabyx/contracts": minor
---

`StoragePort.keyRefStatuses?(tenantId, keyRef, { bucketClasses, compartment?, describeKey? })`: `keyRefStatus` for one to six classes in one call, answered per class (`StorageKeyRefStatuses`), with one `DescribeKey` per distinct key; `STORAGE_KEY_NOT_DESCRIBED` (`storage_key_not_described`) for a key the role may not describe; `StorageKeyRefStatusesReason`, `StorageKeyRefClassStatus`, `StorageKeyRefStatusesOptions`, `keyRefStatusClasses()` and `MAX_KEY_REF_STATUS_CLASSES` (Udofin PR-UDF-076; R1-D-261).

**Not breaking.** The new label is only in the new method's answer type: `StorageKeyRefStatus` and `StorageKeyRefStatusReason` are unchanged, and `keyRefStatus` still answers `storage_key_unavailable` for a key it may not describe (R1-D-239, #171 (1)). Adding the member to the existing union would have been type-compatible for most code but would break an exhaustive `switch` on `reason` and change what a consumer that tests for `storage_key_unavailable` sees, so that change is left for a major. A consumer of `keyRefStatuses` that branches on `reason` must handle `storage_key_not_described` (status `refused`, as before).
