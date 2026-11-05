# @infrabyx/consent

## 1.3.1

### Patch Changes

- Updated dependencies [d3888de]
  - @infrabyx/config@1.13.0
  - @infrabyx/tenancy@1.16.1

## 1.3.0

### Minor Changes

- 67be297: The purpose-consent purge per tenant, dry run first (Finbyx PR-FBX-37, R1-D-97). `ConsentPurge.dryRunPurposes(tenantId)` runs #95's delete under the same rule and RLS and rolls it back, returning a report (ids, purposes, times, counts by purpose, SHA-256), kept as a `dry_run` row in `consent.purpose_purge_run` (`consent/0005`) and ledgered as `consent.purpose.purge.dry_run`. `purgePurposesFor(tenantId, { dryRunId })` then deletes in that tenant only the records the dry run listed (and the rule still allows), refused unless the dry run is the tenant's and at most 72 hours old. Every record deleted, by it or by `sweepPurposes`, now has its own `consent.purpose.purge.record` ledger entry (id and purpose, no personal data). `tenantsWithPurposesDue()` lists the tenants to run one by one. The 8-year rule itself is unchanged.

### Patch Changes

- Updated dependencies [67be297]
- Updated dependencies [67be297]
- Updated dependencies [67be297]
- Updated dependencies [67be297]
  - @infrabyx/contracts@1.23.0
  - @infrabyx/tenancy@1.16.0
  - @infrabyx/config@1.12.1
  - @infrabyx/crypto@1.5.8
  - @infrabyx/ui@1.2.11

## 1.2.5

### Patch Changes

- Updated dependencies [3c9bb25]
- Updated dependencies [3c9bb25]
- Updated dependencies [3c9bb25]
- Updated dependencies [3c9bb25]
  - @infrabyx/config@1.12.0
  - @infrabyx/tenancy@1.15.0
  - @infrabyx/contracts@1.22.0
  - @infrabyx/crypto@1.5.7
  - @infrabyx/ui@1.2.10

## 1.2.4

### Patch Changes

- Updated dependencies [bc2c301]
  - @infrabyx/tenancy@1.14.1

## 1.2.3

### Patch Changes

- Updated dependencies [1dda4b2]
- Updated dependencies [1dda4b2]
- Updated dependencies [1dda4b2]
  - @infrabyx/tenancy@1.14.0
  - @infrabyx/config@1.11.0
  - @infrabyx/contracts@1.21.0
  - @infrabyx/crypto@1.5.6
  - @infrabyx/ui@1.2.9

## 1.2.2

### Patch Changes

- Updated dependencies [b8c1f2c]
- Updated dependencies [b8c1f2c]
  - @infrabyx/contracts@1.20.0
  - @infrabyx/tenancy@1.13.0
  - @infrabyx/config@1.10.1
  - @infrabyx/crypto@1.5.5
  - @infrabyx/ui@1.2.8

## 1.2.1

### Patch Changes

- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
  - @infrabyx/tenancy@1.12.0
  - @infrabyx/contracts@1.19.0
  - @infrabyx/config@1.10.0
  - @infrabyx/crypto@1.5.4
  - @infrabyx/ui@1.2.7

## 1.2.0

### Minor Changes

- 9c368c7: Platform purpose notices (`tier: "platform"` purposes: drafted by a PLT_DPO, approved by a different PLT_LEGAL_REVIEWER, read-only and citable in every tenant, tenant-scope writes refused by PostgreSQL), `PgConsentLedger.latestByPrincipal` (`OhConsentLedger` declares it unsupported), `ConsentSubjects.endRelationship`, and #95's ledgered purge `ConsentPurge.sweepPurposes()` (purpose-consent records and their notice versions once the relationship has ended and 8 years have passed since the later of that end and any withdrawal; a legal hold keeps them); migration `consent/0004` (PR-LDC-14, OWNER-QUESTIONS #95; R1-D-72).

### Patch Changes

- Updated dependencies [9c368c7]
- Updated dependencies [9c368c7]
- Updated dependencies [9c368c7]
- Updated dependencies [9c368c7]
  - @infrabyx/tenancy@1.11.0
  - @infrabyx/contracts@1.18.0
  - @infrabyx/config@1.9.2
  - @infrabyx/crypto@1.5.3
  - @infrabyx/ui@1.2.6

## 1.1.6

### Patch Changes

- Updated dependencies [714ad01]
  - @infrabyx/contracts@1.17.0
  - @infrabyx/config@1.9.1
  - @infrabyx/crypto@1.5.2
  - @infrabyx/tenancy@1.10.1
  - @infrabyx/ui@1.2.5

## 1.1.5

### Patch Changes

- Updated dependencies [b3edda2]
- Updated dependencies [b3edda2]
- Updated dependencies [b3edda2]
- Updated dependencies [b3edda2]
- Updated dependencies [b3edda2]
  - @infrabyx/config@1.9.0
  - @infrabyx/tenancy@1.10.0
  - @infrabyx/contracts@1.16.0
  - @infrabyx/crypto@1.5.1
  - @infrabyx/ui@1.2.4

## 1.1.4

### Patch Changes

- Updated dependencies [fdd1f1a]
- Updated dependencies [ed143e3]
  - @infrabyx/config@1.8.0
  - @infrabyx/tenancy@1.9.2

## 1.1.3

### Patch Changes

- Updated dependencies [2a95100]
- Updated dependencies [2a95100]
  - @infrabyx/config@1.7.0
  - @infrabyx/crypto@1.5.0
  - @infrabyx/tenancy@1.9.1

## 1.1.2

### Patch Changes

- Updated dependencies [7910610]
- Updated dependencies [1b99d7a]
- Updated dependencies [c83e9e0]
- Updated dependencies [af2ae98]
- Updated dependencies [c4117e4]
- Updated dependencies [1e721cd]
- Updated dependencies [854e309]
- Updated dependencies [854e309]
- Updated dependencies [0da0398]
- Updated dependencies [05c3122]
  - @infrabyx/tenancy@1.9.0
  - @infrabyx/contracts@1.15.0
  - @infrabyx/config@1.6.0
  - @infrabyx/crypto@1.4.0
  - @infrabyx/ui@1.2.3

## 1.1.1

### Patch Changes

- Updated dependencies [97e8524]
- Updated dependencies [e41c3bd]
- Updated dependencies [92706c4]
- Updated dependencies [92706c4]
- Updated dependencies [4a87754]
- Updated dependencies [d66ffad]
  - @infrabyx/contracts@1.14.0
  - @infrabyx/tenancy@1.8.0
  - @infrabyx/config@1.5.2
  - @infrabyx/crypto@1.3.1
  - @infrabyx/ui@1.2.2

## 1.1.0

### Minor Changes

- cff2a02: Consent to a product's own purposes (Finbyx PR-FBX-26; IPB-04-78; DPDP Act 2023 s.5–6; R1-D-38). Migration `consent/0003` adds `consent.purpose_notice` (a tenant's notice per purpose and language, versioned, approved by a person other than its maker, immutable once approved, SHA-256 computed by the database) and `consent.purpose_record` (append-only grants and withdrawals, each grant naming the exact notice version, language and SHA-256). `PurposeConsents` takes the product's purposes (`<product>.<area>[.<detail>]`), drafts, approves, retires and serves notices (`currentNotice`), records `grant` and `withdraw`, and reads `consentState(subject, purpose)`; each change is ledgered, and with an outbox emits `PurposeConsentChanged`. Run `infrabyx-migrate`.

### Patch Changes

- Updated dependencies [32b53ee]
- Updated dependencies [cff2a02]
  - @infrabyx/crypto@1.3.0
  - @infrabyx/contracts@1.13.0
  - @infrabyx/config@1.5.1
  - @infrabyx/tenancy@1.7.2
  - @infrabyx/ui@1.2.1

## 1.0.17

### Patch Changes

- Updated dependencies [63c5ad2]
- Updated dependencies [63c5ad2]
- Updated dependencies [63c5ad2]
  - @infrabyx/config@1.5.0
  - @infrabyx/contracts@1.12.0
  - @infrabyx/ui@1.2.0
  - @infrabyx/tenancy@1.7.1
  - @infrabyx/crypto@1.2.7

## 1.0.16

### Patch Changes

- Updated dependencies [2e3a2d3]
- Updated dependencies [2e3a2d3]
- Updated dependencies [3f20011]
- Updated dependencies [3f20011]
  - @infrabyx/contracts@1.11.0
  - @infrabyx/tenancy@1.7.0
  - @infrabyx/config@1.4.1
  - @infrabyx/crypto@1.2.6
  - @infrabyx/ui@1.1.10

## 1.0.15

### Patch Changes

- Updated dependencies [138ae44]
- Updated dependencies [138ae44]
- Updated dependencies [138ae44]
  - @infrabyx/config@1.4.0
  - @infrabyx/contracts@1.10.0
  - @infrabyx/tenancy@1.6.0
  - @infrabyx/crypto@1.2.5
  - @infrabyx/ui@1.1.9

## 1.0.14

### Patch Changes

- Updated dependencies [2b307e0]
- Updated dependencies [2b307e0]
  - @infrabyx/contracts@1.9.0
  - @infrabyx/tenancy@1.5.0
  - @infrabyx/config@1.3.2
  - @infrabyx/crypto@1.2.4
  - @infrabyx/ui@1.1.8

## 1.0.13

### Patch Changes

- Updated dependencies [cd25633]
- Updated dependencies [cd25633]
  - @infrabyx/contracts@1.8.0
  - @infrabyx/tenancy@1.4.0
  - @infrabyx/config@1.3.1
  - @infrabyx/crypto@1.2.3
  - @infrabyx/ui@1.1.7

## 1.0.12

### Patch Changes

- Updated dependencies [94b706e]
  - @infrabyx/config@1.3.0
  - @infrabyx/tenancy@1.3.5

## 1.0.11

### Patch Changes

- Updated dependencies [f5622c9]
- Updated dependencies [f5622c9]
  - @infrabyx/config@1.2.0
  - @infrabyx/contracts@1.7.0
  - @infrabyx/tenancy@1.3.4
  - @infrabyx/crypto@1.2.2
  - @infrabyx/ui@1.1.6

## 1.0.10

### Patch Changes

- Updated dependencies [ceabe3b]
  - @infrabyx/contracts@1.6.0
  - @infrabyx/config@1.1.1
  - @infrabyx/crypto@1.2.1
  - @infrabyx/tenancy@1.3.3
  - @infrabyx/ui@1.1.5

## 1.0.9

### Patch Changes

- Updated dependencies [849b8f9]
- Updated dependencies [849b8f9]
- Updated dependencies [849b8f9]
  - @infrabyx/config@1.1.0
  - @infrabyx/contracts@1.5.0
  - @infrabyx/crypto@1.2.0
  - @infrabyx/tenancy@1.3.2
  - @infrabyx/ui@1.1.4

## 1.0.8

### Patch Changes

- Updated dependencies [7e38652]
- Updated dependencies [7e38652]
  - @infrabyx/contracts@1.4.0
  - @infrabyx/crypto@1.1.0
  - @infrabyx/config@1.0.6
  - @infrabyx/tenancy@1.3.1
  - @infrabyx/ui@1.1.3

## 1.0.7

### Patch Changes

- Updated dependencies [b6058d3]
- Updated dependencies [b6058d3]
  - @infrabyx/contracts@1.3.0
  - @infrabyx/tenancy@1.3.0
  - @infrabyx/config@1.0.5
  - @infrabyx/crypto@1.0.3
  - @infrabyx/ui@1.1.2

## 1.0.6

### Patch Changes

- Updated dependencies [1c869a8]
  - @infrabyx/config@1.0.4
  - @infrabyx/tenancy@1.2.1

## 1.0.5

### Patch Changes

- Updated dependencies [75e9ea4]
- Updated dependencies [75e9ea4]
  - @infrabyx/contracts@1.2.0
  - @infrabyx/tenancy@1.2.0
  - @infrabyx/config@1.0.3
  - @infrabyx/crypto@1.0.2
  - @infrabyx/ui@1.1.1

## 1.0.4

### Patch Changes

- Updated dependencies [c0ce8ff]
- Updated dependencies [2724cd6]
  - @infrabyx/tenancy@1.1.3

## 1.0.3

### Patch Changes

- Updated dependencies [8a2587e]
- Updated dependencies [8a2587e]
  - @infrabyx/config@1.0.2
  - @infrabyx/tenancy@1.1.2

## 1.0.2

### Patch Changes

- Updated dependencies [53a973c]
  - @infrabyx/tenancy@1.1.1

## 1.0.1

### Patch Changes

- Updated dependencies [84e4200]
- Updated dependencies [588b509]
- Updated dependencies [588b509]
  - @infrabyx/ui@1.1.0
  - @infrabyx/contracts@1.1.0
  - @infrabyx/tenancy@1.1.0
  - @infrabyx/config@1.0.1
  - @infrabyx/crypto@1.0.1

## 1.0.0

### Major Changes

- 9ec9a2c: 1.0.0, the platform baseline release (IPB-14 §14.5 item 1; owner answer #67(4), PL6-D-16). Every `@infrabyx/*` package moves to 1.0.0 together; the public API is unchanged from the 0.x set of the PL6 gate (`docs/phases/PL6-gate.md` §6), so a product upgrades by moving every dependency to 1.0.0 at once. From 1.0.0 on, semantic versioning holds: a breaking change to an export, a migration or a setting is a major release with an ADR (IPB-09-34/35).

### Patch Changes

- Updated dependencies [9ec9a2c]
  - @infrabyx/config@1.0.0
  - @infrabyx/contracts@1.0.0
  - @infrabyx/crypto@1.0.0
  - @infrabyx/tenancy@1.0.0
  - @infrabyx/ui@1.0.0

## 0.1.1

### Patch Changes

- Updated dependencies [9d8cd8c]
- Updated dependencies [b3934f9]
  - @infrabyx/tenancy@0.6.0
  - @infrabyx/config@0.5.1

## 0.1.0

### Minor Changes

- 1fecf45: Owner answer #57 (PL5-D-11), with migration `consent/0002_form_consent_end.sql`: a form consent for a marketing lead ends 24 months after the last interaction and the sweep then deletes it on the #48 rule, unless the person has an active relationship or a legal hold applies. `ConsentSubjects` records interactions and relationships (the product reports them) and legal holds (PLT_LEGAL_REVIEWER only). `ConsentPurge.sweep()` also removes status rows with no record left and returns `subjects`.
- 686d24b: The consent package (PL5 session 5c), with migration `consent/0001_init.sql`.

  - **Texts:** consent texts with a DPO maker and a legal-reviewer checker.
  - **Ledgers:** the append-only consent ledger (`PgConsentLedger`, plus `OhConsentLedger`, which is unproven), and the acceptance ledger (`IPB-POL-010`).
  - **CMP:** the CMP components, with equal Accept all, Reject all and Manage controls. Escape counts as Reject. Also covered: GPC, region wording and re-prompting.
  - **Gating:** the consent endpoint, the first-party controller, and inert script gating with the locked sensitive routes.
  - **Purge:** the consent purge removes a record 3 years after the consent ends (#48). Run `ConsentPurge.sweep()` daily.

- b7de3c6: PL5 session 7: the preference centre's category help keys are literal strings (`hlp.consent.functional`, `.analytics`, `.marketing`), so `hlp-lint` checks them against the platform registry.

  `ConsentTexts.drafts(ctx)` lists the texts waiting for the PLT_LEGAL_REVIEWER (the Studio queue and the public-site seed).

  Fixes found by the group site's accessibility gate: the banner controller posts to the form's `action` attribute (a `<button name="action">` no longer hides `form.action`), the cookie table scrolls inside a labelled region, and the category fieldsets shrink to 320 px (`min-width: 0`).

- 1076df2: PL5 session 8b: `ConsentTexts.list(ctx)`, every text and version for Studio, for PLT_DPO or PLT_LEGAL_REVIEWER in the platform context (`IPB-UX-011` otherwise).

### Patch Changes

- Updated dependencies [de53086]
- Updated dependencies [de53086]
- Updated dependencies [f1a36a1]
- Updated dependencies [f1a36a1]
- Updated dependencies [1fecf45]
- Updated dependencies [1fecf45]
- Updated dependencies [b0dc390]
- Updated dependencies [b0dc390]
- Updated dependencies [b0dc390]
- Updated dependencies [275d4ba]
- Updated dependencies [934355c]
- Updated dependencies [686d24b]
- Updated dependencies [686d24b]
- Updated dependencies [e8e83cb]
- Updated dependencies [275d4ba]
- Updated dependencies [36338c3]
- Updated dependencies [934355c]
- Updated dependencies [b7de3c6]
- Updated dependencies [b7de3c6]
- Updated dependencies [b50922c]
- Updated dependencies [1076df2]
- Updated dependencies [f1da214]
- Updated dependencies [e8e83cb]
- Updated dependencies [275d4ba]
- Updated dependencies [8dfe167]
  - @infrabyx/config@0.5.0
  - @infrabyx/contracts@0.5.0
  - @infrabyx/ui@0.1.0
  - @infrabyx/tenancy@0.5.0
  - @infrabyx/crypto@0.4.1
