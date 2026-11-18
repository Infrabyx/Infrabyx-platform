---
"@infrabyx/testing": minor
---

`AccountingScript.settle` may return a promise; the ACCOUNTING contract cases await it (PR-FBX-46, R1-D-178). The fake is unchanged.
