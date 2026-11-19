---
"@infrabyx/tenancy": minor
---

Reads joined to an ambient mutation (Udofin PR-UDF-037; R1-D-188). `PgKernel.ambient(ctx, fn, { joinReads: true })` (`AmbientOptions`) makes each `read` inside `fn` for the same tenant, principal, scope and grant run on the ambient transaction, so it sees that transaction's uncommitted writes: read-only, as the read role, with its own `app.*` settings, in a savepoint that is always rolled back, and one at a time with the joined mutations. Snapshot, support, external and platform service reads, and reads for another tenant or principal, keep their own transaction. Without `joinReads` nothing changes.
