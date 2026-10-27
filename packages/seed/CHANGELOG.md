# @infrabyx/seed

## 0.2.1

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
- Updated dependencies [3951517]
- Updated dependencies [dd7a98b]
- Updated dependencies [e268b60]
- Updated dependencies [1ed0659]
- Updated dependencies [53697f5]
- Updated dependencies [dd7a98b]
  - @infrabyx/config@0.3.0
  - @infrabyx/contracts@0.3.0
  - @infrabyx/crypto@0.3.0
  - @infrabyx/tenancy@0.3.0
  - @infrabyx/audit@0.1.2

## 0.2.0

### Minor Changes

- 5482043: The super-admin address is configuration: `AUTH_SUPER_ADMIN_EMAIL` (optional) sets it, and without it the persona uses the placeholder `super.admin@example.test`; no personal address ships in the package any more. `personasFor(product, superAdminEmail?)`, `RunSeedOptions.superAdminEmail`, `CredentialsOptions.superAdminEmail` and `checkCredentialsFile(text, product, superAdminEmail?)` carry it, and `findRealIdentifiers` takes the allowed address as a third argument. Products set `AUTH_SUPER_ADMIN_EMAIL` in their local environment (PL2-D-63).

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
- Updated dependencies [7a36249]
- Updated dependencies [13c7379]
- Updated dependencies [13c7379]
- Updated dependencies [13c7379]
- Updated dependencies [0c4535d]
- Updated dependencies [0c4535d]
- Updated dependencies [858a76a]
  - @infrabyx/crypto@0.2.0
  - @infrabyx/config@0.2.0
  - @infrabyx/contracts@0.2.0
  - @infrabyx/tenancy@0.2.0
  - @infrabyx/audit@0.1.1

## 0.1.0

### Minor Changes

- c61454d: PL1 seed framework: production refusal first (IPB-SEED-001/002, SeedRefused), deterministic faker and namespace-hash IDs, idempotent upserts with an inserted/updated/unchanged report, the "no real identifier" validator and synthetic generators, the platform seed (three tenants, personas of every product, fut.* flags OFF), exact purge from `seed.seed_row`, seed credentials through the SECRETS and IDENTITY ports with a 0600 file and one stdout line, the `infrabyx-seed` CLI, and migration `seed/0001_init.sql`.

  Audience: developer · Reg: none · Notice class: standard

### Patch Changes

- c2cf60a: PL0 toolchain baseline: pnpm 9 lockfile, Turborepo pipeline, ESLint 10 flat config with the IPB
  rules `ipb/vendor-import`, `ipb/schema-boundary` and `ipb/no-process-env` (placeholders),
  Vitest, Prettier, Renovate per IPB-01 §01.4.1.2, SHA-pinned CI and release workflows, and the
  `ipb:check` structural checks. Released with the seven PL1 packages at 0.1.0 (PL1-D-02 / D-06); the fifteen later-phase packages stay unpublished scaffolds until their own phase.

  Audience: internal · Reg: none · Notice class: standard

- Updated dependencies [c2cf60a]
- Updated dependencies [7dc104c]
- Updated dependencies [542194d]
- Updated dependencies [a17086c]
- Updated dependencies [8f44a2c]
- Updated dependencies [245318b]
  - @infrabyx/audit@0.1.0
  - @infrabyx/config@0.1.0
  - @infrabyx/contracts@0.1.0
  - @infrabyx/crypto@0.1.0
  - @infrabyx/tenancy@0.1.0
