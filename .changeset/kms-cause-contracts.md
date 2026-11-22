---
"@infrabyx/contracts": minor
---

AV: a new scan error reason `storage_key_unavailable` (the file's named STORAGE key is disabled, deleted or no longer granted, `IPB-KMS-001`), told apart from an outage (`unavailable`); still `ERROR`, so the file stays quarantined. `scanReasonOfReadError(e)` maps a failed STORAGE read to its scan reason (`IPB-STOR-005` → `hash_mismatch`, `IPB-KMS-001` → `storage_key_unavailable`, anything else → `unavailable`). R1-D-276.
