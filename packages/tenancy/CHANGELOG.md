# @infrabyx/tenancy

## 0.6.0

### Minor Changes

- 9d8cd8c: PL6 session 2: `infrabyx-migrate --db-file <path>` reads the database URL from the first line of a file, so the `infrabyx-app` chart's migration job takes it from the secrets CSI mount and the password never appears in arguments or the environment (IPB-02-28). `--db` still works; passing both is refused.

### Patch Changes

- Updated dependencies [b3934f9]
  - @infrabyx/config@0.5.1

## 0.5.0

### Minor Changes

- e8e83cb: `infrabyx-migrate` applies `@infrabyx/brand` migrations after `@infrabyx/vidhi` when the package is installed.

### Patch Changes

- b0dc390: `infrabyx-migrate` applies `@infrabyx/cms` migrations after `@infrabyx/brand`.
- 686d24b: `infrabyx-migrate` applies `@infrabyx/consent` migrations after `@infrabyx/cms`.
- 275d4ba: `infrabyx-migrate` applies `@infrabyx/feedback` and then `@infrabyx/trust` migrations after `@infrabyx/consent`.
- Updated dependencies [de53086]
- Updated dependencies [de53086]
- Updated dependencies [f1a36a1]
- Updated dependencies [1fecf45]
- Updated dependencies [1fecf45]
- Updated dependencies [b0dc390]
- Updated dependencies [b0dc390]
- Updated dependencies [275d4ba]
- Updated dependencies [934355c]
- Updated dependencies [686d24b]
- Updated dependencies [e8e83cb]
- Updated dependencies [275d4ba]
- Updated dependencies [36338c3]
- Updated dependencies [934355c]
- Updated dependencies [b7de3c6]
  - @infrabyx/config@0.5.0
  - @infrabyx/contracts@0.5.0
  - @infrabyx/crypto@0.4.1

## 0.4.0

### Minor Changes

- 183c532: `memberStatus(tx, userId)`: whether a member of the transaction's tenant is active and the roles they hold now, for background re-checks such as scheduled Vidhi runs (PL4-D-09).

### Patch Changes

- 200b25a: `infrabyx-migrate` applies `@infrabyx/ai` migrations after `export` (PL4-D-03).
- b205b1d: `infrabyx-migrate` applies `@infrabyx/vidhi` migrations after `ai` (PL4 session 6).
- Updated dependencies [2b07109]
- Updated dependencies [200b25a]
- Updated dependencies [f6e9a88]
- Updated dependencies [f6e9a88]
- Updated dependencies [200b25a]
- Updated dependencies [9af583a]
- Updated dependencies [288ae44]
- Updated dependencies [b205b1d]
- Updated dependencies [183c532]
- Updated dependencies [f6e9a88]
  - @infrabyx/contracts@0.4.0
  - @infrabyx/config@0.4.0
  - @infrabyx/crypto@0.4.0

## 0.3.0

### Minor Changes

- 3951517: Cross-tenant service readers (owner answer #22, PL3-D-21): `ServiceReader`, `serviceReaderContext`
  and `serviceReaderRole`. The kernel runs a reader's platform-scope read as its own database role,
  refuses every reader mutation except the `platform.service_read` ledger entry for its own read,
  and `contextFromClaims` refuses a token that claims a reader role. Each read that returns rows is
  ledgered in every tenant it touched. Also `tenantHasRoleHolder` for the rules review assignee.
- dd7a98b: Maker-checker additions (PL3-D-07, PL3-D-08, PL3-D-19), migration `tenancy/0002_approvals_pl3.sql`
  (expand-only): requests expire after 7 days, or 72 hours for R4, R5 and financial R3
  (`expire`, terminal, `IPB-UX-012`, `ApprovalExpired`); `remind` and `escalate` (to `ORG_ADMIN`,
  `ApprovalEscalated`, never decides); the checker `diff` (field names only above INTERNAL); the
  tighten-only tenant policy hook for `mc.checker_roles` and `mc.dual_checker_above`;
  `PLT_SECURITY_OFFICER` may cancel (IPB-02-80); `observers` called inside each transition's
  transaction. Products run `infrabyx-migrate` to apply 0002.
- e268b60: `PgKernel.read(ctx, fn, { snapshot: true })` runs a REPEATABLE READ read-only transaction, and
  `infrabyx-migrate` applies `@infrabyx/export` migrations when the package is installed (PL3-D-22).
- 1ed0659: `infrabyx-migrate` applies `@infrabyx/notify` migrations (after `@infrabyx/workflow`).
- 53697f5: `infrabyx-migrate` applies `@infrabyx/rules` migrations (after `@infrabyx/connectors`) when the
  package is installed.
- dd7a98b: `infrabyx-migrate` applies `@infrabyx/workflow` migrations (after `@infrabyx/rules`).

### Patch Changes

- Updated dependencies [50093e9]
- Updated dependencies [2725b6c]
- Updated dependencies [dd7a98b]
- Updated dependencies [50093e9]
- Updated dependencies [e268b60]
- Updated dependencies [1ed0659]
- Updated dependencies [2725b6c]
- Updated dependencies [1ed0659]
- Updated dependencies [53697f5]
- Updated dependencies [dd7a98b]
- Updated dependencies [e268b60]
- Updated dependencies [1ed0659]
- Updated dependencies [50093e9]
- Updated dependencies [53697f5]
- Updated dependencies [3951517]
  - @infrabyx/config@0.3.0
  - @infrabyx/contracts@0.3.0
  - @infrabyx/crypto@0.3.0

## 0.2.0

### Minor Changes

- 7a36249: `FieldCrypto` seals with envelope format v2 under `{ tenant_id, purpose: "field" }` (PL2-D-50), adds `rewrapField` and `formatVersion`; v1 fields stay readable.
- 858a76a: `infrabyx-migrate` applies `@infrabyx/connectors` migrations after seed whenever the package is
  installed, so products keep a single migrate command (PL2-D-34).

### Patch Changes

- Updated dependencies [5482043]
- Updated dependencies [efd00ab]
- Updated dependencies [2969424]
- Updated dependencies [858a76a]
- Updated dependencies [9ac878e]
- Updated dependencies [ded1ae2]
- Updated dependencies [9c774b9]
- Updated dependencies [9ac878e]
- Updated dependencies [9ac878e]
- Updated dependencies [858a76a]
- Updated dependencies [7a36249]
- Updated dependencies [7a36249]
- Updated dependencies [13c7379]
- Updated dependencies [13c7379]
- Updated dependencies [13c7379]
- Updated dependencies [0c4535d]
- Updated dependencies [0c4535d]
  - @infrabyx/crypto@0.2.0
  - @infrabyx/config@0.2.0
  - @infrabyx/contracts@0.2.0

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
