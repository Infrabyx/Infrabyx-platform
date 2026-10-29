---
"@infrabyx/connectors": minor
---

Customer sign-in on the IDENTITY port (owner answer #84 (b), R1-D-19): `KeycloakCustomerIdentity` with `applyCustomerRealm` (needs the `ipb-customer-otp` extension image, `infra/keycloak/customer-otp`; DPoP-bound tokens) and `ZitadelCustomerIdentity` with `applyCustomerOrg` (session API with `returnCode`; platform binding); the `auth.otp` guard, challenges and devices in `PgCustomerAuthStore` (migration `connectors/0004`, forced RLS, ledgered); `RedisReplayStore` for DPoP `jti`s. The egress client can now read a redirect without following it (`redirect: "manual"`).
