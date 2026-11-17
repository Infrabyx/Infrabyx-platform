---
"@infrabyx/connectors": patch
---

Rule engines accept dated parameters (PR-LDC-57, R1-D-175): a parameter with a `schedule` has no default, so compiling without a bound value is refused (`RuleCompileError` `parameter`) instead of compiling on a guess. Setting-backed parameters are unchanged.
