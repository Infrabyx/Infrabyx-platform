---
"@infrabyx/consent": minor
---

The consent package (PL5 session 5c), with migration `consent/0001_init.sql`.

- **Texts:** consent texts with a DPO maker and a legal-reviewer checker.
- **Ledgers:** the append-only consent ledger (`PgConsentLedger`, plus `OhConsentLedger`, which is unproven), and the acceptance ledger (`IPB-POL-010`).
- **CMP:** the CMP components, with equal Accept all, Reject all and Manage controls. Escape counts as Reject. Also covered: GPC, region wording and re-prompting.
- **Gating:** the consent endpoint, the first-party controller, and inert script gating with the locked sensitive routes.
- **Purge:** the consent purge removes a record 3 years after the consent ends (#48). Run `ConsentPurge.sweep()` daily.
