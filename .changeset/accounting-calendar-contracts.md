---
"@infrabyx/contracts": minor
---

Two port interfaces: `AccountingSinkPort` on `ACCOUNTING` (PR-FBX-46; `post`, `status`, `replay`, `trialBalance`, `assertBalancedBatch`: balanced integer paise, idempotent on journal id and digest) and `CalendarPort` on `CALENDAR` (PR-LDC-53; PKCE connect, idempotent entries by external id, `calendarPayload` detail levels). Both are catalogued with an interface.
