# ADR-0011 — A `fakes` package beside `testing`

- **Status:** Accepted — Finbyx PR-FBX-48, priority 1 (owner, 18 Nov 2026; R1-D-180, R1-D-181); confirmation of the new package asked in OWNER-QUESTIONS #137; spec request PR-045
- **Date:** 2026-11-18
- **Deciders:** owner (`@infrabyx/platform-owners`)
- **IPB sections:** IPB-14 §14.2 (repository layout), IPB-01-15 (fakes and contract suites), IPB-09 (supply chain, `pnpm audit --prod --audit-level high`)

## Context

IPB-14 §14.2 lists 22 packages; `testing` carries "port contract tests, Testcontainers helpers, NN test harness" and, in practice, every port fake. Products wire the fakes at runtime in fixture environments, so they list `@infrabyx/testing` in `dependencies`. A resolved optional peer is recorded under the dependant's `optionalDependencies` in pnpm's lockfile, so `vitest` (and through it `picomatch`, GHSA-fc5q-39xc-vjpf) is in every such product's production tree, and so are Testcontainers and `pg`. No entry point inside `testing` changes its manifest, so only a separate package removes them (plan `docs/phases/R1-runtime-fakes-plan.md` §1).

## Decision

Add `packages/fakes`, published as `@infrabyx/fakes` 1.0.0: the in-memory fakes and fixtures of every port, with runtime dependencies `@infrabyx/contracts`, `@infrabyx/crypto` and `@infrabyx/config` only and no peers. `@infrabyx/testing` depends on it and re-exports every name unchanged. The contract cases, NN suites, stubs and database helpers stay in `testing`. A package test forbids any import of a test runner, container library, database driver or `@infrabyx/testing` from `fakes`.

## Verification

`testing`'s runtime (176) and type-level (263) exports equal those of `main`; its 281 tests pass against the moved fakes; `pnpm deploy --prod` of the reference API holds 422 packages instead of 635, with no `vitest`, `vite`, `picomatch`, `tinyglobby`, `testcontainers` or `@infrabyx/testing`; the deployed `dist/services.js` loads.

## Consequences

Products install `@infrabyx/fakes` for runtime fakes and keep `@infrabyx/testing` for tests only. The platform has 23 published packages; the BOM and attestations pick the new one up from the workspace. A fake is changed in `packages/fakes`; its contract cases still change in `packages/testing`. IPB-14 §14.2 needs one line for `fakes/` (PR-045).
