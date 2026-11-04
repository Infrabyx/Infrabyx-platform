---
"@infrabyx/connectors": minor
---

`refreshSession` on `KeycloakIdentity` and `ZitadelIdentity` (PR-LDC-03; R1-D-77). Keycloak refreshes under the realm's rotation (`revokeRefreshToken`, `refreshTokenMaxReuse` 0): a token Keycloak reports as reused (`Stale token`, `Maximum allowed refresh token reuse exceeded`) has its session revoked in the revocation store, then ended at Keycloak. Zitadel rotates every token but reports a spent one only as invalid, so the adapter detects reuse from a `RefreshTokenLedger` of SHA-256 hashes (`MemoryRefreshTokenLedger` by default; option `refreshLedger`; capability `refreshSession.reuseDetection: emulated`), then revokes the session (or the user, when the tokens carry no `sid`) and refuses the family's later tokens. Refresh tokens are never logged or put in an error. `oauthError`, `unverifiedJwtPayload` and `refreshRefused` helpers; a `fetchImpl` test option on both adapters.
