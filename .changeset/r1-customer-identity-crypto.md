---
"@infrabyx/crypto": minor
---

DPoP proof verification for customer sessions (RFC 9449; owner answer #84, R1-D-18): `verifyDpopProof` (ES256 only, strict header, key and claim shapes, `htm`/`htu`/`ath` binding, a short `iat` window, the expected `jkt`, `jti` claimed once per key after the proof verifies), `jwkThumbprint` (RFC 7638), `accessTokenHash` and `normaliseHtu`.
