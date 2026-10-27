---
"@infrabyx/testing": patch
---

PL5 gate: `infrabyx-at-report` reads `.tsx` and `.e2e.test.*` files, three-digit AT ids (`@IPB-04-AT-101`) and skips `.next` build output; the repository's `at:report` now scans the whole repository, apps included.
