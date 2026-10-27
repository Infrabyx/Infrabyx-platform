---
"@infrabyx/export": minor
---

Owner answers to OWNER-QUESTIONS #24 (PL3-D-25).

**Breaking change, accepted by the owner (27 Oct 2026, PL4-D-05):** the `roles` option of 0.1.0 is
removed, because only `ORG_OWNER` exports directly. No product consumes `@infrabyx/export` yet;
any caller that passed `roles` must drop it and route `ORG_ADMIN` exports through `submit`.

- `ORG_ADMIN` calls `submit`, an R2 approval (`export.job.request`) that only an `ORG_OWNER` may
  check; pass the workflow `approvals` engine. The requester downloads their approved archive.
- Archives are downloadable for 30 days; run `sweep()` from one worker every few minutes. It
  enqueues approved jobs and deletes expired archives, with each deletion ledgered. After that a
  download is refused with `IPB-EXP-006`.
- Migration `export/0002_owner_answers.sql` (run `infrabyx-migrate`; it creates the
  `svc_export_sweep` reader role).
- The archive README shows the export time in IST; data stays in UTC.

export_map: REF-EXPORT-1.1
