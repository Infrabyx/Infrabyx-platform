---
"@infrabyx/a11y": patch
"@infrabyx/ai": patch
"@infrabyx/audit": patch
"@infrabyx/brand": patch
"@infrabyx/cms": patch
"@infrabyx/config": patch
"@infrabyx/connectors": patch
"@infrabyx/consent": patch
"@infrabyx/contracts": patch
"@infrabyx/crypto": patch
"@infrabyx/export": patch
"@infrabyx/feedback": patch
"@infrabyx/hlp": patch
"@infrabyx/notify": patch
"@infrabyx/rules": patch
"@infrabyx/seed": patch
"@infrabyx/tenancy": patch
"@infrabyx/testing": patch
"@infrabyx/trust": patch
"@infrabyx/ui": patch
"@infrabyx/vidhi": patch
"@infrabyx/workflow": patch
---

PL0 toolchain baseline: pnpm 9 lockfile, Turborepo pipeline, ESLint 10 flat config with the IPB
rules `ipb/vendor-import`, `ipb/schema-boundary` and `ipb/no-process-env` (placeholders),
Vitest, Prettier, Renovate per IPB-01 §01.4.1.2, SHA-pinned CI and release workflows, and the
`ipb:check` structural checks. No runtime code; every package is still a scaffold exporting
`PACKAGE_NAME`.

Audience: internal · Reg: none · Notice class: standard
