# @infrabyx/hlp

## 1.1.1

### Patch Changes

- 51f612d: Two help entries for checklists: `hlp.checklist.run` and `hlp.checklist.item_not_met` (R1-D-326).

## 1.1.0

### Minor Changes

- 0ce89ca: Udofin PR-UDF-080 (R1-D-269): new public help entry `hlp.int.storage_integrity` ("File failed its safety check"), the help key of `IPB-STOR-005`: the file no longer matches the saved copy, so it was not opened or used, and trying again will not help.

## 1.0.1

### Patch Changes

- 955cc67: TallyPrime agent key notices (owner answer #139 (1); R1-D-186). `TallyAgentService.sendKeyNotices(ctx)` tells the tenant's administrators on day 80 and again on day 85 of an agent's key, once each, through the new platform notification class `accounting.agent_key_expiring` (mandatory, in-app and email); `TallyAgentView.keyNoticeDay`; `TALLY_AGENT_KEY_NOTICE_DAYS` and `TALLY_AGENT_KEY_NOTICE_CLASS`. From day 90 the gateway's 403 says how to re-enrol (`keyExpiredDetail`). Migration `connectors/0009` (expand-only): `tally_agent.key_notice_day`. Help entry `hlp.notify.accounting.agent_key_expiring`.

## 1.0.0

### Major Changes

- 9ec9a2c: 1.0.0, the platform baseline release (IPB-14 §14.5 item 1; owner answer #67(4), PL6-D-16). Every `@infrabyx/*` package moves to 1.0.0 together; the public API is unchanged from the 0.x set of the PL6 gate (`docs/phases/PL6-gate.md` §6), so a product upgrades by moving every dependency to 1.0.0 at once. From 1.0.0 on, semantic versioning holds: a breaking change to an export, a migration or a setting is a major release with an ADR (IPB-09-34/35).

## 0.1.0

### Minor Changes

- e8e83cb: The help system for PL5 (IPB-07 §07.3.4–§07.3.5):

  - **Registry:** the glossary entry schema and registry loader, with popover content resolved per locale (falling back to Hindi, then English).
  - **Public glossary:** published public entries only (`@IPB-07-AT-17`).
  - **`infrabyx-hlp lint`:** reports `IPB-HLP-001` to `004` (`@IPB-07-AT-02`, `@IPB-07-AT-15`). It collects keys from components, the settings tree, the error catalogue and the notification catalogue.
  - **Tours:** at most seven steps, never on a regulated step, resumable where skipped (`IPB-TUT-003`, `@IPB-07-AT-19`).

  The package stays private until the PL5 gate.

- b7de3c6: PL5 session 7: the platform help registry ships with the package (`registry/<module>.yaml`, `PLATFORM_REGISTRY_DIR`, `@infrabyx/hlp/registry/*`), with an entry for every help key the platform packages use. `hlp-lint` now counts only quoted `hlp.*` literals in code (expressions such as `v.help` and comment lines are not keys) and `help_key:`/`help:` fields in YAML and JSON, skips generated files and quoted key prefixes ending in a dot (`"hlp.web.field."`).
- b50922c: PL5 session 8a: the platform registry gains the `studio` module (`hlp.studio.*`, internal): the help of every Studio screen field.

### Patch Changes

- 1076df2: PL5 session 8b: help entries for the Policies, Consent texts and Feedback screen fields (`hlp.studio.*`).
- f1da214: PL5 session 9: the `hlp.studio.persona` help entry (the reference console's fixture sign-in).
