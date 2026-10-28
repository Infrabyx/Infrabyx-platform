---
"@infrabyx/a11y": major
"@infrabyx/ai": major
"@infrabyx/audit": major
"@infrabyx/brand": major
"@infrabyx/cms": major
"@infrabyx/config": major
"@infrabyx/connectors": major
"@infrabyx/consent": major
"@infrabyx/contracts": major
"@infrabyx/crypto": major
"@infrabyx/export": major
"@infrabyx/feedback": major
"@infrabyx/hlp": major
"@infrabyx/notify": major
"@infrabyx/rules": major
"@infrabyx/seed": major
"@infrabyx/tenancy": major
"@infrabyx/testing": major
"@infrabyx/trust": major
"@infrabyx/ui": major
"@infrabyx/vidhi": major
"@infrabyx/workflow": major
---

1.0.0, the platform baseline release (IPB-14 §14.5 item 1; owner answer #67(4), PL6-D-16). Every `@infrabyx/*` package moves to 1.0.0 together; the public API is unchanged from the 0.x set of the PL6 gate (`docs/phases/PL6-gate.md` §6), so a product upgrades by moving every dependency to 1.0.0 at once. From 1.0.0 on, semantic versioning holds: a breaking change to an export, a migration or a setting is a major release with an ADR (IPB-09-34/35).
