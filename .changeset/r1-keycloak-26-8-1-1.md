---
"@infrabyx/testing": patch
---

The IDENTITY test image moves to Keycloak's 26.8.1-1 rebuild (`keycloak/keycloak@sha256:a78d6b79…`, pinned once 7 days old under PL2-D-32; R1-D-35), the same digest as the customer one-time-code image and the Compose IdP. It clears one base-image finding (CVE-2026-114406), whose waiver is removed; three stay waived until a Keycloak or UBI release carries their fixes.
