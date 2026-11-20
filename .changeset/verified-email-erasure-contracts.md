---
"@infrabyx/contracts": minor
---

Deleting the verified email (owner answer #161 (3); R1-D-235): new optional `CustomerIdentityPort.eraseVerifiedEmail({ tenantId, userId, requestRef })`, returning `{ erased }`, for the borrower's erasure request; `retireLogin` now documents that it deletes the verified email at account closure. An adapter without the method refuses with IPB-PORT-001 `unsupported`; nothing existing changes for implementers.
