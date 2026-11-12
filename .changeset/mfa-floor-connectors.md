---
"@infrabyx/connectors": minor
---

`assertMfaForRoles(claims, floor?, { stepUp? })` takes a product floor, refuses SMS-only sessions for excluded roles and can answer in RFC 9470 step-up form (`stepUpChallenge`); `assertStepUpReachable` is the boot check for step-up routes (PR-LDC-55). Unchanged without a floor.
