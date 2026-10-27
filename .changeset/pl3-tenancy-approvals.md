---
"@infrabyx/tenancy": minor
---

Maker-checker additions (PL3-D-07, PL3-D-08, PL3-D-19), migration `tenancy/0002_approvals_pl3.sql`
(expand-only): requests expire after 7 days, or 72 hours for R4, R5 and financial R3
(`expire`, terminal, `IPB-UX-012`, `ApprovalExpired`); `remind` and `escalate` (to `ORG_ADMIN`,
`ApprovalEscalated`, never decides); the checker `diff` (field names only above INTERNAL); the
tighten-only tenant policy hook for `mc.checker_roles` and `mc.dual_checker_above`;
`PLT_SECURITY_OFFICER` may cancel (IPB-02-80); `observers` called inside each transition's
transaction. Products run `infrabyx-migrate` to apply 0002.
