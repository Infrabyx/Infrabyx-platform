---
"@infrabyx/contracts": minor
---

Identity-provider brokers on the IDENTITY port (optional, `IPB-PORT-001` `unsupported` where absent): `upsertIdentityProvider`, `removeIdentityProvider`, `listIdentityProviders` and `discoverIdentityProvider` (`IdentityBrokerAdmin`). `IdentityProviderSpec` is a strict OIDC or SAML broker for one tenant: `IdpAlias`, display name, discovery or metadata URL, client id and `clientSecretRef` (a `secret://` reference only; a literal secret is refused), scopes, `enabled` and `VerifiedDomain`s; `IdentityProviderInfo` never carries a secret. `emailDomainOf` and `idpUrlAllowed` helpers (PR-LDC-09; R1-D-78).
