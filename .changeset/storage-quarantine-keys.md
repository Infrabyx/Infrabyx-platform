---
"@infrabyx/contracts": minor
"@infrabyx/connectors": minor
"@infrabyx/testing": minor
---

Named tenant keys in QUARANTINE (Udofin PR-UDF-066; R1-D-240). `contracts`: `NAMED_KEY_CLASSES` now includes `QUARANTINE`, so a lender's upload can be written under the lender's key (by `keyRef` or a prefix map) before its scan; `AUDIT`, `GENERAL` and `PUBLIC_ASSETS` still refuse a reference. New `promotedObjectMeta(from, to)` carries the reference into the clean write after the scan, so the copy is under that reference's key at the clean location or refused, never under the clean class's key. `connectors`: the `s3` adapter applies the same separation rules in `QUARANTINE`; the AV adapter's workload needs `kms:Decrypt` on each such key, and a read it may not decrypt keeps the file quarantined (`ERROR`). `testing`: a STORAGE built-in contract case for the upload and its promotion. No setting, no migration, no IAM change.
