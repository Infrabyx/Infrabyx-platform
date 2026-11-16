---
"@infrabyx/connectors": minor
---

`@infrabyx/connectors/av`: the `clamav` AV adapter (clamd `INSTREAM` over TCP, in-cluster addresses only, fail-closed verdicts, stale signatures refused), off behind `int.av.clamav.enabled`; AV in the exit runbook (PR-LDC-41). Its health answer reports signature-database freshness (`signatures_at`, `signature_age_hours`, `max_signature_age_hours`, `signatures_fresh`) and is `degraded` when stale.
