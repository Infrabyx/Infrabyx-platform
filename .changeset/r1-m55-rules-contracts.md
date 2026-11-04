---
"@infrabyx/contracts": minor
---

RULES (R1-plan M55; R1-D-88): `RuleParameter` and `RuleSetBody.parameters` (tenant parameters bound to a registered setting, with type, bounds or allowed values and a default; `ruleParameterValueError`); `RuleSetRef.asOf` (evaluate the version in force at a past instant); `Decision.parameters` and `asOf`, `Explanation.parameters` and `asOf`; `RuleEngine.compile(body, parameters?)`. `simulate` takes `{ ruleSetId, version }`.
