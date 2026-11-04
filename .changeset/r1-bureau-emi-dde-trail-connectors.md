---
"@infrabyx/connectors": minor
---

`cibil` maps each account's EMI to `Tradeline.emiPaise` (`cibilEmiPaise`; absent, empty, zero or malformed is `null`). `nesl-dde` maps each signed executant's evidence to `DdeRecord.signers` (`neslSigners`, failing closed on a partial trail) and registers a not-stampable document with NeSL's reason code in place of a stamp reference (`neslNonStampable`, `mapNeslNotStampable`); a key replayed with another stamping is refused. All vendor shapes stub-shaped `[VERIFY]`; both adapters stay off and `unproven` (PR-FBX-35; R1-D-84).
