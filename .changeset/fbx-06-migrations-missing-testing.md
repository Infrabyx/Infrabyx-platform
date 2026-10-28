---
"@infrabyx/testing": patch
---

`startPostgres` resolves platform packages from the current directory (the caller's package) and then from `@infrabyx/testing`, names any package whose migrations it skipped, and refuses with `requirePlatform: true` (PR-FBX-06).
