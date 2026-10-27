---
"@infrabyx/contracts": minor
---

`RulesPort` methods take the verified `KernelContext` first (the service runs inside tenancy);
error codes `IPB-RULE-001` (rule set invalid), `-002` (no effective version) and `-003` (version
not in the needed state), registered under PR-017 (PL3-D-18). Unreleased interface, so no product
code changes.
