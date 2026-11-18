---
"@infrabyx/connectors": minor
---

PR-FBX-49 (R1-D-182): the realm half of the product MFA floor. `KeycloakRealmSpec.mfaFloor` marks every floor role (product roles included) for MFA, and `applyRealm` now adds missing roles and markers to a realm that already exists (never removes one); a floor role the realm lacks fails `ipbRealm`. `KeycloakIdentityOptions.mfaFloor` gives the enrolment action to users who get a floor role on creation or through a sync, never an SMS action for an SMS-excluded role (`KEYCLOAK_NON_SMS_ENROLMENT_ACTIONS`), and `requireMfaEnrolment()` flags existing holders without a factor. Zitadel: the login policy's second factors (TOTP and U2F) are part of `ZITADEL_IPB_SETTINGS` and read back by `readSettings`, and `zitadelClaims` keeps Zitadel's RFC 8176 `amr` values (adding `webauthn` for `user`) instead of collapsing them to `mfa`, so an SMS-excluded role is no longer refused on Zitadel after TOTP or a security key.
