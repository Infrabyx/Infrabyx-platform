# @infrabyx/crypto

## 1.12.0

### Minor Changes

- 461fe2c: A verify-only PAdES/CMS signature verifier (Udofin PR-UDF-059; owner answer #162, C-28; R1-D-246). `verifyPadesSignatures(pdf, { trust?, revocation?, now?, maxBytes? })` checks every CAdES-detached or PKCS#7-detached signature embedded in a PDF: the ByteRange covers the file except `/Contents` (an incremental update after the signature is its own outcome), the CMS SignedData parses, `messageDigest` equals the ByteRange digest, the signature over the signed attributes verifies with the signer certificate, the chain reaches a pinned CCA India root through pinned intermediates, every certificate is valid at the signing time (a verified B-T timestamp, the signed `signingTime`, `/M`, or the verification time), key usage allows signing, and revocation is `good` or `revoked` only from CRLs or OCSP responses the caller passes (`not_checked` otherwise; nothing is fetched). RSA PKCS#1 v1.5 and PSS with SHA-256/384/512, ECDSA P-256/SHA-256 and P-384/SHA-384; SHA-1 and MD5 are `weak_algorithm`. Results are fixed labels (`PADES_OUTCOMES`, `PADES_DOCUMENT_OUTCOMES`) and never document text. The package's own strict DER reader is used; no new dependency. The crypto registry gains `sha-384`, `sha-512`, `rsassa-pkcs1-v1_5-sha384`/`-sha512` and `rsassa-pss-sha384`/`-sha512`, each for this verification only, and existing entries a C-28 use line. **`CCA_INDIA_TRUST` has no pinned certificate yet** (owner question #178), so every chain is `chain_untrusted` until a PR adds CCA's published root and intermediates. Tests only: `@infrabyx/crypto/pades-test`, a throwaway CA that signs PDFs and makes timestamps, CRLs and OCSP responses, and `customTrustStore` (results then say `trustStore: "custom"`). No signing, setting, migration or existing behaviour changes.

### Patch Changes

- Updated dependencies [d4636a3]
- Updated dependencies [ae319d5]
- Updated dependencies [98a1d62]
  - @infrabyx/contracts@1.44.0

## 1.11.0

### Minor Changes

- 648c511: Partner mTLS client certificates and a generic Standard Webhooks receiver (Udofin PR-UDF-064; R1-D-238). Verification only, no new primitive. `readClientCertificate({ socket } | { header, format })` reads exactly one leaf from the platform's TLS socket (`tlsAuthorized` reported; a peer the TLS layer did not authorise is refused unless `tlsAuthorization: "reported"`) or from the edge header of `docs/platform/mtls-edge-header.md` (`pem-url`, the percent-encoded PEM; or Envoy `xfcc`), and returns `x5tS256` (RFC 8705 §3.1), `fingerprintSha256`, `notBefore`, `notAfter`, `subject`, `issuer` and `serialNumber`, or a fixed `CLIENT_CERT_REFUSALS` label (answer `IPB-API-009`, 401): a forwarded chain is refused `multiple_certificates`, and a CA or server-only certificate `not_client_certificate`. `PinnedCaSet.fromPem(cas, { intermediates })` adds an optional pinned-CA check through at most two configured intermediates, ECDSA P-256 / SHA-256 issuer signatures only (others `issuer_algorithm`, owner question #170); no CRL or OCSP. `StandardWebhookReceiver` wraps `verifyStandardWebhook` with a body limit, one or two secrets, a window of at most 300 s and a replay claim made after verification (`replayKey` `delivery`, the default, or `event`), with fixed `STANDARD_WEBHOOK_REFUSALS` labels. `@infrabyx/crypto/mtls-test` makes throwaway test CAs and client certificates. No setting, no migration; nothing existing changes.

### Patch Changes

- Updated dependencies [9be2fc7]
- Updated dependencies [f0edee3]
- Updated dependencies [2d2729b]
  - @infrabyx/contracts@1.43.0

## 1.10.0

### Minor Changes

- f62dcaa: Document JWS descriptor v2 (PR-UDF-061 item 13; R1-D-236): `signDocumentJwsV2` signs the JCS descriptor `{ application_id?, document_id, media_type, sha256, size_bytes, type, version }` on the same C-22 detached-JWS profile (ES256, `kid`), under `typ: ipb-document-v2+jws` (`DOCUMENT_JWS_V2_TYP`, type `DocumentDescriptorV2`). `verifyDocumentJws` now takes both v1 and v2 JWSs, chosen by the signed `typ`, and an optional fifth argument `{ requireV2: true }` that refuses a v1 JWS with `wrong_typ`. A v1 JWS verifies exactly as before; no new primitive, key type or algorithm.

### Patch Changes

- Updated dependencies [2cb5b3f]
- Updated dependencies [a38f921]
- Updated dependencies [dbb08e6]
  - @infrabyx/contracts@1.42.0

## 1.9.2

### Patch Changes

- Updated dependencies [98c9416]
  - @infrabyx/contracts@1.41.0

## 1.9.1

### Patch Changes

- Updated dependencies [053e16a]
- Updated dependencies [ce8ca22]
- Updated dependencies [b135555]
- Updated dependencies [48810fd]
- Updated dependencies [1ffb012]
  - @infrabyx/contracts@1.40.0

## 1.9.0

### Minor Changes

- 5fd012a: Documents by reference, the eSign and eStamp evidence and the lender execution-pack manifest (Udofin PR-UDF-053; R1-D-219). `contracts/events`: `DocumentSharedData` and `DOCUMENT_EVENTS` (Ecosystem Specification §6.13), `DocumentRetrieval` for `GET /v1/documents/{id}` (an India-hosted `https` URL valid at most 15 minutes, `DOCUMENT_URL_MAX_TTL_SECONDS`), `ESignCompletedData` and `EStampCompletedData` (§6.2, signed; added to `ORIGINATION_EVENTS`, so `ORIGINATION_REGULATED` now lists six), and `ExecutionPackManifest` (documents and kinds, execution mode, stamp details, summary-box page, covenant declaration, countersignature rule), shared as a document of type `EXECUTION_PACK_MANIFEST` until the Specification names a carrier (platform request PR-047). `crypto`: `signDocumentJws` and `verifyDocumentJws`, the C-22 detached JWS (`typ: ipb-document+jws`) over `{ document_id, version, sha256 }`. `fakes`: `FakeLender` shares the KFS, sanction letter, loan agreement and manifest after a sanction (`sharedDocuments()`, `getDocument`, `fetchDocument`, `executionPack`) and takes the LSP's signed `ESignCompleted` and `EStampCompleted` (`eSignCompleted`, `eStampCompleted`), verified against the new `lspKeys` option; `outbox()` is unchanged. `testing`: `lspSigner()` and four more `lenderContractCases({ lsp })`. Nothing existing changes meaning.

### Patch Changes

- Updated dependencies [5fd012a]
- Updated dependencies [3b57c29]
- Updated dependencies [4d509e6]
  - @infrabyx/contracts@1.39.0

## 1.8.0

### Minor Changes

- 3c4b588: The origination contract of Ecosystem Specification §6.2 and §6.3 and a mock lender (Udofin PR-UDF-051; R1-D-217). `contracts/events`: `EligibilityCheckRequest` and `EligibilityCheckAnswer` for the synchronous `POST /v1/eligibility-checks` (3 s budget, `lender_unavailable` past it), the v1 data schemas of `ApplicationSubmitted`, `ApplicationStatusChanged`, `AdditionalInfoRequested`, `DecisionMade`, `KFSIssued`, `SanctionLetterIssued`, `BorrowerAccepted`, `CoolingOffExitRequested` and `LoanDisbursed`, `ORIGINATION_EVENTS` (type, schema, idempotency fields, direction, regulated), `ORIGINATION_REGULATED` and `originationIdempotencyKey`. `crypto`: `localRegulatedSigner(kid)`, an ES256 signer on an in-memory key for tests and fakes only. `fakes`: `FakeLender`, which answers the calls, emits the journey's envelopes and signs the regulated ones (`keys` to verify), with `script` and `outbox` hooks. `testing`: `lenderContractCases()` and `lspEvent()`. Nothing existing changes.

### Patch Changes

- Updated dependencies [3c4b588]
  - @infrabyx/contracts@1.38.0

## 1.7.0

### Minor Changes

- dbaecff: V-CIP webhooks verified without a vendor call (Udofin PR-UDF-046; R1-D-199). `KycPort.verifyWebhook(rawBody, headers, meta?) → { eventId, vcipId, receivedAt }` (`KycWebhookReceipt`), optional on the interface, checks a webhook's size, signature, window and replay only, with no vendor call and no read-back, so a product answers 401 to an unverified event, records `eventId` in its module inbox, acknowledges within 2 s and reads the session back with `vcipStatus` from its queue (IPB-10-27). `handleWebhook` keeps its signature and, where `verifyWebhook` exists, is `verifyWebhook` and then `vcipStatus`. `contracts` adds `verifyKycWebhookWith` (the order: the body's size, at most `KYC_WEBHOOK_MAX_BODY_BYTES` (64 KiB) before anything is read; the Standard Webhooks headers; the signature and `KYC_WEBHOOK_TOLERANCE_SECONDS` (300) window; the replay claim on the delivery's id and timestamp; then the session id), `KYC_WEBHOOK_REFUSALS` (`body_too_large`, `signature_invalid`, `timestamp_stale`, `event_replayed`; `IPB-API-018`, definite), `kycWebhookRefused`, `KYC_WEBHOOK_MALFORMED` (`IPB-PORT-001` for a verified event naming no session) and `KycWebhookReplayStore`. `crypto` adds `verifyStandardWebhook` (C-13: HMAC-SHA-256 over `<id>.<timestamp>.<body>` as IPB-10-21 defines it, constant time, ±5 minutes, `whsec_` secrets, rotation, `v1` only) and `signStandardWebhookForTest`; no new algorithm. `FakeKyc` verifies Standard Webhooks (`FAKE_KYC_WEBHOOK`, `signFakeKycWebhook`, option `webhook: { secrets, replay }`, `vcipStatusVendorCalls`), and its `handleWebhook` now refuses an unsigned event. `KycFixtures.webhook` (optional) drives two new contract cases. `connectors` adds `standardWebhookKycVerifier` for an adapter whose provider signs with Standard Webhooks; `DigioKyc` and `IdfyKyc` refuse `verifyWebhook` `unsupported`; `kycMethodRouter` routes it under `vcip`. **Products: `FakeKyc.handleWebhook` and `verifyWebhook` now refuse an unsigned delivery, so a test that posts an event to the fake must sign it with `signFakeKycWebhook(body)` (from `@infrabyx/fakes` or `@infrabyx/testing`) and pass the headers it returns.** C-13 covers Standard Webhooks v1 by the owner's approval (R1-D-210); RFC 9421 is not approved.

### Patch Changes

- Updated dependencies [82dc7ef]
- Updated dependencies [1cdbf0f]
- Updated dependencies [2f9d3f8]
- Updated dependencies [b0e0b72]
- Updated dependencies [9e626ef]
- Updated dependencies [aac1c2c]
- Updated dependencies [d58d5f0]
- Updated dependencies [dbaecff]
- Updated dependencies [80a843a]
- Updated dependencies [1cdbf0f]
- Updated dependencies [ff2a74b]
- Updated dependencies [d35f7e9]
  - @infrabyx/contracts@1.37.0

## 1.6.2

### Patch Changes

- Updated dependencies [4af2688]
- Updated dependencies [955cc67]
  - @infrabyx/contracts@1.36.0

## 1.6.1

### Patch Changes

- Updated dependencies [a6929eb]
  - @infrabyx/contracts@1.35.0

## 1.6.0

### Minor Changes

- 3e69471: Agent request proofs (PR-FBX-46, R1-D-178): `signAgentRequest`, `verifyAgentRequest`, `generateAgentKeyPair` and `agentPublicJwk`, the C-22 profile with its own `typ` (`ipb-agent-request+jws`), bound to tenant, agent, `seq`, method, path and body digest. No new primitive.

### Patch Changes

- Updated dependencies [3e69471]
  - @infrabyx/contracts@1.34.0

## 1.5.18

### Patch Changes

- Updated dependencies [34f5e49]
  - @infrabyx/contracts@1.33.0

## 1.5.17

### Patch Changes

- Updated dependencies [6bb68c1]
  - @infrabyx/contracts@1.32.0

## 1.5.16

### Patch Changes

- Updated dependencies [32097cb]
  - @infrabyx/contracts@1.31.0

## 1.5.15

### Patch Changes

- Updated dependencies [c79fef5]
  - @infrabyx/contracts@1.30.0

## 1.5.14

### Patch Changes

- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
  - @infrabyx/contracts@1.29.0

## 1.5.13

### Patch Changes

- Updated dependencies [15be78b]
- Updated dependencies [15be78b]
- Updated dependencies [15be78b]
  - @infrabyx/contracts@1.28.0

## 1.5.12

### Patch Changes

- Updated dependencies [043a348]
- Updated dependencies [043a348]
- Updated dependencies [043a348]
  - @infrabyx/contracts@1.27.0

## 1.5.11

### Patch Changes

- Updated dependencies [0aa0f1d]
  - @infrabyx/contracts@1.26.0

## 1.5.10

### Patch Changes

- Updated dependencies [496180e]
  - @infrabyx/contracts@1.25.0

## 1.5.9

### Patch Changes

- Updated dependencies [e86dedf]
  - @infrabyx/contracts@1.24.0

## 1.5.8

### Patch Changes

- Updated dependencies [67be297]
- Updated dependencies [67be297]
- Updated dependencies [67be297]
  - @infrabyx/contracts@1.23.0

## 1.5.7

### Patch Changes

- Updated dependencies [3c9bb25]
  - @infrabyx/contracts@1.22.0

## 1.5.6

### Patch Changes

- Updated dependencies [1dda4b2]
- Updated dependencies [1dda4b2]
  - @infrabyx/contracts@1.21.0

## 1.5.5

### Patch Changes

- Updated dependencies [b8c1f2c]
  - @infrabyx/contracts@1.20.0

## 1.5.4

### Patch Changes

- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
  - @infrabyx/contracts@1.19.0

## 1.5.3

### Patch Changes

- Updated dependencies [9c368c7]
- Updated dependencies [9c368c7]
  - @infrabyx/contracts@1.18.0

## 1.5.2

### Patch Changes

- Updated dependencies [714ad01]
  - @infrabyx/contracts@1.17.0

## 1.5.1

### Patch Changes

- Updated dependencies [b3edda2]
- Updated dependencies [b3edda2]
  - @infrabyx/contracts@1.16.0

## 1.5.0

### Minor Changes

- 2a95100: C-27, Apple App Attest verification (owner answer #99; R1-D-59): `verifyAppAttestAttestation` and `verifyAppAttestAssertion`, `decodeCbor`, `appleNonceOf`, `AppAttestError`, and `APPLE_APP_ATTEST_ROOT_PEM` (pinned, fingerprint checked at load), all on `node:crypto` and verify only. C-24 is widened to the Play Integrity scope (`PLAY_INTEGRITY_SCOPE`). The algorithm registry adds `ecdsa-p384-sha384` for Apple's chain only. Tests only: `@infrabyx/crypto/app-attest-test` (`appAttestTestAuthority`, `encodeCbor`), a throwaway authority in Apple's format.

## 1.4.0

### Minor Changes

- 854e309: C-26, HS256 for LiveKit only (owner answer #89, R1-D-33, R1-D-53): `LiveKitCredentials` (API key and a secret encoding at least 32 random bytes; dev keys refused; never printed), `signLiveKitJoinToken` (one room, one identity, publish, subscribe and data grants only, at most 300 s), `signLiveKitServerToken` (exactly one server grant, room-scoped where it must be, at most 60 s) and `verifyLiveKitWebhook` (HS256 only, issuer, expiry with 60 s skew, the body's SHA-256, constant-time). A test fails if HS256 is named anywhere else in the platform's runtime sources. In the algorithm registry and CBOM as C-26.

### Patch Changes

- Updated dependencies [1b99d7a]
- Updated dependencies [c83e9e0]
- Updated dependencies [af2ae98]
- Updated dependencies [c4117e4]
  - @infrabyx/contracts@1.15.0

## 1.3.1

### Patch Changes

- Updated dependencies [97e8524]
- Updated dependencies [92706c4]
- Updated dependencies [4a87754]
- Updated dependencies [d66ffad]
  - @infrabyx/contracts@1.14.0

## 1.3.0

### Minor Changes

- 32b53ee: Blind-index keys outside test environments (Finbyx PR-FBX-25; PL1-C-05; R1-D-37). `loadBlindIndexRoot(secrets, { appEnv, product })` reads the product's root HMAC-SHA-256 key from the SECRETS port at `secrets/<env>/kms/blind-index/<product>` (at least 32 bytes, hex or base64url; the public local key is refused) with its version. `tenantBlindIndexKey` derives the tenant- and scope-specific key by HKDF-SHA-256 with the label `<product>/<scope>/v<n>/<tenant>`, which equals the `deriveSubKey(localDevKey(LOCAL_KMS_KEYS.blindIndex), "<product>/<scope>/v1/<tenant>")` a product uses locally today, so local indexes do not change. `BlindIndexer` writes under the current version, looks up under the current and previous versions during a rotation and tells a re-index job which rows to rewrite. `localBlindIndexRoot()` is the local, dev and test root.

### Patch Changes

- Updated dependencies [cff2a02]
  - @infrabyx/contracts@1.13.0

## 1.2.7

### Patch Changes

- Updated dependencies [63c5ad2]
  - @infrabyx/contracts@1.12.0

## 1.2.6

### Patch Changes

- Updated dependencies [2e3a2d3]
- Updated dependencies [3f20011]
  - @infrabyx/contracts@1.11.0

## 1.2.5

### Patch Changes

- Updated dependencies [138ae44]
  - @infrabyx/contracts@1.10.0

## 1.2.4

### Patch Changes

- Updated dependencies [2b307e0]
  - @infrabyx/contracts@1.9.0

## 1.2.3

### Patch Changes

- Updated dependencies [cd25633]
  - @infrabyx/contracts@1.8.0

## 1.2.2

### Patch Changes

- Updated dependencies [f5622c9]
  - @infrabyx/contracts@1.7.0

## 1.2.1

### Patch Changes

- Updated dependencies [ceabe3b]
  - @infrabyx/contracts@1.6.0

## 1.2.0

### Minor Changes

- 849b8f9: DPoP proof verification for customer sessions (RFC 9449; owner answer #84, R1-D-18): `verifyDpopProof` (ES256 only, strict header, key and claim shapes, `htm`/`htu`/`ath` binding, a short `iat` window, the expected `jkt`, `jti` claimed once per key after the proof verifies), `jwkThumbprint` (RFC 7638), `accessTokenHash` and `normaliseHtu`.

### Patch Changes

- Updated dependencies [849b8f9]
  - @infrabyx/contracts@1.5.0

## 1.1.0

### Minor Changes

- 7e38652: JWS for regulated Ecosystem messages (Spec §3.6; G5, R1-D-08): `signRegulatedMessage` (detached ES256 over the JCS form of the CloudEvent, through KMS `sign`, with `kid`, `iat` and `jti` in the protected header), `verifyRegulatedMessage` (ES256 only, strict header allow-list, short `iat` window, `jti` claimed once), `RegulatedKeyRing` for rotation with overlap, and `ReplayStore` with `MemoryReplayStore`.

### Patch Changes

- Updated dependencies [7e38652]
  - @infrabyx/contracts@1.4.0

## 1.0.3

### Patch Changes

- Updated dependencies [b6058d3]
  - @infrabyx/contracts@1.3.0

## 1.0.2

### Patch Changes

- Updated dependencies [75e9ea4]
  - @infrabyx/contracts@1.2.0

## 1.0.1

### Patch Changes

- Updated dependencies [588b509]
  - @infrabyx/contracts@1.1.0

## 1.0.0

### Major Changes

- 9ec9a2c: 1.0.0, the platform baseline release (IPB-14 §14.5 item 1; owner answer #67(4), PL6-D-16). Every `@infrabyx/*` package moves to 1.0.0 together; the public API is unchanged from the 0.x set of the PL6 gate (`docs/phases/PL6-gate.md` §6), so a product upgrades by moving every dependency to 1.0.0 at once. From 1.0.0 on, semantic versioning holds: a breaking change to an export, a migration or a setting is a major release with an ADR (IPB-09-34/35).

### Patch Changes

- Updated dependencies [9ec9a2c]
  - @infrabyx/contracts@1.0.0

## 0.4.1

### Patch Changes

- Updated dependencies [de53086]
- Updated dependencies [f1a36a1]
- Updated dependencies [1fecf45]
- Updated dependencies [b0dc390]
- Updated dependencies [686d24b]
- Updated dependencies [e8e83cb]
- Updated dependencies [275d4ba]
- Updated dependencies [36338c3]
- Updated dependencies [934355c]
  - @infrabyx/contracts@0.5.0

## 0.4.0

### Minor Changes

- f6e9a88: C-24 widened to Vertex AI (owner approval OWNER-QUESTIONS #27, PL4-C-01): `VERTEX_SCOPE` and `GOOGLE_ASSERTION_SCOPES`. `signServiceAccountAssertion` now signs only for the approved Google scopes (FCM and cloud-platform) and only with Google's token endpoint as audience; any other scope or audience throws.

### Patch Changes

- Updated dependencies [2b07109]
- Updated dependencies [f6e9a88]
- Updated dependencies [200b25a]
- Updated dependencies [9af583a]
- Updated dependencies [288ae44]
- Updated dependencies [b205b1d]
- Updated dependencies [183c532]
  - @infrabyx/contracts@0.4.0

## 0.3.0

### Minor Changes

- e268b60: C-22 (PL3-D-06): `signDetachedJws` (RFC 7515 Appendix F, ES256 through a KMS DER signer),
  `verifyDetachedJws`, `derToJose`, `spkiToEs256Jwk` and `cloudEventSigningPayload` (JCS of a
  CloudEvent without its signature attribute).
- 1ed0659: C-23 `addressHash` (HMAC-SHA-256 of the normalised e-mail or E.164 phone with the group consent
  key, PL3-D-05) and C-24 `signServiceAccountAssertion` (RS256 only for the Google service-account
  assertion that FCM's OAuth requires, PL3-C-01); both added to the algorithm registry.
- 50093e9: C-25 (PL3-C-02): `verifyLeegalityMac`, HMAC-SHA1 verification only, for Leegality webhooks:
  constant-time comparison and a replay window when a timestamp is sent. `hmac-sha1` is in the
  algorithm registry for that use only.

### Patch Changes

- Updated dependencies [50093e9]
- Updated dependencies [e268b60]
- Updated dependencies [1ed0659]
- Updated dependencies [2725b6c]
- Updated dependencies [1ed0659]
- Updated dependencies [53697f5]
- Updated dependencies [dd7a98b]
- Updated dependencies [3951517]
  - @infrabyx/contracts@0.3.0

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
