---
"@infrabyx/consent": minor
---

The purpose-consent purge per tenant, dry run first (Finbyx PR-FBX-37, R1-D-97). `ConsentPurge.dryRunPurposes(tenantId)` runs #95's delete under the same rule and RLS and rolls it back, returning a report (ids, purposes, times, counts by purpose, SHA-256), kept as a `dry_run` row in `consent.purpose_purge_run` (`consent/0005`) and ledgered as `consent.purpose.purge.dry_run`. `purgePurposesFor(tenantId, { dryRunId })` then deletes in that tenant only the records the dry run listed (and the rule still allows), refused unless the dry run is the tenant's and at most 72 hours old. Every record deleted, by it or by `sweepPurposes`, now has its own `consent.purpose.purge.record` ledger entry (id and purpose, no personal data). `tenantsWithPurposesDue()` lists the tenants to run one by one. The 8-year rule itself is unchanged.
