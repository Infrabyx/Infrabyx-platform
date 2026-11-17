---
"@infrabyx/testing": patch
---

`TEST_IMAGES.pgvector` (and `startPostgres`'s fallback, `PG_TEST_IMAGE`) moves to `pgvector/pgvector:0.8.6-pg18` (pinned by digest, pushed 13 Aug 2026), with CI's integration services and the Compose database (R1-D-169). pgvector 0.8.2 to 0.8.6 are fixes only, among them a buffer overflow in parallel HNSW index builds (0.8.2) and possible HNSW index corruption during vacuum (0.8.3).
