---
"@infrabyx/contracts": minor
"@infrabyx/connectors": minor
---

The detached JWS in `X-Infrabyx-JWS` (Ecosystem Spec v1.4 §3.6, PR-043, OWNER-QUESTIONS #116; R1-plan M61). `@infrabyx/contracts/events`: `REGULATED_JWS_HEADER` and `regulatedJwsFromHeaders(headers)` (a Fetch `Headers` or a Node header record): exactly one header, any case, one compact detached JWS of at most 1,024 octets; a missing, repeated, comma-joined, over-long or malformed value is refused with its reason. The Operations Hub provisioning adapter adds `deliveryHeaders(event)` (a fresh JWS per delivery, so a retry has a new `jti`) and `receiveHttp(body, headers)`, which refuses a bad header as `signature-invalid` (`IPB-API-018`) before verifying or storing anything and keeps the header value byte for byte as the proof. `receive(event, jws)` and `signForDelivery` are unchanged. A product that already sends and reads `X-Infrabyx-JWS` removes nothing (minor rather than patch, because two methods are added).
