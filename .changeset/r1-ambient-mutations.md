---
"@infrabyx/tenancy": minor
---

Ambient mutations and principal-bound idempotency keys (Udofin PR-UDF-033; Finbyx PR-FBX-21; IPB-10-07; R1-D-48). `PgKernel.ambient(ctx, fn, opts)` opens a mutation that every `mutate` on the same kernel joins in a kernel savepoint with its own settings and ledger check, so `idempotent()` covers handlers whose services open their own mutations; a joined call must be the same tenant, principal, scope and grant, and joined calls run one at a time. Migration `tenancy/0015` adds `principal_id` to `tenancy.idempotency_key`: another principal presenting a key gets 409 IPB-PORT-004. `idempotencyRequestHash(method, route, body, { params })` and `IdempotencyKeyInterceptor` hash the route parameters. Run `infrabyx-migrate`.
