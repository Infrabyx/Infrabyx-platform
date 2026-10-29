---
"@infrabyx/tenancy": minor
---

The branch context (R1-D-26). The kernel checks and sets `app.branch_id`, `app.branch_ids` and `app.branch_scope` for each transaction. Migration `tenancy/0007` adds `tenancy.branch_allowed(branch_id)` for branch-level RLS policies; it denies by default.
