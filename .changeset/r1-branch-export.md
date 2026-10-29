---
"@infrabyx/export": minor
---

Reference export map `REF-EXPORT-1.3` (R1-D-26): the audit trail (`audit_event`) gains the ledger's `branch_id` (`audit/0004`), which the ledger chain hashes when it is set, and the archive's `verify.mjs` hashes it the same way, so an exported chain with branch entries verifies. A minor bump: a field is only added. `REF-EXPORT-1.2` stays registered as `REF_EXPORT_MAP_1_2` for the dual run. The golden archive is regenerated as `golden/REF-EXPORT-1.3`.

export_map: REF-EXPORT-1.3
