# @infrabyx/rules

## 0.1.0

### Minor Changes

- 3951517: Owner answer #21 (PL3-D-21): an UNDETERMINED decision's review task goes to ORG_CHECKER, or to
  ORG_ADMIN when the tenant has no checker (`hasRoleHolder`); the principal whose request produced
  it is excluded; it escalates to ORG_ADMIN after 48 hours. One `rules.decision.record` ledger entry
  per decision stays.
- 53697f5: First release (publishable, PL1-D-20): `RulesService` implements RULES_PORT — rule sets as
  versioned `ipb.decision_table.v1` tables, drafts validated on every engine, publish through an R4
  maker-checker request (`rules.ruleset.publish`), evaluation with a decision log and sealed inputs,
  `UNDETERMINED` to the Work Inbox, `simulate`, `explain` and platform rule sets in `tnt_platform`.
  Migration `rules/0001_init.sql` (PL3-D-18).

### Patch Changes

- Updated dependencies [50093e9]
- Updated dependencies [2725b6c]
- Updated dependencies [dd7a98b]
- Updated dependencies [50093e9]
- Updated dependencies [1ed0659]
- Updated dependencies [53697f5]
- Updated dependencies [dd7a98b]
- Updated dependencies [50093e9]
- Updated dependencies [e268b60]
- Updated dependencies [1ed0659]
- Updated dependencies [2725b6c]
- Updated dependencies [1ed0659]
- Updated dependencies [53697f5]
- Updated dependencies [dd7a98b]
- Updated dependencies [e268b60]
- Updated dependencies [1ed0659]
- Updated dependencies [50093e9]
- Updated dependencies [53697f5]
- Updated dependencies [3951517]
- Updated dependencies [3951517]
- Updated dependencies [dd7a98b]
- Updated dependencies [e268b60]
- Updated dependencies [1ed0659]
- Updated dependencies [53697f5]
- Updated dependencies [dd7a98b]
  - @infrabyx/config@0.3.0
  - @infrabyx/connectors@0.2.0
  - @infrabyx/contracts@0.3.0
  - @infrabyx/crypto@0.3.0
  - @infrabyx/tenancy@0.3.0
