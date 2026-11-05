---
"@infrabyx/contracts": minor
"@infrabyx/testing": minor
---

Whose return it is (Finbyx PR-FBX-36; the owner's table, OWNER-QUESTIONS #119; R1-D-97, R1-D-98). `ReturnCodeInfo.attribution` and `PresentationResult.returnAttribution`: `BORROWER` for NACH 04 (balance insufficient), NACH 01 (account closed), NACH 06 (payment stopped by drawer) and UPI Z9 (insufficient funds); `NOT_BORROWER` for NACH 07, 09, every other code and every unknown code (no charge). `bounceChargeable(info)` is true only for `BORROWER`. The table is a platform floor: `classifyReturnCode(channel, code, { borrowerCodes })` takes a tenant's list, which can only shrink the borrower's codes, never widen them. `[VERIFY]` against the sponsor bank's NPCI specification; the testing fake fills the new field.
