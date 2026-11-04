---
"@infrabyx/tenancy": minor
"@infrabyx/config": minor
"@infrabyx/workflow": minor
---

Approval expiry from a product setting (OWNER-QUESTIONS #106; LawDocsComply PR-LDC-19; R1-D-89): the new registered key `mc.expiry_hours.{action}` (TENANT tier, 1 to 168 hours, tighten-only, R4) is read by `settingsApprovalPolicy` as `TenantApprovalPolicy.expiryHours`, and `ApprovalsEngine` uses it only to shorten the action's platform expiry, clamped to [1 hour, the platform period]; it never lengthens it. `expiryHoursFor(risk, financial, tenantHours?)` and `APPROVAL_MIN_EXPIRY_HOURS` are exported.
