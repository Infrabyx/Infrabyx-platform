---
"@infrabyx/export": minor
---

`REF-EXPORT-1.5` (R1-D-95, OWNER-QUESTIONS #110): the tenant export carries the setting change history, `01 Data/setting_change.csv` and `.jsonl` (from `config.setting_change`: who changed which setting at which scope, when, from what to what, and the approval request). `REF-EXPORT-1.4` stays exported beside it for the 90-day dual run (`REF_EXPORT_MAP_1_4`); the golden archive is `golden/REF-EXPORT-1.5`.
