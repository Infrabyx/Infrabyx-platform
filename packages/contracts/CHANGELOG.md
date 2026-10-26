# @infrabyx/contracts

## 0.1.0

### Minor Changes

- a17086c: PL1 kernel vocabulary: data classes and residency policy (IPB-02 §02.4.3.1, IPB-01 §01.4.5), prefixed ULID identifiers, the nine-environment catalogue and guard groups (IPB-09-15, IPB-11 §11.2), the role floor (PL1-D-05), settings tiers and risk classes R0–R5, the 99-code error catalogue (incl. IPB-MOD-003 and IPB-UX-011, PL1-D-08) with RFC 9457 rendering (IPB-ENV codes per PL1-D-03), internal (IPB-10-37) and Ecosystem (Spec §3.2) CloudEvents envelopes, the module manifest (IPB-01-10), kernel interfaces, the port catalogue, and the SECRETS, KMS, STORAGE, FEATURE_FLAG and IDENTITY port contracts.

  Audience: developer · Reg: none · Notice class: standard

### Patch Changes

- c2cf60a: PL0 toolchain baseline: pnpm 9 lockfile, Turborepo pipeline, ESLint 10 flat config with the IPB
  rules `ipb/vendor-import`, `ipb/schema-boundary` and `ipb/no-process-env` (placeholders),
  Vitest, Prettier, Renovate per IPB-01 §01.4.1.2, SHA-pinned CI and release workflows, and the
  `ipb:check` structural checks. Released with the seven PL1 packages at 0.1.0 (PL1-D-02 / D-06); the fifteen later-phase packages stay unpublished scaffolds until their own phase.

  Audience: internal · Reg: none · Notice class: standard
