---
"@infrabyx/crypto": patch
---

`@infrabyx/crypto/app-attest-test` (tests only): the test root's `rootPem` no longer has a blank line before `-----END CERTIFICATE-----` when the certificate's base64 is a multiple of 64 characters, so strict PEM readers such as OpenSSL accept it (the same fix `mtls-test` had; R1-D-275).
