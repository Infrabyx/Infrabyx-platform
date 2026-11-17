---
"@infrabyx/connectors": patch
---

Security (R1-D-166, R1-D-167): `ZitadelCustomerIdentity` no longer resolves a login to an account whose login was just retired or moved while Zitadel's user search still lists it. A search hit is used only after `GET /v2/users/{id}` shows that account active under the login's username, an account not yet in the search is found by its own id, and a lookup Zitadel cannot confirm fails instead of guessing. New optional `fetchImpl` option (tests only), as on `ZitadelIdentity`. No change for Keycloak or for callers.
