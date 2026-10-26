---
"@infrabyx/audit": patch
"@infrabyx/config": patch
"@infrabyx/contracts": patch
"@infrabyx/crypto": patch
"@infrabyx/seed": patch
"@infrabyx/tenancy": patch
"@infrabyx/testing": patch
---

PL0 toolchain baseline: pnpm 9 lockfile, Turborepo pipeline, ESLint 10 flat config with the IPB
rules `ipb/vendor-import`, `ipb/schema-boundary` and `ipb/no-process-env` (placeholders),
Vitest, Prettier, Renovate per IPB-01 §01.4.1.2, SHA-pinned CI and release workflows, and the
`ipb:check` structural checks. Released with the seven PL1 packages at 0.1.0 (PL1-D-02 / D-06); the fifteen later-phase packages stay unpublished scaffolds until their own phase.

Audience: internal · Reg: none · Notice class: standard
