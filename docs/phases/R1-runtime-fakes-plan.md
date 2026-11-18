# R1 — runtime fakes without the test runner (Finbyx PR-FBX-48)

**Decision:** R1-D-181 · **ADR:** ADR-0011 · **Spec request:** PR-045 (IPB-14 §14.2) · **Owner question:** #137 · **Priority:** 1 (owner, 18 Nov 2026; R1-D-180)

## 1. Problem

`@infrabyx/testing` holds two different things: the port fakes (`MemoryStorage`, `FakeKyc`, `FakeAccountingSink`, …) that products wire into fixture environments **at runtime**, and the contract harness (`defineContractSuite`, the `*ContractCases`, the NN suites, `startPostgres`) that only runs under vitest. The fakes sit in the same modules as the contract cases, which import `vitest`, so a product that imports a fake must install `vitest`. `testing` also lists Testcontainers, `pg` and `libpg-query` as runtime dependencies.

`vitest` is already an optional peer of `testing` (not a dependency, as the request says), but that does not help: pnpm records a resolved optional peer under the package's `optionalDependencies` in the lockfile (checked on 18 Nov 2026 with pnpm 10.34.7 and a two-package project: the peer appears under the dependant's `optionalDependencies` snapshot), so `pnpm audit --prod` and `pnpm deploy --prod` both follow it. That is how GHSA-fc5q-39xc-vjpf (`picomatch` <= 4.0.7, no fixed release) reached every product's production audit and this repository's reference API image (R1-D-174). A second entry point inside `testing` (the request's second option) would leave the same manifest, so the same tree: it cannot fix the audit.

## 2. Design

- A new package **`@infrabyx/fakes`** (`packages/fakes`) holds every fake and its fixtures. Its runtime dependencies are `@infrabyx/contracts`, `@infrabyx/crypto` and `@infrabyx/config` only; no peers; `vitest` only as a devDependency for its own test.
- `@infrabyx/testing` depends on `@infrabyx/fakes` and **re-exports every moved name from the module it came from**, so its runtime and type exports are byte-for-byte the same list (176 runtime names, 263 type-level names, compared against `main`). No product test changes. A fake is the same object whichever package it is imported from.
- The split is mechanical, by a TypeScript AST pass over each module: a declaration moves only if an exported fake reaches it and it does not reach `vitest`, the contract harness, the HTTP stubs or the context builders. Contract-only helpers stay in `testing`; a few small pure helpers both halves use (a constant prefix, an error-code reader) are duplicated rather than exported. `stubPng` moves to `fakes` (the image fakes use it) and `testing`'s stubs re-export it.
- The apps that wire fakes at runtime (`apps/reference/api`, `apps/public`, `apps/console`) import them from `@infrabyx/fakes`; `@infrabyx/testing` becomes a devDependency where a test uses it, and is gone from `console`.
- The R1-D-174 `picomatch` waiver is removed from `infra/docker/trivyignore.yaml`: the reference API's production deploy no longer contains `picomatch`, `vitest`, `vite`, `tinyglobby`, `testcontainers` or `@infrabyx/testing` (422 packages against 635 on `main`).

## 3. Versions

`@infrabyx/fakes` 1.0.0 (new; Changesets publishes a package missing from the registry at its version), `@infrabyx/testing` minor (a new dependency; no API change). Private apps change only their imports and manifests.

## 4. Tests

- `packages/fakes/src/boundary.test.ts`: no module imports `vitest`, `@vitest/*`, `vite`, Testcontainers, `pg`, `libpg-query` or `@infrabyx/testing`; the runtime dependencies are exactly the three; the products' fakes are exported; a fake works with no harness loaded.
- `packages/testing/src/fakes-reexport.test.ts`: every name `@infrabyx/fakes` exports is the same object through `@infrabyx/testing`.
- All existing `testing` tests (281) run unchanged against the moved fakes; the apps' unit tests; the `containers` job scans the reference images without the waiver.
- Manual (recorded in R1-D-181): `pnpm deploy --prod` of the reference API before and after, and the deployed `dist/services.js` loads.

## 5. Exit-gate checklist

- [x] `fakes` and `testing` build, type-check, lint and test; runtime and type exports of `testing` equal `main`'s.
- [x] Apps build, type-check, lint and test with the new imports.
- [x] Production deploy of the reference API without `vitest` or `picomatch`.
- [ ] `pnpm check:full` green; CI `ci:run` green, `containers` included, without the waiver.

## 6. Owner decisions needed

None blocking. #137 asks the owner to confirm the 23rd package (ADR-0011, PR-045) and notes that a package first published by the release workflow takes the repository's visibility: this repository is public, so `@infrabyx/fakes` may appear public while the others are private ([VERIFY] after the first publish). Its source is public here already; the owner may set the package private in its settings, which changes nothing for products reading with `NPM_READ_TOKEN`.

## 7. Products (adopt)

Import fakes used at runtime from `@infrabyx/fakes`, add it to `dependencies`, move `@infrabyx/testing` to `devDependencies`, and drop the audit exception (Finbyx to 17 Dec 2026). Product guide §7cl.
