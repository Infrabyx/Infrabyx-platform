---
"@infrabyx/contracts": minor
---

Search refusals for the application shell (Finbyx PR-FBX-09; R1-D-32). `@infrabyx/contracts/search-refusal` adds `searchRefusal(text)`, which refuses any twelve-digit run and a Verhoeff-valid VID (`aadhaar_pattern`), a Luhn-valid card number (`card_pattern`) and a PAN (`pan_pattern`) with `IPB-UX-003` and the pattern class only (IPB-07-17), plus `verhoeffValid` and `luhnValid`. The id prefix `svw` names saved table views.
