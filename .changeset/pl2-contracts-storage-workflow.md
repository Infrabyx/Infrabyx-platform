---
"@infrabyx/contracts": minor
---

STORAGE: `presign(key, op, ttl, opts?)` takes `{ bucketClass, contentType }` so an upload URL is
bound to its bucket class and content type. KMS: purpose `workflow` in `KMS_PURPOSES` for the
Temporal payload codec (C-16).
