---
"@infrabyx/connectors": minor
---

PR-FBX-57 (R1-D-302, R1-D-304; guide §7ff): the BUREAU (`cibil`) and ACCOUNT_AGGREGATOR (`setu-aa`) adapters now quarantine every report and FI payload they store, scan it through FILE_SCAN and promote it to REGULATED only when CLEAN (`writeScanned` in `@infrabyx/connectors/core`). The clean object carries its scan as tags (`ipb-scan-verdict`, `ipb-scan-engine`, `ipb-scanned-at`, `ipb-scan-sha256`) and the ref carries the scan record. EICAR is refused `IPB-SEC-011` (kept in quarantine); a scanner outage `IPB-SEC-015` (retry later).

**Action for products: pass your FILE_SCAN adapter as `scan` to `CibilBureau` and `SetuAccountAggregator`, or their pulls and fetches refuse.** `scan` is optional in 1.x so construction does not fail, but without it every completed pull and every fetch with a payload refuses `IPB-SEC-015` (reason `scan_required`) and stores nothing, in every environment. Pass `appEnv` too: outside `local` and `test` an adapter built without `scan` emits one warning at start-up (`warn` to route it to your logger). `scan` becomes required at construction in 2.0.0.
