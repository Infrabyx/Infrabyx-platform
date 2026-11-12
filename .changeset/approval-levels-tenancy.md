---
"@infrabyx/tenancy": minor
---

Ordered approval levels (#125, PR-LDC-38; migration `tenancy/0023`): decided in order, tighten-only, a different person at every level, any rejection ends the request, the delay from the last level. `ApprovalRecord` gains `levels`, `currentLevel` and `currentLevelApprovals`.
