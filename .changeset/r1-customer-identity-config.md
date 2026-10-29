---
"@infrabyx/config": minor
---

Customer sign-in settings (R1-D-19): `int.identity.customer.otp.*` (code lifetime, tries per code, sends per window, resend interval, back-off and lockout, IPB-02 `auth.otp`), `int.identity.customer.session.*` (idle and absolute lifetime) and `int.identity.customer.dpop.*` (proof `iat` window), PLATFORM tier, tighten only.
