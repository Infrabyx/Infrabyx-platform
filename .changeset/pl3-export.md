---
"@infrabyx/export": minor
---

First release (publishable, PL1-D-20): export maps and `REF-EXPORT-1.0`, the deterministic archive
writer to the Ecosystem §12.1 standard with the C-22 signed manifest and an offline verifier,
`ExportService` (jobs, reconciled snapshot, STORAGE, ledgered downloads), `goldenArchive`, and the
`infrabyx-export` CLI (`map-gate`, `diff`, `verify`). Migration `export/0001_init.sql`.

export_map: REF-EXPORT-1.0
Customer note: the first export map; downloads hold tenants, legal entities, memberships, settings,
approvals, notifications, inbox items and the audit trail.
