---
"@infrabyx/contracts": minor
---

`toProblem` carries two safe RFC 9457 members (Udofin PR-UDF-038; R1-D-189): `reason`, the error's `meta.reason` when it is a fixed snake-case label, and on a 429 or 503 `retry_after_seconds` from `meta.retryAfterSeconds` (whole seconds, 1 to 86400). `problemHeaders(problem)` returns the matching `Retry-After` header. The rest of `meta` stays inside the platform.
