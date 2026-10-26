---
"@infrabyx/connectors": minor
---

KMS adapters `aws-kms` (encryption context per C-14, DIGEST signing, tenant CMKs with rotation,
30-day deletion only) and `vault-transit` (associated data, version-aware verification). Both fail
decryption closed with IPB-KMS-001.
