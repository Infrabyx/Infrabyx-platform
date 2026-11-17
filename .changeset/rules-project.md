---
"@infrabyx/rules": minor
---

`RulesService.project` for rule sets created with `purpose: "projection"` (PR-LDC-49; migration `rules/0004`): outcomes for up to 1,000 inputs, with no decision record, ledger entry or decision id. `evaluate` refuses projection sets and `project` refuses decision-grade sets.
