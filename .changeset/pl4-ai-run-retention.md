---
"@infrabyx/ai": minor
---

AI run retention (owner approval OWNER-QUESTIONS #30, PL4-D-05): migration `ai/0002_run_retention.sql` and `RunRetention`. Run `sweep()` daily from one worker: it deletes routine runs older than `ai.obs.run_retention_days` (180, never lower) with one ledger entry per run. Runs linked to an approval, a statutory output or a maker-checker request are held (`hold` on a gateway request, or `RunRetention.hold`) and never deleted while held; call `release` when the linked record is deleted. PostgreSQL refuses any delete of a run younger than 180 days or held.
