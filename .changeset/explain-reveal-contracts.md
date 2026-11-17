---
"@infrabyx/contracts": minor
---

Types for an entitled reveal of one CONFIDENTIAL input in `explain` (PR-LDC-59, owner answer #130, R1-D-173): `RevealRequest`, the opaque `RevealEntitlement`, `ExplainOptions`, `REVEAL_REFUSALS`, `REVEAL_GRANT_TTL_MS` (60 s) and the purpose bounds (3 to 200 characters). `RulesPort.explain` takes optional `ExplainOptions`, `RulesPort.entitleReveal` is optional, and an explained input may carry `revealed: true`. New error `IPB-RULE-004` (403, reveal refused, `meta.reason` one of `REVEAL_REFUSALS`) and id prefix `rvg` (reveal grant). Additive only.
