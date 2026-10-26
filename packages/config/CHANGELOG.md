# @infrabyx/config

## 0.1.0

### Minor Changes

- 542194d: PL1 config: typed environment schema helpers and boot loader with the IPB-11 guard table and supabase-guard (exit 78, names only, never values), secret:// resolution through the SECRETS port, schema-driven redaction and the `infrabyx-env example [--check]` generator; the settings registry generated from `settings-tree.yaml` with typed reads, scope precedence, tighten-only and locked enforcement, ledgered writes and maker-checker routing; the flag registry (`kill.*`, IPB-12 `fut.*`) with snapshot fallback and kill-switch safe state; migration `config/0001_init.sql`.

  Audience: developer · Reg: none · Notice class: standard

### Patch Changes

- c2cf60a: PL0 toolchain baseline: pnpm 9 lockfile, Turborepo pipeline, ESLint 10 flat config with the IPB
  rules `ipb/vendor-import`, `ipb/schema-boundary` and `ipb/no-process-env` (placeholders),
  Vitest, Prettier, Renovate per IPB-01 §01.4.1.2, SHA-pinned CI and release workflows, and the
  `ipb:check` structural checks. Released with the seven PL1 packages at 0.1.0 (PL1-D-02 / D-06); the fifteen later-phase packages stay unpublished scaffolds until their own phase.

  Audience: internal · Reg: none · Notice class: standard

- Updated dependencies [c2cf60a]
- Updated dependencies [a17086c]
- Updated dependencies [8f44a2c]
  - @infrabyx/contracts@0.1.0
  - @infrabyx/crypto@0.1.0
