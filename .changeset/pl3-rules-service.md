---
"@infrabyx/rules": minor
---

First release (publishable, PL1-D-20): `RulesService` implements RULES_PORT — rule sets as
versioned `ipb.decision_table.v1` tables, drafts validated on every engine, publish through an R4
maker-checker request (`rules.ruleset.publish`), evaluation with a decision log and sealed inputs,
`UNDETERMINED` to the Work Inbox, `simulate`, `explain` and platform rule sets in `tnt_platform`.
Migration `rules/0001_init.sql` (PL3-D-18).
