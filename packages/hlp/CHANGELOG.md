# @infrabyx/hlp

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
