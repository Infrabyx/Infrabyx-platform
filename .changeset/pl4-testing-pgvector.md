---
"@infrabyx/testing": minor
---

`startPostgres` falls back to `pgvector/pgvector:0.8.1-pg18` (pinned by digest, `TEST_IMAGES.pgvector`, `PG_TEST_IMAGE`) so AI retrieval migrations run; CI's integration job uses the same image. Point `IPB_TEST_PG_URL` at a PostgreSQL 18 server with the `vector` extension available.
