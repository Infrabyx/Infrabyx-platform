---
"@infrabyx/connectors": minor
---

Udofin PR-UDF-080 (R1-D-269), **behaviour visible:** `S3Storage.get` (`s3` and `minio`) now throws `IPB-STOR-005` (500, `meta.reason: "hash_mismatch"`, fixed detail, no key, bucket, hash or cause) where it threw `IPB-PORT-002` (503) for bytes that do not match the SHA-256 recorded in the object's metadata; the SDK's response checksum mismatch (`Checksum mismatch`), which surfaced as a generic `IPB-PORT-002` read failure, is now `IPB-STOR-005` too. An outage stays `IPB-PORT-002`; neither returns bytes. The router's breaker does not count `IPB-STOR-005`, so a read of a tampered object is not failed over to the replica. `pdf-text` `extractText` passes the integrity failure on as `IPB-STOR-005` `hash_mismatch` (was `IPB-PORT-002` `unavailable`), and `clamav` answers `ERROR` `hash_mismatch` for it (was `unavailable`). Catch the new code, do not retry it, and alert on it as a possible tamper (guide §7ep).
