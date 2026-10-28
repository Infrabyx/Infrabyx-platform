---
"@infrabyx/crypto": minor
---

JWS for regulated Ecosystem messages (Spec §3.6; G5, R1-D-08): `signRegulatedMessage` (detached ES256 over the JCS form of the CloudEvent, through KMS `sign`, with `kid`, `iat` and `jti` in the protected header), `verifyRegulatedMessage` (ES256 only, strict header allow-list, short `iat` window, `jti` claimed once), `RegulatedKeyRing` for rotation with overlap, and `ReplayStore` with `MemoryReplayStore`.
