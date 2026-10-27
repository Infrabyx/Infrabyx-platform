---
"@infrabyx/export": minor
---

Owner answers to OWNER-QUESTIONS #24 (PL3-D-25). Breaking for 0.1.0 callers: the `roles` option is
removed, because only `ORG_OWNER` exports directly.

- `ORG_ADMIN` calls `submit`, an R2 approval (`export.job.request`) that only an `ORG_OWNER` may
  check; pass the workflow `approvals` engine. The requester downloads their approved archive.
- Archives are downloadable for 30 days; run `sweep()` from one worker every few minutes. It
  enqueues approved jobs and deletes expired archives, with each deletion ledgered. After that a
  download is refused with `IPB-EXP-006`.
- Migration `export/0002_owner_answers.sql` (run `infrabyx-migrate`; it creates the
  `svc_export_sweep` reader role).
- The archive README shows the export time in IST; data stays in UTC.

export_map: REF-EXPORT-1.1
