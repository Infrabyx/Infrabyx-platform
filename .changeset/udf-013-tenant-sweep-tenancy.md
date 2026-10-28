---
"@infrabyx/tenancy": minor
---

`TenantSweep` and migration `0005` (PR-UDF-013): list the tenants as `SVC_TENANT_SWEEP` (only `id` and `status`; the read is ledgered in each tenant) and run a scheduled job once per tenant in that tenant's context, as the job's own service principal, reporting each tenant's failure without stopping the others.
