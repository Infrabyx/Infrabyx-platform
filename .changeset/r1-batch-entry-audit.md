---
"@infrabyx/audit": minor
---

One ledger entry for a job step over many resources (Finbyx PR-FBX-30; IPB-02-51; R1-D-41). Migration `audit/0005` adds `audit.batch_member`, append-only for every role. `PgAuditSink.recordBatch(tx, { action, run, step, resourceType, resourceIds })` writes one `job_step` entry (`<run>/<step>/<type>`) whose digest covers the full id list (1 to 100,000), and lists the ids in order; `verifyBatch(tx, ledgerId)` recomputes it. Run `infrabyx-migrate`.
