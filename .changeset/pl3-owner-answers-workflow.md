---
"@infrabyx/workflow": minor
---

Owner answers #21 and #22 (PL3-D-21), migration `workflow/0002_owner_answers_pl3.sql`: inbox items
raised with `escalateAfterHours` escalate once to ORG_ADMIN through an `inbox.escalate` timer
(`notifier.itemEscalated`), and the excluded principal never sees or resolves them; the timer
poller reads as the service reader `SVC_SCHEDULER` instead of `PLT_AUDITOR_RO` (`onServiceRead`).
