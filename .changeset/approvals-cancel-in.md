---
"@infrabyx/tenancy": minor
---

`ApprovalsEngine.cancelIn(tx, id, reason)`: cancel inside the caller's transaction with `cancel`'s rules, a required reason and never an agent; `cancel` takes an optional reason; `ApprovalRecord.cancelReason`. Migration `tenancy/0022` adds the nullable `cancel_reason` column (PR-LDC-37).
