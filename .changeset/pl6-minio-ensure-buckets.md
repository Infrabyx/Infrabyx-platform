---
"@infrabyx/connectors": minor
---

PL6 session 4c: `MinioStorage.ensureBuckets()` creates the class buckets that are missing on a local MinIO, with Object Lock (and so versioning) as `health` requires. `pnpm dev:up` calls it; deployed buckets still come from the OpenTofu modules.
