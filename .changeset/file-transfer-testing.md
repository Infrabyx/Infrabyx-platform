---
"@infrabyx/testing": minor
---

FILE_TRANSFER contract cases (Udofin PR-UDF-071; R1-D-254, ADR-0014): `fileTransferContractCases(fixtures)` (put and get the same bytes and SHA-256, list with sizes, sorted and capped; `exists` with the first bytes kept; `too_large` past the cap; `not_found`, `not_a_file`; invalid paths, a SECRET or lowered class, no `ifAbsent` and an aborted call refused with nothing written; no refusal carrying a host key, key or address), `expectFileTransferRefusal`, `fileTransferName`, `fileTransferBytes`, and `startSftpServer()` for adapters' hermetic legs (the pinned `TEST_IMAGES.sftp`, `atmoz/sftp` with OpenSSH 10.3p1, with a host key and an authorised client key generated per run). Re-exports `FakeFileTransfer`, `fileTransferFakeFixtures` and their types. The ESLint plugin lists `ssh2` and `ssh2-sftp-client` as vendor libraries (connectors only) and `FILE_TRANSFER` in `PORT_DEFAULTS` (REGULATED).
