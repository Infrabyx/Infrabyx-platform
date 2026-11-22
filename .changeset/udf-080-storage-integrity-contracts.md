---
"@infrabyx/contracts": minor
---

Udofin PR-UDF-080 (R1-D-269): a STORAGE integrity mismatch has its own error code. New catalogue entry `IPB-STOR-005` "Stored object failed its integrity check; read refused" (500, help key `hlp.int.storage_integrity`; registration in IPB-01 §01.6.3 asked in PR-050), with `STORAGE_INTEGRITY_ERROR`, `STORAGE_HASH_MISMATCH` (`"hash_mismatch"`, its `meta.reason`) and `isStorageIntegrityError(e)` in `@infrabyx/contracts/ports`. `StoragePort.get` now documents both failures: bytes that do not match the SHA-256 recorded at write, or a checksum the store returns that disagrees with them, are `IPB-STOR-005`; an outage is `IPB-PORT-002`; neither returns bytes. The PDF port's note says `extractText` passes the integrity failure on as `IPB-STOR-005`. `toProblem` carries the code and the `hash_mismatch` label unchanged, with no `retry_after_seconds`.
