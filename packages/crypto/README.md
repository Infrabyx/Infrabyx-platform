# @infrabyx/crypto

The only cryptography call-site of the platform (IPB-12-05). Every hash, MAC, signature, key and random value is created here, using Node's built-in `node:crypto` only (PL1-C-09). A future PQC or FIPS change touches this one package. Other packages are blocked from `node:crypto` and Web Crypto by the `ipb/no-direct-crypto` lint rule.

**Specified by:** `docs/ipb/` — IPB-02 §02.4.3.2 and §02.4.7.1, IPB-11 §11.4.7, IPB-12 §12.6 item 1; decisions PL1-C-01 to PL1-C-10. Plan: `docs/phases/PL1-plan.md` §5.

| Area             | API                                                   | Choice                                                                                                      |
| ---------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Canonical JSON   | `canonicalize()`                                      | RFC 8785 JCS                                                                                                |
| Hash             | `sha256()`, `canonicalDigest()`                       | SHA-256                                                                                                     |
| MAC / pseudonyms | `hmacSha256()`, `pseudonymise()`, `hashedActorId()`   | HMAC-SHA-256 (C-02)                                                                                         |
| Field encryption | `FieldEnvelope`, `fieldAad()`                         | AES-256-GCM, 96-bit nonce, 128-bit tag; per-tenant data keys cached ≤ 5 min, rotated after 2^20 uses (C-04) |
| Blind index      | `blindIndex()`                                        | HMAC-SHA-256, separate tenant-scoped key, normalised input (C-05)                                           |
| Signatures       | `signRecord()`, `verifyRecord()`                      | ECDSA P-256 / SHA-256 via the KMS port; records `alg`, `key_id`, `created_at`, `cert_chain_ref` (C-03)      |
| IDs              | `newId()`, `deterministicId()`                        | ULID from `randomBytes`; seed IDs from SHA-256 of namespace and natural key (C-06, C-07)                    |
| Seed passwords   | `generateSeedPassword()`                              | IPB-11 §11.4.7 exactly (C-08)                                                                               |
| Registry         | `ALGORITHMS`, `assertApproved()`, `cbom()`            | CycloneDX 1.6 CBOM, published only when `fut.cbom-export` is ON                                             |
| Dev KMS          | `LocalKms`, `devKeyFingerprints()`, `matchesDevKey()` | HKDF-derived dev keys from a public seed; `dev-keys.json` holds fingerprints only (C-10)                    |

`LocalKms` is for `local`, `dev` and `test`. `@infrabyx/config` refuses the `local` KMS adapter, and any configured value matching a dev-key fingerprint, in staging, demo, pre-prod, prod and dr (IPB-11-17).

Scripts: `pnpm --filter @infrabyx/crypto cbom` prints the CBOM; `dev-keys [--check]` regenerates or checks `dev-keys.json`.
