---
"@infrabyx/tenancy": minor
---

External grantee kinds `nhb`, `nabard`, `ifsca`, `roc_inspector`, `rcs_inspector`, `crcs_inspector`, `secretarial_auditor`, `tax_auditor`, `concurrent_auditor` and `cooperative_auditor` (PR-LDC-07), with `tenancy.external_grant`'s kind check widened in `tenancy/0016`. A scoped break-glass (PR-LDC-08 (c)): `BreakGlass.request(ctx, reason, minutes, { tenantId, modules?, access? })` narrows a grant to one tenant, its modules (schemas) and `read` (default) or `read_write`; the kernel refuses another tenant, a platform context, a write under `read` and a statement naming another module (`IPB-SEC-005`), and ledgers each refusal (`security.breakglass.scope_refused`) in the tenant touched through the new `PgKernelOptions.audit`, without which a scoped grant is refused. No scope keeps IPB-02-06's behaviour. `BreakGlassGrant.scope` and `BreakGlassUse.scope` show it (R1-D-75).
