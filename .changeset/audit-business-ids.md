---
"@infrabyx/audit": minor
---

Business ids on ledger entries (PR-LDC-30): `businessIds` on `record`, inside the hash when present; `AuditService.history(ctx, businessId)` and `LedgerFilter.businessId`. Migrations `audit/0010` (column, check, chain trigger) and `audit/0011` (concurrent partial GIN index).
