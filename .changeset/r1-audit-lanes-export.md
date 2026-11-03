---
"@infrabyx/export": minor
---

Reference export map `REF-EXPORT-1.4` (R1-D-58, Finbyx PR-FBX-32). The audit trail (`audit_event`) gains the ledger's `lane` and `lane_seq` (`audit/0006`), which the chain hashes when set. The archive's `verify.mjs` verifies the trail lane by lane: it reads every monthly file first, then follows each lane in `seq` order, so an exported laned chain verifies offline. A minor bump, because fields are only added. `REF-EXPORT-1.3` stays registered as `REF_EXPORT_MAP_1_3` for the dual run. In golden archives, `seq`, `lane` and `lane_seq` are normalised (now run-time values), and the golden archive is regenerated as `golden/REF-EXPORT-1.4`.

export_map: REF-EXPORT-1.4
