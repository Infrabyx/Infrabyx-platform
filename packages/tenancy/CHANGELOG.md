# @infrabyx/tenancy

## 0.1.0

### Minor Changes

- 245318b: PL1 tenancy: tenant context from verified claims only, the PostgreSQL transaction kernel (SET LOCAL, app_rw, statement guard, impersonation and agent guards, ledger-required commit), outbox and inbox, the maker-checker engine with risk-class delays and two-checker tenant delete, break-glass and impersonation, field-level envelope encryption and masking rules, `infrabyx-migrate` with checksums, `infrabyx-rls-lint`, Drizzle and NestJS adapters, and migration `tenancy/0001_init.sql`.

  Audience: developer · Reg: none · Notice class: standard

### Patch Changes

- c2cf60a: PL0 toolchain baseline: pnpm 9 lockfile, Turborepo pipeline, ESLint 10 flat config with the IPB
  rules `ipb/vendor-import`, `ipb/schema-boundary` and `ipb/no-process-env` (placeholders),
  Vitest, Prettier, Renovate per IPB-01 §01.4.1.2, SHA-pinned CI and release workflows, and the
  `ipb:check` structural checks. Released with the seven PL1 packages at 0.1.0 (PL1-D-02 / D-06); the fifteen later-phase packages stay unpublished scaffolds until their own phase.

  Audience: internal · Reg: none · Notice class: standard

- Updated dependencies [c2cf60a]
- Updated dependencies [542194d]
- Updated dependencies [a17086c]
- Updated dependencies [8f44a2c]
  - @infrabyx/config@0.1.0
  - @infrabyx/contracts@0.1.0
  - @infrabyx/crypto@0.1.0
