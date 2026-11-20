# R1 plan: a customer step-up for sensitive borrower actions (PR-UDF-056, "E7")

Owner's order, 19 Nov 2026 night and 20 Nov 18:50 (item E7, built after PR-UDF-061 to 068; R1-D-233 (6)). Decision R1-D-244. Spec of record: IPB-02-01 (one-time codes as the fallback factor), IPB-02-02 (a customer factor never satisfies a staff check), IPB-02-03 (sessions bound by DPoP), IPB-02-23 (codes never stored in clear or logged), IPB-02 §02.4.2 (risk signals add step-up), §02.4.6.2 `auth.otp` (10 codes per 10 minutes per account, back-off after 5 failures, 15 minutes after 10); Ecosystem Spec v1.2 §4 ("OTP step-up to the registered mobile before any consent, statement, acceptance or signature"; "the target applies its own step-up (OTP or passkey) before any legal-effect action"). Existing decisions: R1-D-18 and R1-D-19 (customer sign-in, DPoP proofs, owner answer #84 (b)), PR-UDF-034 (platform-made codes kept as salted hashes), R1-D-224 (the verified-email code, the same pattern), R1-D-127 and R1-D-135 (the staff step-up answer: `IPB-SEC-001` with `meta.step_up` and `required_acr`, `stepUpChallenge`, RFC 9470). Nothing under `docs/ipb/` or `docs/ecosystem/` is edited.

## A. What Udofin asked for

"A customer step-up (re-authentication) for sensitive borrower actions (e.g. downloading an original document), with the assurance level and its age on the session."

## B. What exists, and the line this plan keeps

- A borrower signs in with a one-time code (`startChallenge`, `verifyChallenge`) and gets IdP tokens bound by DPoP to a per-device key; the platform keeps one `connectors.customer_device` row per signed-in device (its key thumbprint, IdP session and refresh hash). `verifyRequest` answers the token's claims with the device that proved the request.
- Nothing records **when** the borrower last proved the login on that session. A refresh is not an authentication. The IdP's `acr` for a customer realm says nothing the platform defines, and its `auth_time` would be the original sign-in.
- The staff side already answers a missing factor in the RFC 9470 step-up form (`assertMfaForRoles(…, { stepUp })`, `stepUpChallenge`). This plan reuses that vocabulary (`acr`, `auth_time`, `required_acr`, `max_age`, `insufficient_user_authentication`) for customers and adds no new error code (the IPB-02 §02.6.3 catalogue is the spec's).
- **No new cryptographic primitive, and no IdP change.** The step-up code is made and checked by the platform exactly as the login-change (PR-UDF-034) and verified-email (PR-UDF-055) codes are: six digits from the CSPRNG, only a salted SHA-256 kept on the challenge, delivered by NOTIFY, bound to the device key by the existing DPoP proof verification (C-11, R1-D-18). The Keycloak `ipb-customer-otp` extension, the realm template and every production setting are untouched. The IdP is asked only whether the login belongs to the account (`idpFindUser`, a read both adapters already have).

## C. Design

### C1. The policy a product declares per sensitive action (`contracts`)

- `CUSTOMER_ACR_VALUES = ["otp"]` (ordered, weakest first; a stronger level, e.g. a passkey, is a later minor) and `CustomerAcr`.
- `CustomerStepUpPolicy` (zod, strict): `{ acr: CustomerAcr (default "otp"), maxAgeSeconds: integer 60 to 3600 (default 300) }`; `CUSTOMER_STEP_UP_DEFAULT` is `{ acr: "otp", maxAgeSeconds: 300 }`.
- `customerStepUpPolicies({ "document.original.download": {}, … })` validates and freezes a product's table at boot (action names `^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$`, 1 to 100 characters; a bad entry throws), so a typo fails at start, not at the borrower's download.

### C2. The check (`connectors`, beside `assertMfaForRoles`)

- `assertCustomerStepUp(claims, policy, now = Date.now())`: passes when `claims.acr` ranks at or above `policy.acr` and `0 ≤ now − auth_time ≤ maxAgeSeconds` (an `auth_time` up to 30 s ahead is clock skew and counts as age 0; further ahead, or missing, fails closed). Otherwise it throws `IPB-SEC-001` with `detail` "a fresh sign-in code is needed for this action" and `meta { step_up: true, customer: true, required_acr, max_age }`, and nothing else: not the session's `acr`, its age, or which test failed.
- `customerStepUpChallenge(e)` maps that error to status 401 with `WWW-Authenticate: DPoP error="insufficient_user_authentication", error_description="A fresh sign-in code is required", acr_values="otp", max_age=300, algs="ES256"` (RFC 9470 §3 with the DPoP scheme of RFC 9449 §7.1); null for anything else. The staff `stepUpChallenge` returns null for a customer refusal, so a customer never gets a Bearer challenge.

### C3. The step-up itself (`CustomerIdentityPort`, optional methods; `CustomerIdentityBase`)

- `startStepUp({ tenantId, userId, deviceId, channel, login, dpopProof, locale? })`: the proof (to `signInProofTarget`, as every customer code flow) must be by the key of the **active** device `deviceId` of `userId` (read fresh, not from the device cache); `login` must be this account's (`idpFindUser`), so the code goes to the registered login only (Ecosystem §4). The account's `auth.otp` guard counts the send (`reserveSend`: send limit, window and resend interval, shared with sign-in codes). The platform makes the code, keeps `{ purpose: "step_up", salt, code: SHA-256(salt, code), device: deviceId }` on a challenge bound to the key, and sends the code through the `CustomerOtpSender` (NOTIFY; idempotency key `otp:<challenge>:step_up`). Returns a `CustomerChallenge`. Refusals before anything is sent: `IPB-IDN-001` `login`, `dpop_*`, `device`; `IPB-SEC-019`; `IPB-PORT-001` `unsupported` for a store without `recordStepUp`.
- `confirmStepUp({ tenantId, userId, deviceId, challengeId, code, dpopProof })` → `{ deviceId, acr: "otp", authTime }`: the challenge must be a step-up challenge of this account **and this device** (`challenge` otherwise), the proof by the same key, the device still active with that id (`device`); then one try is counted (`attempt`: tries per code, back-off, lockout) and settled; a wrong code is `IPB-IDN-001` `code`. On success the store records `step_up_at` and `step_up_acr` on the device row, ledgered. A step-up challenge is never a sign-in, login-change or email code, and those are never a step-up (each checks `purpose`).
- `verifyRequest(…)` now answers `acr` and `auth_time` (seconds) on `VerifiedCustomerClaims`: `auth_time` is the later of the device's sign-in (its `createdAt`, when its sign-in code was verified) and its last step-up; `acr` is the level of that event (`"otp"` for both today). The IdP's own `acr` for a customer token is replaced by the platform's, since a customer realm's value says nothing the platform defines. A new optional `fresh: true` reads the device past the 15 s cache, for the sensitive route, so a step-up confirmed on one replica counts on the next request to any other (and a revoked device is refused at once there).
- Sessions on other devices, and other sessions of the same key after a sign-out and a new sign-in (a new device id), are not stepped up: the step-up is per device row.

### C4. What the product does

1. Declare its table once: `const STEP_UP = customerStepUpPolicies({ "document.original.download": { maxAgeSeconds: 300 } })`.
2. On the sensitive route: `claims = await customer.verifyRequest({ …, fresh: true })`, then `assertCustomerStepUp(claims, STEP_UP["document.original.download"])`; on `IPB-SEC-001`, answer `customerStepUpChallenge(e)` (401).
3. The app calls the product's step-up routes, which call `startStepUp` (with the borrower's registered login and the device from `claims.deviceId`) and `confirmStepUp`, then retries the download. Those routes are not behind the step-up (`assertStepUpReachable` already flags `otp` paths).

## D. Data model and migrations (expand-only)

- `connectors/0017_customer_device_step_up.sql`: two nullable columns on `connectors.customer_device`: `step_up_at timestamptz` and `step_up_acr text check (step_up_acr in ('otp'))`, both `dataclass:INTERNAL`; no row is changed, no grant or policy changes. Retention is the device's (deleted with it: unbinding, closure, 12 months unused).
- `CustomerAuthStore`: optional `recordStepUp(tenantId, deviceId, acr, at)` → boolean (false when the device is revoked or gone); `activeDevice(…, { fresh })`; `DeviceRecord.stepUpAt`, `stepUpAcr`. `PgCustomerAuthStore.recordStepUp` updates only an unrevoked device (`step_up_at` never moves back) and ledgers `identity.customer.device.step_up` (`identity.customer_device`, the device id, `after { acr, step_up_at, found }`) in the same transaction, then drops its cache entry. `MemoryCustomerAuthStore` too. The challenge, the send guard and each try are ledgered as for every code (`identity.customer.otp.reserve`, `challenge.create`, `challenge.attempt`, `challenge.verified`/`failed`).

## E. Settings

None. The code's lifetime and every limit are the existing `int.identity.customer.otp.*` settings; the max age is the product's policy, bounded in code (60 to 3600 s).

## F. Tests (by IPB ID)

- Contract case (Keycloak with the extension, Zitadel; `customer.cases.ts`): `@IPB-02-01` the session's `acr` is `otp` and `auth_time` its sign-in; a policy finds it stale later and answers the RFC 9470 401; a step-up from another key or for another device is refused, a wrong code is refused, the right code records a step-up whose `auth_time` is the step-up's, not the sign-in's (the same `now` fails before and passes after); the code is used once and is never a sign-in.
- Fake IdP on a fake clock (`customer.test.ts`): stale and fresh by the clock, the policy table and its bounds, the challenge shape (no code, no login), the `auth.otp` guard (resend interval, five tries per code, lockout), across devices and across sessions of one key, a revoked device between start and confirm, a store without `recordStepUp`, the refusal's meta reveals nothing else, the staff challenge ignores it.
- PostgreSQL (`customer-store.int.test.ts`): `connectors/0017` columns and data classes; `recordStepUp` ledgered, refused for a revoked device, monotonic, under RLS; `fresh` bypasses the cache while the cache still serves other reads; a refresh keeps the step-up.

## G. Threat model, guide, owner

- Threat model §3.168 (S, T, R, I, D, E of the step-up); product guide §7dx; DECISIONS R1-D-244; changesets: `contracts` minor, `connectors` minor.
- **Owner decisions needed (#176, nothing blocks; each a conservative default):** (1) `otp` is the only customer level, and both sign-in and step-up give it; (2) the default max age is 300 s, and a product may set 60 to 3600 s; (3) the code goes only to the account's registered login, over the channel the product names for it (never the verified email unless it is the login); (4) the step-up holds per device session, not per action (one fresh code covers every sensitive action within the max age on that device); (5) no tenant setting turns it off or loosens it: a product opts in by declaring a policy.
