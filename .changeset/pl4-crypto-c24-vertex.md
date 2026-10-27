---
"@infrabyx/crypto": minor
---

C-24 widened to Vertex AI (owner approval OWNER-QUESTIONS #27, PL4-C-01): `VERTEX_SCOPE` and `GOOGLE_ASSERTION_SCOPES`. `signServiceAccountAssertion` now signs only for the approved Google scopes (FCM and cloud-platform) and only with Google's token endpoint as audience; any other scope or audience throws.
