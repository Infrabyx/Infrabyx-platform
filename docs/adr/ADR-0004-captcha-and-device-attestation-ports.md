# ADR-0004 — Register the CAPTCHA and DEVICE_ATTESTATION ports

- **Status:** Accepted — owner's order of 3 Nov 2026 (Udofin PR-UDF-028 and PR-UDF-029; Cloudflare Turnstile is the owner's CAPTCHA choice, Udofin #58); the device-attestation adapters wait for OWNER-QUESTIONS #99
- **Date:** 2026-11-03
- **Deciders:** owner (`@infrabyx/platform-owners`)
- **IPB sections:** IPB-01 §01.4.4.0 (port registration), IPB-01-14, IPB-01-15, IPB-01-16, IPB-01-19; IPB-06-40 (no puzzle CAPTCHA as the only way in); R1-D-50

## Context

Udofin's borrower website needs a CAPTCHA validated on the server, switched on when the site is under attack (REQ-DPS-67); LawDocs and Equator public forms will need the same. Its app needs Android Play Integrity and iOS App Attest checked on the server at device registration (master prompt U3, REQ-DPS-68). IPB-01 names neither port, so Udofin keeps product-local ports that fail closed outside fixtures (UDF-D-111, UDF-D-124). Products may not import vendor SDKs (IPB-01-14).

## Decision

Register both ports in the platform.

| §01.4.4.0 item         | CAPTCHA                                                                                                                                | DEVICE_ATTESTATION                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Interface              | `CaptchaPort` in `packages/contracts/src/ports/captcha.ts`                                                                             | `DeviceAttestationPort` in `packages/contracts/src/ports/device-attestation.ts`        |
| Contract suite         | `captchaContractCases` in `packages/testing/src/ports/captcha.ts`                                                                      | `deviceAttestationContractCases` in `packages/testing/src/ports/device-attestation.ts` |
| Catalogue row          | `CAPTCHA`, tier 3, `int.captcha.` (in `@infrabyx/contracts`; IPB-01's catalogue row requested as PR-039)                               | `DEVICE_ATTESTATION`, tier 2, `int.device_attestation.` (same request)                 |
| Reference adapter      | `turnstile` (Cloudflare Turnstile `siteverify`), off behind `int.captcha.turnstile.enabled`                                            | Google Play Integrity and Apple App Attest: not built (OWNER-QUESTIONS #99)            |
| Alternatives           | `hcaptcha` (off behind `int.captcha.hcaptcha.enabled`); `FakeCaptcha`                                                                  | `FakeDeviceAttestation` only                                                           |
| Config keys            | `int.captcha.under_attack` (PLT_SECURITY_OFFICER, no maker-checker so it can be flipped at once), `int.captcha.<adapter>.enabled` (R4) | none until an adapter exists                                                           |
| Residency / data class | `GLOBAL`, INTERNAL: only the token and the site's secret leave, never `remoteip` or a customer identifier                              | `IN` for the fake, CONFIDENTIAL; the vendor adapters will declare their own            |

`CaptchaGate` asks for a token only while `int.captcha.under_attack` is on, and then fails closed (429 IPB-SEC-019 with `meta.rule: "captcha"`) on a missing, refused or reused token or an unreachable vendor. The widget must offer the vendor's accessible, non-puzzle mode (Turnstile's managed or invisible widget) so IPB-06-40 holds.

## Verification

`contracts` catalogue test; the CAPTCHA contract cases on Turnstile and hCaptcha against `startCaptchaStub` and on the fake (`port-contract` leg `CAPTCHA`), including that only `secret` and `response` are sent; the gate's cases; the DEVICE_ATTESTATION cases on the fake; `ipb-check`.

## Consequences

- Udofin replaces its product-local CAPTCHA port with `@infrabyx/connectors/captcha` and turns `int.captcha.turnstile.enabled` on once the owner's site key and secret are in SECRETS.
- Udofin keeps its fail-closed device-attestation port until #99 is answered, building against `DeviceAttestationPort` and the fake meanwhile.
- Play Integrity needs a Google service-account assertion (RS256, the C-24 pattern, today limited to FCM and Vertex AI) or workload identity federation; App Attest needs CBOR decoding, an X.509 chain check to Apple's App Attestation root, and ES256 assertion checks. Both are cryptography beyond the approved items, so they wait for the owner (CLAUDE.md stop list).
- IPB-01-15 (two alternatives, one green in CI) holds for CAPTCHA with hCaptcha and the fake; DEVICE_ATTESTATION has only the fake until #99.

## Update (2026-11-03, owner answer #99; R1-D-59)

The DEVICE_ATTESTATION reference adapter is built: `native` (Google Play Integrity through C-24, widened to the Play Integrity scope; Apple App Attest verified locally under C-27). Both halves are off behind `int.device_attestation.play_integrity.enabled` and `int.device_attestation.app_attest.enabled` until the owner's accounts exist. The fake stays the in-memory alternative, and the port's contract cases run on both (`port-contract` leg `DEVICE_ATTESTATION`). The exit map names the fake as the exit target.
