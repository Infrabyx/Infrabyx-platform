---
"@infrabyx/tenancy": patch
---

`infrabyx-migrate` names each platform package with migrations that it skipped as not installed, and `--require-all` refuses instead (IPB-MOD-001) before connecting; `platformSources` takes `{ missing: "error" }`, an `onSkipped` callback and several directories to resolve from (PR-FBX-06).
