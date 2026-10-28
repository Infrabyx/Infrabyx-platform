---
"@infrabyx/connectors": patch
---

Keycloak `applyRealm` gives each `amr` reference the realm profile's session lifetime as its maximum age instead of 0, so `otp` stays in the token when the code is exchanged after the TOTP step's second and after a refresh; the API no longer refuses MFA roles at random with `IPB-SEC-001`. Re-applying a realm updates the platform's own references (R1-D-16).
