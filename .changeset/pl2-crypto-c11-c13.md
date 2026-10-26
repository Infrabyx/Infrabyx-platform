---
"@infrabyx/crypto": minor
---

C-11 JWT/JWS verification on node:crypto (`verifyJwt`, `verifyJws`, `JwksCache`): per-issuer
ES256/PS256 allow-list, refused headers, strict base64url, ±60 s claim checks, 24 h JWKS cache
with rate-limited refetch. C-13 vendor signatures (Razorpay, Cashfree, Meta) and Amazon SNS
SignatureVersion 2 verification with pinned certificate hosts. C-19 `generateWebhookSecret`.
