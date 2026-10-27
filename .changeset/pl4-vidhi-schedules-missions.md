---
"@infrabyx/vidhi": minor
---

Scheduled tasks and missions (PL4 session 7a, PL4-D-09): migration `vidhi/0002_missions_schedules.sql`; the in-house RRULE subset (`parseRecurrence`, `nextOccurrence`, DST-correct); `Scheduler` with recurring and event-triggered schedules, the cross-tenant due-run poller (`SVC_VIDHI_SCHED`), the permission re-check before every run, skip (`IPB-VID-020`) and pause (`IPB-VID-021`); `Missions` with the `vidhi.mission_plan@1` planner, budgets (`IPB-VID-070`), the mission level as a cap on its tasks and a lease for resumable runs; `TaskRuntime.create` takes `maxLevel`.
