# @infrabyx/consent

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
