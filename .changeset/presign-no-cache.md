---
"@infrabyx/contracts": minor
"@infrabyx/connectors": minor
"@infrabyx/fakes": minor
"@infrabyx/testing": minor
---

No-cache presigned downloads (Udofin PR-UDF-060; R1-D-230). `connectors`: a presigned `get` of a `REGULATED` or `CONFIDENTIAL` object (compartments included), on `s3` and `minio`, signs the response overrides `response-cache-control=no-store, private` and `response-expires=Thu, 01 Jan 1970 00:00:00 GMT`, so the store answers with `Cache-Control: no-store, private` and a past `Expires` and devices and webviews keep no copy; the overrides follow the bucket the URL reads from and cannot be dropped by a caller. Other classes and upload URLs are unchanged. S3 has no `Pragma` override: `Cache-Control: no-store` supersedes it for HTTP/1.1 clients. `contracts`: `NO_CACHE_PRESIGN_CLASSES`, `PRESIGN_NO_CACHE` and `presignNoCache`. `fakes`: `MemoryStorage` adds the same parameters to its download URLs. `testing`: a STORAGE contract case checks the URL and, on HTTP stores, the headers returned. No setting, no migration.
