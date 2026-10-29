---
"@infrabyx/audit": minor
---

Database-level statutory audit capture (Finbyx PR-FBX-10 item 2; R1-D-25). Migration `audit/0003` adds `audit.register_capture('<schema>.<table>')`: every insert, update and delete on a registered table is captured with before and after values, actor, entity, branch, break-glass grant, trace, action, reason, database login and role, and transaction id. Rows go into a per-tenant hash chain that only `audit.capture_row()` writes and nobody changes. Event triggers refuse disabling it. `StatutoryCapture`, `AuditService.verifyCapture` and `AuditSweep.verifyCaptureAll` are the gap detector. The daily anchor's format 2 signs the capture head, and `verifyCaptureAgainstAnchor` checks an export against it.
