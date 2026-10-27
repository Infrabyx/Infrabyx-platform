---
"@infrabyx/tenancy": minor
---

Cross-tenant service readers (owner answer #22, PL3-D-21): `ServiceReader`, `serviceReaderContext`
and `serviceReaderRole`. The kernel runs a reader's platform-scope read as its own database role,
refuses every reader mutation except the `platform.service_read` ledger entry for its own read,
and `contextFromClaims` refuses a token that claims a reader role. Each read that returns rows is
ledgered in every tenant it touched. Also `tenantHasRoleHolder` for the rules review assignee.
