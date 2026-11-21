---
"@infrabyx/crypto": minor
---

`verifyDocumentJws` can report which descriptor verified (Udofin PR-UDF-075 (5); R1-D-258), opt-in: with the new option `reportProfile: true` a success is `{ ok: true, kid, profile: "v1" | "v2" }` (typed `DocumentJwsVerification` by an overload). Without the option the result is exactly as before, `{ ok: true, kid }` with no `profile` key, so no existing test or caller sees a change. `DocumentJwsResult`'s success member gains `profile?`; new type exports `DocumentJwsProfile`, `DocumentJwsVerification` and `DocumentJwsVerifyOptions`. No new primitive, key or algorithm.
