# @infrabyx/audit

## 1.2.3

### Patch Changes

- Updated dependencies [7e38652]
- Updated dependencies [7e38652]
  - @infrabyx/contracts@1.4.0
  - @infrabyx/crypto@1.1.0
  - @infrabyx/config@1.0.6

## 1.2.2

### Patch Changes

- Updated dependencies [b6058d3]
  - @infrabyx/contracts@1.3.0
  - @infrabyx/config@1.0.5
  - @infrabyx/crypto@1.0.3

## 1.2.1

### Patch Changes

- Updated dependencies [1c869a8]
  - @infrabyx/config@1.0.4

## 1.2.0

### Minor Changes

- 75e9ea4: `AuditSweep` (PR-UDF-013): `verifyAll()` for the weekly chain verification and `anchorAll(date)` for the daily anchor of every tenant (IPB-02-51), over `TenantSweep`.

### Patch Changes

- Updated dependencies [75e9ea4]
  - @infrabyx/contracts@1.2.0
  - @infrabyx/config@1.0.3
  - @infrabyx/crypto@1.0.2

## 1.1.1

### Patch Changes

- Updated dependencies [8a2587e]
  - @infrabyx/config@1.0.2

## 1.1.0

### Minor Changes

- 588b509: Migration `audit/0002` lets the outbox relay (`svc_outbox_relay`, R1-D-01) append the ledger entry of each batch it dispatches, under the ledger's tenant and actor policy; no read and no other table.

### Patch Changes

- Updated dependencies [588b509]
  - @infrabyx/contracts@1.1.0
  - @infrabyx/config@1.0.1
  - @infrabyx/crypto@1.0.1

## 1.0.0

### Major Changes

- 9ec9a2c: 1.0.0, the platform baseline release (IPB-14 §14.5 item 1; owner answer #67(4), PL6-D-16). Every `@infrabyx/*` package moves to 1.0.0 together; the public API is unchanged from the 0.x set of the PL6 gate (`docs/phases/PL6-gate.md` §6), so a product upgrades by moving every dependency to 1.0.0 at once. From 1.0.0 on, semantic versioning holds: a breaking change to an export, a migration or a setting is a major release with an ADR (IPB-09-34/35).

### Patch Changes

- Updated dependencies [9ec9a2c]
  - @infrabyx/config@1.0.0
  - @infrabyx/contracts@1.0.0
  - @infrabyx/crypto@1.0.0

## 0.1.5

### Patch Changes

- Updated dependencies [b3934f9]
  - @infrabyx/config@0.5.1

## 0.1.4

### Patch Changes

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

## 0.1.3

### Patch Changes

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

## 0.1.2

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

## 0.1.1

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

- 7dc104c: PL1 audit ledger: database-computed SHA-256 hash chain over RFC 8785 canonical JSON with per-tenant heads, insert-only for every role, actor bound to the verified context, correction entries, a TypeScript verifier that reports the first break and emits LedgerChainBroken, and signed daily anchors written with retention through the STORAGE and KMS ports. Migration `audit/0001_init.sql`.

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
