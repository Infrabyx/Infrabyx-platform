---
"@infrabyx/contracts": minor
"@infrabyx/testing": minor
---

Whose return it is (Finbyx PR-FBX-36, R1-D-97). `ReturnCodeInfo.attribution` and `PresentationResult.returnAttribution`: `BORROWER` (insufficient funds: NACH 04, UPI Z9), `NOT_BORROWER` (NACH 02, 03, 08: account, description or mandate errors) or `UNKNOWN` (NACH 01, 06, 07, 09, and every code the table does not know). `bounceChargeable(info)` is true only for `BORROWER`, so a bounce charge never follows an unknown or non-borrower return. The table stays `[VERIFY]` against the sponsor bank's specification; the testing fake fills the new field.
