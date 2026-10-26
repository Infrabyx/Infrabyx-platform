---
"@infrabyx/crypto": minor
---

PL1 crypto-provider module, the single cryptography call-site (IPB-12-05): RFC 8785 canonical JSON, SHA-256, HMAC-SHA-256 pseudonyms, AES-256-GCM field envelopes with per-tenant data keys from the KMS port (cached ≤ 5 min, rotated after 2^20 uses), HMAC blind indexes, KMS-backed ECDSA P-256 signature records, ULIDs and deterministic seed IDs, IPB-11 seed passwords, an algorithm registry with CycloneDX CBOM export, and LocalKms for local/dev/test with published dev-key fingerprints. node:crypto only (decisions PL1-C-01 to C-10).

Audience: developer · Reg: none · Notice class: standard
