---
"@infrabyx/crypto": minor
---

C-27, Apple App Attest verification (owner answer #99; R1-D-59): `verifyAppAttestAttestation` and `verifyAppAttestAssertion`, `decodeCbor`, `appleNonceOf`, `AppAttestError`, and `APPLE_APP_ATTEST_ROOT_PEM` (pinned, fingerprint checked at load), all on `node:crypto` and verify only. C-24 is widened to the Play Integrity scope (`PLAY_INTEGRITY_SCOPE`). The algorithm registry adds `ecdsa-p384-sha384` for Apple's chain only. Tests only: `@infrabyx/crypto/app-attest-test` (`appAttestTestAuthority`, `encodeCbor`), a throwaway authority in Apple's format.
