---
"@infrabyx/tenancy": minor
---

Break-glass visible to the tenant (Finbyx PR-FBX-10 item 3; R1-D-28). The kernel records each use of a break-glass grant in the tenant it touches (migration `tenancy/0009`, `tenancy.breakglass_use`, readable by the tenant, written only by definer functions). `BreakGlassTenantNotices` lists the uses and raises `BreakGlassUsed` once per grant for the product to notify.
