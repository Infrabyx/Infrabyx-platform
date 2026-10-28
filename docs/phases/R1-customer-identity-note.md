# Customer identity through the IDENTITY port (design note, no code)

Date: 2026-10-28 · Status: for the owner's decision (OWNER-QUESTIONS #84) · Raised by: Udofin (PR-UDF-010); LawDocs and Equator need the same

## The gap

Products need **end users who are not staff** to sign in: Udofin's borrowers, LawDocs' clients, Equator's parties. They sign in with a **one-time code** sent to a mobile number or email, and get a **short-lived session token** that the product's API verifies through the IDENTITY port (`verifyToken`). Udofin also wants **device-bound refresh**: a P-256 key registered per device, a signed nonce on each refresh, and per-device revocation.

The port cannot do this today:

- `authenticate` exchanges an OIDC code or a SAML response, so it covers staff sign-in through a browser.
- `issueToken` issues client-credential or token-exchange tokens for the API client only.
- Neither adapter (Keycloak, Zitadel) is configured for an OTP first factor, and the platform has no customer realm or device registry.

Products are building shims meanwhile (Udofin `u03_identity`).

## What any answer must keep

- **IPB-02-01:** passkeys are the default where the device supports them. OTP is the fallback, with the IPB-02 rate limits (`auth.otp` 10 per 10 min per account, back-off after 5 failures, 15 minutes after 10).
- **IPB-02-02:** SMS OTP is never an MFA factor for staff roles. Customer realms stay separate from staff realms, so a customer factor can never satisfy a staff check.
- **Ecosystem Spec §4.3:** each product keeps its own customer accounts, linked across products only by pairwise `party_ref`s.
- **Delivery and residency:**
  - OTP codes go out through NOTIFY (SMS, WhatsApp, EMAIL ports), never through an IdP's own vendor credentials;
  - codes are stored hashed and never logged (IPB-02-23);
  - identity data stays `IN`.
- **Verification:** tokens verify under the C-11 allow-list (ES256 or PS256), with `kid`, a short TTL and revocation within 60 s (IPB-02-05).

## Options

|                                                             | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | For                                                                                                                                                                                                                                    | Against                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **(a)** Platform customer-auth service                      | A new capability beside IDENTITY (an OTP challenge store, our own KMS-signed ES256 session tokens, rotating refresh, a device registry), with `verifyToken` taught to accept them                                                                                                                                                                                                                                                                                                        | One TypeScript implementation; full control of OTP rules and device binding; no IdP extension                                                                                                                                          | The platform becomes a token issuer. That is cryptography and key custody beyond the approved C-items (signing user tokens, device-key verification), and a security-critical service to keep. Breaks the IPB-01 pattern of identity sitting in the IdP |
| **(b)** In the IdP, as authentication flows _(recommended)_ | Per product, a **customer realm** in Keycloak (the IPB-01 reference) with a phone/email OTP authenticator. Keycloak calls a platform webhook, and the platform sends the code through NOTIFY. Short-lived access tokens are **DPoP-bound** (RFC 9449, ES256 proofs from a per-device key) with refresh rotation. The port gains `startChallenge`, `verifyChallenge`, `registerDevice` and `revokeDevice`. Zitadel stays the alternative: it has OTP SMS/email and a session API natively | Tokens stay the IdP's, under the existing C-11/C-12 allow-list. DPoP gives device binding by a standard instead of a scheme of our own. Matches Udofin's master prompt ("Keycloak authentication flows plus a device-binding service") | Keycloak's OTP-first-factor authenticator is a Java extension built into the image we ship. Verifying DPoP proofs at the API is a new use of ES256 verification and needs a C-item confirmation. Each product runs one more realm                       |
| **(c)** Zitadel as the reference for customers              | Customers in Zitadel (native OTP and session API), staff stay in Keycloak                                                                                                                                                                                                                                                                                                                                                                                                                | No Java extension                                                                                                                                                                                                                      | Changes IPB-01's named reference adapter for a population; two IdPs to run in production; edits the spec's choice (an owner and IPB matter)                                                                                                             |

## Recommendation

**(b).** It keeps token issuance where IPB-01 puts it, uses standards (OIDC, DPoP) rather than a token format of our own, and needs only one cryptography confirmation: DPoP proof verification with ES256 under C-11.

If approved, the work is one `contracts`/`connectors` minor:

1. The port methods, with a contract suite proven on Keycloak (with the extension) and on Zitadel in CI. Both run from images, with no account and no cost.
2. The NOTIFY delivery webhook.
3. The device registry, as a port method backed by the IdP's own DPoP key binding.
4. A customer-realm template in `infra/`.

## Decision needed

OWNER-QUESTIONS #84: choose (a), (b) or (c). For (b), also approve DPoP proof verification (ES256, `jkt` binding, `iat` window, `jti` replay check) as a C-item.
