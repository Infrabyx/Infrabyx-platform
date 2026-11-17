---
"@infrabyx/contracts": minor
"@infrabyx/connectors": minor
"@infrabyx/testing": minor
"@infrabyx/config": minor
---

Storage compartments (PR-LDC-60): `ObjectMeta.compartment` (`BOARD_CONFIDENTIAL`, `SEALED`) within `CONFIDENTIAL` or `REGULATED`. The S3 and MinIO adapters write each compartment to its own bucket under its own SSE-KMS key (platform or tenant CMK) and refuse a missing or shared bucket or key; `int.storage.bucket.{class}.{compartment}`; `MemoryStorage` keeps the compartment.
