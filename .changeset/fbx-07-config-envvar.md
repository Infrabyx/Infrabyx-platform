---
"@infrabyx/config": patch
---

`envVar` clones a schema that already carries metadata, so a shared schema (`ProductCode`, `AppEnv`) declared twice keeps each declaration's own (`required`, example, description); before, the later one replaced the earlier, which made the seed CLI's optional refusal-gate `APP_PRODUCT` required (PR-FBX-04 note).
