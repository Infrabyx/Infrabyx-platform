---
"@infrabyx/contracts": minor
---

PR-FBX-57 (R1-D-304): `ScanRecord`, `scanRecordOf` and `SCAN_TAGS` in the FILE_SCAN port. `BureauFileRef` and `FiPayload` gain an optional `scan: ScanRecord`, the AV scan that released the file; check it with `assertScannedClean(ref.scan, ref.sha256, port)` before parsing. Optional in 1.x so a stored ref from before still parses; the platform's adapters always set it. Whole-object assertions on a bureau report or FI payload now see `scan`.
