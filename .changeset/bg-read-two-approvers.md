---
"@infrabyx/tenancy": minor
---

Two tenant approvers for a scoped `read` break-glass grant (owner addition (A) to #203; R1-D-286): `PgKernelOptions.breakGlassTenantApproversForRead` (1, the default, or 2). With 2 a `read` grant needs two different ORG_OWNER/ORG_ADMIN approvers, as `read_write` does, enforced by the kernel at use; `BreakGlassTenantApproval` takes the kernel's value. Migration `tenancy/0032` loosens two checks of 0031 so a `read` row may hold a second approver, and lets a second manager complete an earlier single `read` approval without lengthening it.
