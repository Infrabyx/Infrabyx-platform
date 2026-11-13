---
"@infrabyx/tenancy": minor
---

The shared rate limiter (PR-LDC-54; migration `tenancy/0024`): `RateLimiter.hit` and `consume` count per tenant, bucket, keyed-hashed key and fixed window in PostgreSQL (no ledger row per hit; the `svc_rate_limit` role may only count), `rateLimitError` (429 `IPB-SEC-019`) and `rateLimitHeaders`; `RateLimitSweep` deletes only fully expired windows with one ledger entry per run (owner answer #129).
