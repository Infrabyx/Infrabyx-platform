# @infrabyx/crypto

## 0.1.0

### Minor Changes

- 8f44a2c: PL1 crypto-provider module, the single cryptography call-site (IPB-12-05): RFC 8785 canonical JSON, SHA-256, HMAC-SHA-256 pseudonyms, AES-256-GCM field envelopes with per-tenant data keys from the KMS port (cached ≤ 5 min, rotated after 2^20 uses), HMAC blind indexes, KMS-backed ECDSA P-256 signature records, ULIDs and deterministic seed IDs, IPB-11 seed passwords, an algorithm registry with CycloneDX CBOM export, and LocalKms for local/dev/test with published dev-key fingerprints. node:crypto only (decisions PL1-C-01 to C-10).

  Audience: developer · Reg: none · Notice class: standard

### Patch Changes

- c2cf60a: PL0 toolchain baseline: pnpm 9 lockfile, Turborepo pipeline, ESLint 10 flat config with the IPB
  rules `ipb/vendor-import`, `ipb/schema-boundary` and `ipb/no-process-env` (placeholders),
  Vitest, Prettier, Renovate per IPB-01 §01.4.1.2, SHA-pinned CI and release workflows, and the
  `ipb:check` structural checks. Released with the seven PL1 packages at 0.1.0 (PL1-D-02 / D-06); the fifteen later-phase packages stay unpublished scaffolds until their own phase.

  Audience: internal · Reg: none · Notice class: standard

- Updated dependencies [c2cf60a]
- Updated dependencies [a17086c]
  - @infrabyx/contracts@0.1.0
