# @infrabyx/crypto

## 0.2.0

### Minor Changes

- 9ac878e: C-11 JWT/JWS verification on node:crypto (`verifyJwt`, `verifyJws`, `JwksCache`): per-issuer
  ES256/PS256 allow-list, refused headers, strict base64url, ±60 s claim checks, 24 h JWKS cache
  with rate-limited refetch. C-13 vendor signatures (Razorpay, Cashfree, Meta) and Amazon SNS
  SignatureVersion 2 verification with pinned certificate hosts. C-19 `generateWebhookSecret`.
- 858a76a: `telemetryIdHasher` and `deriveSubKey`: HKDF-SHA-256 sub-key under `ipb/telemetry-id/v1` and
  HMAC-SHA-256 truncated to 128 bits for tenant, user and flag-context IDs in telemetry (C-21,
  PL2-C-04).
- 7a36249: Field-encryption format v2 (PL2-D-50): `FieldEnvelope.seal/open` take the C-14 context `{ tenant_id, purpose }`, wrap every data key under it and cache keys per tenant and purpose; v1 stays readable and `rewrapToV2` re-wraps a v1 data key without changing the field ciphertext. `encodeKmsContext`, `decodeKmsContext`, `assertKmsContext`; `LocalKms.generateDataKey` requires a valid context. Also fixes a flaky tamper step in the C-11 differential test.
- 13c7379: `verifyWebhookSecret(expected, presented)`: a presented C-19 inbound-webhook secret is compared in constant time (both SHA-256 hashed first), for vendors that cannot sign their webhooks (PL2-D-64).

### Patch Changes

- 5482043: Test the seed-password character draw directly: the rejection-sampled draw takes an injectable byte source, and the χ² uniformity test (bound unchanged) runs on seeded draws instead of finished passwords, whose rule-based regeneration skews digits slightly (PL1-C-08).
- 9ac878e: `LocalKms.generateDataKey` honours the optional AAD, like the KMS adapters.
- Updated dependencies [2969424]
- Updated dependencies [858a76a]
- Updated dependencies [9ac878e]
- Updated dependencies [ded1ae2]
- Updated dependencies [9c774b9]
- Updated dependencies [7a36249]
- Updated dependencies [13c7379]
- Updated dependencies [0c4535d]
  - @infrabyx/contracts@0.2.0

## 0.1.0

### Minor Changes

- 8f44a2c: PL1 crypto-provider module, the single cryptography call-site (IPB-12-05): RFC 8785 canonical JSON, SHA-256, HMAC-SHA-256 pseudonyms, AES-256-GCM field envelopes with per-tenant data keys from the KMS port (cached ≤ 5 min, rotated after 2^20 uses), HMAC blind indexes, KMS-backed ECDSA P-256 signature records, ULIDs and deterministic seed IDs, IPB-11 seed passwords, an algorithm registry with CycloneDX CBOM export, and LocalKms for local/dev/test with published dev-key fingerprints. node:crypto only (decisions PL1-C-01 to C-10).

  Audience: developer · Reg: none · Notice class: standard

### Patch Changes

- c2cf60a: PL0 toolchain baseline: pnpm 9 lockfile, Turborepo pipeline, ESLint 10 flat config with the IPB
  rules `ipb/vendor-import`, `ipb/schema-boundary` and `ipb/no-process-env` (placeholders),
  Vitest, Prettier, Renovate per IPB-01 §01.4.1.2, SHA-pinned CI and release workflows, and the
  `ipb:check` structural checks. Released with the seven PL1 packages at 0.1.0 (PL1-D-02 / D-06); the fifteen later-phase packages stay unpublished scaffolds until their own phase.

  Audience: internal · Reg: none · Notice class: standard

- Updated dependencies [c2cf60a]
- Updated dependencies [a17086c]
  - @infrabyx/contracts@0.1.0
