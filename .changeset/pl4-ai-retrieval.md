---
"@infrabyx/ai": minor
---

Tenant-scoped hybrid retrieval (PL4 session 4): migration `ai/0003_retrieval.sql` (needs PostgreSQL with pgvector), `EmbeddingGateway` (routing, scrubbing, caps and run rows for EMBEDDING) and `RetrievalService` (`createIndex`, `addChunks`, `activate`, `search` with pgvector HNSW plus full-text search fused by reciprocal rank fusion, the product's `authorize` callback and a data-class ceiling, and resumable `reembedBatch`). Chunk text is sealed with FieldCrypto; vectors and the lexical index come from scrubbed text.
