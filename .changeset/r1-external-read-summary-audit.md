---
"@infrabyx/audit": minor
---

`AuditService.externalReadSummary(ctx, day)` summarises one tenant's external reads on one UTC day from the `platform.external_read` ledger entries that `ExternalReads` writes: reads per grant and table, per grantee and per table, each with the first and last read time. It reads in the tenant's context under the ledger's RLS, refuses an external principal (IPB-SEC-005) and returns ids, counts and times only, never the grantee's name, IP or user-agent hashes, trace ids or digests. The entries keep the row count only inside a digest, so reads are counted, not rows (PR-LDC-10; R1-D-81).
