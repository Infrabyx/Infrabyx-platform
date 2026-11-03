---
"@infrabyx/crypto": minor
---

C-26, HS256 for LiveKit only (owner answer #89, R1-D-33, R1-D-44): `LiveKitCredentials` (API key and a secret encoding at least 32 random bytes; dev keys refused; never printed), `signLiveKitJoinToken` (one room, one identity, publish, subscribe and data grants only, at most 300 s), `signLiveKitServerToken` (exactly one server grant, room-scoped where it must be, at most 60 s) and `verifyLiveKitWebhook` (HS256 only, issuer, expiry with 60 s skew, the body's SHA-256, constant-time). A test fails if HS256 is named anywhere else in the platform's runtime sources. In the algorithm registry and CBOM as C-26.
