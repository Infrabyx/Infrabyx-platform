---
"@infrabyx/tenancy": minor
---

Kernel-owned nested units (Finbyx PR-FBX-30; IPB-02-51; R1-D-41). A mutation's `tx.unit(fn)` opens a savepoint the kernel names, runs `fn`, and releases it, or rolls back to it when `fn` throws and returns `{ ok: false, error }`, so one failed item of a batch rolls back alone (with its ledger entries and outbox rows) and the transaction carries on. A rolled-back unit's ledger entry no longer counts for the commit check. Callers still cannot issue `SAVEPOINT` or `RELEASE` themselves; read transactions have no units; at most 100,000 units per transaction.
