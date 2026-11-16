---
"@infrabyx/export": minor
---

`REF-EXPORT-1.6` (R1-D-161): the audit trail carries each entry's `business_ids` (`audit/0010`), which the ledger chain hashes when set, and the offline verifier hashes them too; approval requests carry their `cancel_reason` (`tenancy/0022`). `REF-EXPORT-1.5` stays exported beside it for the 90-day dual run (`REF_EXPORT_MAP_1_5`); the golden archive is `golden/REF-EXPORT-1.6`.

Customer note: audit-trail lines gain `business_ids` and approval requests gain `cancel_reason`; every other file is unchanged, and archives with business ids now verify offline.

export_map: REF-EXPORT-1.6
