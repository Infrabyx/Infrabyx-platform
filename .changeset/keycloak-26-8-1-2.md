---
"@infrabyx/testing": patch
---

The IDENTITY test image moves to Keycloak's 26.8.1-2 rebuild (`keycloak/keycloak@sha256:3f3c5f8e…`, pinned once 7 days old under PL2-D-32; R1-D-110). It clears CVE-2026-91415; products that run the IdP or the customer-otp image should rebuild on the same digest.
