---
"@infrabyx/tenancy": minor
---

`PgKernel.ambient` (Udofin PR-UDF-062; R1-D-237): a `mutate` by another principal of the ambient call's tenant now joins in a savepoint with its own `app.*` settings and ledger entries, and the settings of the call it was made from come back on every path; with `joinReads` its reads join the same way. Another tenant's `mutate` or `read` runs in its own transaction, as if no ambient mutation were open. Concurrent joined calls are queued and run one at a time in order instead of being refused; a call made inside a running joined call runs at once, and the ambient callback's own statements wait while a joined call runs. Still refused: another principal when it or the ambient call carries a break-glass grant or support access, an external principal or service reader, another scope, and a role other than the app role. No migration, setting or type change.
