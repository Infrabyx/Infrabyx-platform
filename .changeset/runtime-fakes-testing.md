---
"@infrabyx/testing": minor
---

PR-FBX-48 (R1-D-181): the port fakes and their fixtures now live in the new `@infrabyx/fakes` package, which has no `vitest`, Testcontainers or database driver in its tree. `@infrabyx/testing` depends on it and re-exports every name unchanged (the same runtime and type exports as 1.20.0), so test files need no change. A product that wires fakes in a fixture environment at runtime imports them from `@infrabyx/fakes`, lists it in `dependencies`, and keeps `@infrabyx/testing` in `devDependencies` only; its production tree then no longer carries `vitest` and `picomatch` (GHSA-fc5q-39xc-vjpf).
