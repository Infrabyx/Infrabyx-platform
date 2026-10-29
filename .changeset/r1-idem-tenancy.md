---
"@infrabyx/tenancy": minor
---

Inbound idempotency (IPB-10-07; Finbyx PR-FBX-10 item 4; R1-D-27). `idempotent(tx, request, work, { audit })` claims the client's `Idempotency-Key` inside the change's transaction: identical replays return the stored response; another body is 409 IPB-PORT-004; a key still running is 409 IPB-API-011. `IdempotencyKeyInterceptor` (`@infrabyx/tenancy/nest`) requires the UUIDv7 key on POST and PATCH and sets the replay headers. `IdempotencyExpiry` purges expired keys per tenant. Migration `tenancy/0008` adds `tenancy.idempotency_key`.
