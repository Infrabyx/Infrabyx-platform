---
"@infrabyx/connectors": minor
---

DEV-LOCAL-01 (R1-D-290): `KeycloakIdentity.applyRealm` sets an existing realm's API client redirect URIs, web origins and (when given) post-logout redirect URIs to exactly the spec's on every run, and creates a client the spec names that is missing. `KeycloakRealmSpec.apiClient` gains `postLogoutRedirectUris` and `webOrigins` (default: the exact origins of the redirect and post-logout URIs, instead of `+`). `realmRedirectProblem` refuses wildcards, fragments, user info, plain HTTP off loopback and duplicates before any call (`IPB-PORT-001`, `meta.reason` `redirect_uri_invalid`, never the URI); the new `localOnly` option admits loopback hosts only, for `pnpm dev:up`.
