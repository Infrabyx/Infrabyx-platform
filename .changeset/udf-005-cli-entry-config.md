---
"@infrabyx/config": patch
---

The `infrabyx-*` CLI entry points run when started through a `node_modules` symlink (`pnpm exec`, npm `.bin`, `node node_modules/@infrabyx/config/…`); before, they exited 0 without running (PR-UDF-005).
