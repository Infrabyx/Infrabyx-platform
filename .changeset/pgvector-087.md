---
"@infrabyx/testing": patch
---

`PG_TEST_IMAGE` / `TEST_IMAGES.pgvector` move to `pgvector/pgvector:0.8.7-pg18` (pinned by digest; PostgreSQL 18, pgvector 0.8.7), the same image CI's integration jobs and the Compose stack now use (R1-D-277). Products should run pgvector 0.8.2 or later, as before.
