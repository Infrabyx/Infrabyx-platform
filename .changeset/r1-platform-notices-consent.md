---
"@infrabyx/consent": minor
---

Platform purpose notices (`tier: "platform"` purposes: drafted by a PLT_DPO, approved by a different PLT_LEGAL_REVIEWER, read-only and citable in every tenant, tenant-scope writes refused by PostgreSQL), `PgConsentLedger.latestByPrincipal` (`OhConsentLedger` declares it unsupported), `ConsentSubjects.endRelationship`, and #95's ledgered purge `ConsentPurge.sweepPurposes()` (purpose-consent records and their notice versions once the relationship has ended and 8 years have passed since the later of that end and any withdrawal; a legal hold keeps them); migration `consent/0004` (PR-LDC-14, OWNER-QUESTIONS #95; R1-D-72).
