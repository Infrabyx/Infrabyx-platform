---
"@infrabyx/fakes": minor
---

`FakeFileTransfer` (`fake-file-transfer`), the in-memory FILE_TRANSFER server and the CI-green alternative to the `sftp` adapter (Udofin PR-UDF-071; R1-D-254, ADR-0014), with `FakeFileTransferOptions`, `FileTransferFixtures` and `fileTransferFakeFixtures`. It keeps the port's rules: the path rule, the class (REGULATED at least, never SECRET), the `get` cap, no overwrite (`exists`), `not_found` (a put into a missing directory included), `not_a_file`, the list cap, an `enabled` switch and the abort signal; `seed`, `mkdir`, `freshDir` and `stored` for tests. Nothing existing changes.
