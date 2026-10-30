# Keycloak customer one-time-code extension (`ipb-customer-otp`)

The authenticator behind customer sign-in on Keycloak (OWNER-QUESTIONS #84 (b); R1-D-19, threat model §3.53). It runs in a customer realm's direct-grant flow, after `direct-grant-validate-username`, and only for confidential clients with the attribute `ipb.customer.otp=true`. `KeycloakCustomerIdentity.applyCustomerRealm` in `@infrabyx/connectors/identity` creates the flow, the client and the step's settings.

| Step                                                                | Answer                                                                                                                     |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `ipb_otp_step=send`                                                 | `202` with `ipb_otp_challenge`, `ipb_otp_code` and `expires_in`; Keycloak keeps only a SHA-256 of `<challenge>:<code>`     |
| `ipb_otp_step=verify`, `ipb_otp_challenge`, `ipb_otp_code`, `DPoP:` | tokens bound to the proof's key (`cnf.jkt`), or `401 invalid_grant`; `attempts` tries per code, then the challenge is dead |

The platform delivers the code through NOTIFY and enforces the per-account limits before it calls either step. Step settings: `ttl` (60 to 900 s) and `attempts` (1 to 10), from the `int.identity.customer.otp.*` settings.

Build: `docker build -t <you>/keycloak-customer:26.8.1-1 infra/keycloak/customer-otp`. The extension compiles against the jars of the pinned Keycloak image itself, so nothing is downloaded and the SPI cannot drift; rebuild whenever the pin moves. Keycloak warns at start that the authenticator SPI is internal; the IDENTITY contract leg proves the step on every pin.
