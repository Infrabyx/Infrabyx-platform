---
"@infrabyx/connectors": minor
---

IDENTITY adapters `keycloak` (Keycloak 26.x, realm as code, Admin API SCIM) and `zitadel`
(Zitadel v4, settings and ES256 web key as code), with a shared ES256 token verifier, claim mapping,
the `assertMfaForRoles` API guard (IPB-SEC-001) and a revocation store: `PgRevocationStore` on the
new migration `0002_session_revocation` refuses revoked sessions and users on every replica within
60 s. Impersonation (`issueToken` with an actor) is unsupported on both adapters.
