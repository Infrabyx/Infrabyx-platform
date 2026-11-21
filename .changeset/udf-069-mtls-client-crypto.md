---
"@infrabyx/crypto": minor
---

`checkClientCredential(certificatePem, keyPem, { now? })` (Udofin PR-UDF-069; R1-D-250): checks the platform's own mTLS client certificate and key before an outbound partner call uses them. Both must parse (an encrypted key is refused), the key must be ECDSA P-256 (the approved `ecdsa-p256-sha256` entry; any other key type is `key_type` until the owner widens it, owner question #180) and must be the certificate's, the certificate must be a leaf whose extended key usage, if present, allows TLS client authentication, and it must be valid at `now`. Answers `{ ok: true, credential: { notBefore, notAfter, x5tS256, fingerprintSha256 } }` or one of the fixed labels in `CLIENT_CREDENTIAL_REFUSALS`; never the key. The registry's `ecdsa-p256-sha256` entry gains the outbound partner mTLS use line. No new primitive, dependency, setting or migration; nothing existing changes.
