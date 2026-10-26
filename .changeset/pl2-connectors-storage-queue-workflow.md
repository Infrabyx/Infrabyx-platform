---
"@infrabyx/connectors": minor
---

STORAGE adapters `s3` and `minio` (Object Lock compliance, write-once retention, soft delete,
SSE-KMS with class or tenant keys, presigned URLs bound to method and content type, SHA-256
verified replication); QUEUE adapters `bullmq` (Redis or Valkey) and `pg-boss` (new migration
`0003_pgboss`, no DDL at runtime) with dead-letter queues and replay; WORKFLOW adapters `temporal`
and `temporal-cloud` with the C-16 payload codec, encrypted failures, the 32 KB reference path and
a worker helper at `@infrabyx/connectors/workflow/worker`.
