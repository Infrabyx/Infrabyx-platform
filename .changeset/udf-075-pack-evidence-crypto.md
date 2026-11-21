---
"@infrabyx/crypto": minor
---

`verifyDocumentJws` reports which descriptor verified (Udofin PR-UDF-075 (5); R1-D-258): a success is `{ ok: true, kid, profile: "v1" | "v2" }`. The declared return type is the new `DocumentJwsVerification`, a subtype of `DocumentJwsResult`, whose success member gains `profile?` (optional, so a value built by hand still type-checks). No new primitive, key or algorithm. A test that compares a success with `toEqual({ ok: true, kid })` now needs `profile` (or `toMatchObject`).
