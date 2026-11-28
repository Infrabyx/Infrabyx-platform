---
"@infrabyx/workflow": minor
---

`ChecklistService` (templates item (d); R1-D-326), with migration `workflow/0007_checklist.sql` (expand-only): define a checklist, start a run, mark items `met`, `not_met` or `not_applicable` (a reason for the last two; evidence by STORAGE key and SHA-256 where required, verified when STORAGE is given), one Work Inbox follow-up per `not_met` item, and sign-off by the maker then a different checker, each after a fresh multi-factor step-up (`IPB-SEC-001` with `step_up` otherwise). Guide §7fp.
