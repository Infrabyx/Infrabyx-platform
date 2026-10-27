---
"@infrabyx/crypto": minor
---

`verifyWebhookSecret(expected, presented)`: a presented C-19 inbound-webhook secret is compared in constant time (both SHA-256 hashed first), for vendors that cannot sign their webhooks (PL2-D-64).
