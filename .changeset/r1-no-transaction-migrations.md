---
"@infrabyx/tenancy": patch
---

`infrabyx-migrate` runs a file marked `-- infrabyx:no-transaction` one statement at a time (Udofin PR-UDF-031; R1-D-44). PostgreSQL runs a multi-statement query as one implicit transaction, so a lint-clean `CREATE INDEX CONCURRENTLY` on an existing table failed with "cannot run inside a transaction block". A failure part-way names how many statements ran; the file stays unrecorded and the next run repeats it from the start, so write such files to be re-runnable. `splitStatements(sql)` is exported from `@infrabyx/tenancy/migrate`.
