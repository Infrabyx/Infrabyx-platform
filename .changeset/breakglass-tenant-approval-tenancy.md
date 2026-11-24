---
"@infrabyx/tenancy": minor
"@infrabyx/contracts": minor
---

R1-D-284 (Finbyx PR-FBX-55). A scoped break-glass grant under the tenant's own control: migration `tenancy/0031` adds `tenancy.breakglass_tenant_approval` (forced RLS; a trigger lets only the acting tenant manager write a decision) and the definer `tenancy.breakglass_tenant_pending()`; `BreakGlassTenantApproval` (`pending`, `approve`, `refuse`, `revoke`, `status`) lets the tenant's ORG_OWNER or ORG_ADMIN approve a scoped grant (two different managers for `read_write`), at most for the grant's duration, refuse it or revoke at once, ledgered in the tenant. The kernel always refuses a scoped grant its tenant refused or revoked, and with the new `PgKernelOptions.requireTenantApprovedBreakGlass` (default false) any scoped grant without a live tenant approval: `IPB-SEC-005`, `meta.refusal` `tenant_approval`, ledgered in the tenant, not recorded as a use. Unscoped break-glass is unchanged. `SupportGrant.tenantApproved` is new. `@infrabyx/contracts`: the internal events `BreakGlassTenantApproved` and `BreakGlassTenantRevoked`. Product step: run `infrabyx-migrate` (0031), add the tenant's page and set the option (guide §7ev).
