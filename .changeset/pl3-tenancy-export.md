---
"@infrabyx/tenancy": minor
---

`PgKernel.read(ctx, fn, { snapshot: true })` runs a REPEATABLE READ read-only transaction, and
`infrabyx-migrate` applies `@infrabyx/export` migrations when the package is installed (PL3-D-22).
