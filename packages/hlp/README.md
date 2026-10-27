# @infrabyx/hlp

The "i" help system: the glossary registry and popover content, the public glossary, `hlp-lint` and onboarding tours (IPB-07).

**Specified by:** `docs/ipb/` IPB-07 (§07.3.4 help system, §07.3.5 tours, §07.4.3 entry schema, §07.4.4 popover). Its acceptance tests are the `@IPB-07-AT-..` scenarios tagged in `src`.

**Status:** PL5 session 3. The package stays private until the PL5 gate (`docs/phases/PL5-plan.md` §5.1).

## Registry

One YAML file per module, `module: <module>` plus `entries:`, each entry in the IPB-07 §07.4.3 shape (`key: hlp.<module>.<term>`, `term`, `plain` of at most 40 words, `explanation`, `regulatory_reference`, `links`, `locales`, `reviewer_of_record`, `effective_date`, `status`, `superseded_by`, `visibility`). Keys never change; retire one with `status: deprecated` and `superseded_by`.

- `loadRegistry(dirs)` and `HelpRegistry.resolve(key, locale)` give the popover content for `@infrabyx/ui`'s `HelpButton`. A missing locale falls back to Hindi, then English, with `translationPending` set.
- `publicGlossary(entries, locale)` lists published public entries A–Z, linked at `/glossary/<module>/<term>`.
- `lintTours` and `tourActions` cover tours of at most seven steps that never run on a regulated step and can be resumed where they were skipped.

## CLI

```sh
infrabyx-hlp lint --registry registry --keys src packages/config/settings-tree.yaml --tours tours.yaml --journeys journeys.yaml
```

The lint fails on `IPB-HLP-001` (a key used but absent, or only a draft on the production branch; pass `--allow-draft` elsewhere), `IPB-HLP-002` (a plain definition over 40 words), `IPB-HLP-003` (a LAW citation without a `PLT_LEGAL_REVIEWER` reviewer of record), `IPB-HLP-004` (a referenced key deprecated without `superseded_by`) and `IPB-TUT-003` (a tour over seven steps or on a regulated step). `hlp.shared.*` keys resolve in the shared group registry and are accepted.
