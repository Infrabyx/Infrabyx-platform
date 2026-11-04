---
"@infrabyx/rules": minor
---

`RulesService` (R1-plan M55; R1-D-86, R1-D-88): rule parameters from the product's settings (`settings` option; drafts refuse unregistered keys; an invalid tenant value is UNDETERMINED `parameter_invalid`; values and their source in the decision log and `explain`); `evaluate(ctx, { ruleSetId, asOf }, input)` against the version in force then; `publishCheckerRoles` adds a product's tenant roles to the publish checkers (#109); `prepare(ctx, ruleSetIds?)` compiles the in-force versions ahead of traffic, and an executed publish compiles its version. Migration `rules/0002` adds `decision_log.parameters` and `as_of` (expand-only).
