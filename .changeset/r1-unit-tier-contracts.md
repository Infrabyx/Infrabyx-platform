---
"@infrabyx/contracts": minor
---

The UNIT setting tier (PR-042, IPB-07-38 as amended by the owner; LawDocsComply PR-LDC-17; R1-D-95): `SETTING_TIERS` is now PLATFORM → PLAN → BRAND → TENANT → ENTITY → UNIT → USER, UNIT being an organisation unit, department or function (`displayTier` ORG). `KernelContext.unitIds` (optional) carries the caller's units, outermost first, from the product's own organisation model.
