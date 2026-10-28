# @infrabyx/testing

## 1.0.0

### Major Changes

- 9ec9a2c: 1.0.0, the platform baseline release (IPB-14 §14.5 item 1; owner answer #67(4), PL6-D-16). Every `@infrabyx/*` package moves to 1.0.0 together; the public API is unchanged from the 0.x set of the PL6 gate (`docs/phases/PL6-gate.md` §6), so a product upgrades by moving every dependency to 1.0.0 at once. From 1.0.0 on, semantic versioning holds: a breaking change to an export, a migration or a setting is a major release with an ADR (IPB-09-34/35).

### Patch Changes

- Updated dependencies [9ec9a2c]
  - @infrabyx/audit@1.0.0
  - @infrabyx/config@1.0.0
  - @infrabyx/contracts@1.0.0
  - @infrabyx/crypto@1.0.0
  - @infrabyx/seed@1.0.0
  - @infrabyx/tenancy@1.0.0

## 0.5.1

### Patch Changes

- Updated dependencies [9d8cd8c]
- Updated dependencies [b3934f9]
  - @infrabyx/tenancy@0.6.0
  - @infrabyx/config@0.5.1
  - @infrabyx/audit@0.1.5
  - @infrabyx/seed@0.3.1

## 0.5.0

### Minor Changes

- 1fecf45: Owner answer #53 (PL5-D-11): `mediaContractCases()` for the MEDIA port, the `testPng` and `oversizedPngHeader` fixtures, and the `FakeMedia` fixture. The `vendor-import` lint treats `sharp` as a vendor SDK (connectors only).
- 934355c: Fakes and fixtures for the PL5 website ports (PL5-D-02): `FakeConsentLedger`, `FakeCrm`, `FakeHr`, `FakeOhDesk` (SUPPORT and BACKLOG with a status loop), `FakeTrustFeed` with `fixtureTrustDocuments` (no certification claimed), `FakeCatalogue` with `fixtureCatalogue` (placeholder amounts, no real prices), `NoneTagManager`, `NoneAnalytics`, `FakeEgress`, `FakeClaimsGate` and `FakeLawRegister`.

### Patch Changes

- 1e2fe19: PL5 gate: `infrabyx-at-report` reads `.tsx` and `.e2e.test.*` files, three-digit AT ids (`@IPB-04-AT-101`) and skips `.next` build output; the repository's `at:report` now scans the whole repository, apps included.
- Updated dependencies [de53086]
- Updated dependencies [de53086]
- Updated dependencies [f1a36a1]
- Updated dependencies [1fecf45]
- Updated dependencies [1fecf45]
- Updated dependencies [b0dc390]
- Updated dependencies [b0dc390]
- Updated dependencies [b0dc390]
- Updated dependencies [275d4ba]
- Updated dependencies [934355c]
- Updated dependencies [686d24b]
- Updated dependencies [686d24b]
- Updated dependencies [e8e83cb]
- Updated dependencies [275d4ba]
- Updated dependencies [36338c3]
- Updated dependencies [934355c]
- Updated dependencies [b7de3c6]
- Updated dependencies [b7de3c6]
- Updated dependencies [e8e83cb]
- Updated dependencies [275d4ba]
  - @infrabyx/config@0.5.0
  - @infrabyx/contracts@0.5.0
  - @infrabyx/tenancy@0.5.0
  - @infrabyx/seed@0.3.0
  - @infrabyx/audit@0.1.4
  - @infrabyx/crypto@0.4.1

## 0.4.0

### Minor Changes

- c0b6d38: Synthetic AI guardrail corpora (PL4 session 4): `piiGoldenCorpus()` (PAN, Aadhaar including the masked form, mobile, e-mail, UPI, bank account with IFSC, card, voter ID, passport, driving licence, GSTIN, date of birth, JWT, PEM and API keys; check digits computed at run time, nothing real committed), `PII_NEGATIVE_CORPUS`, `INJECTION_CORPUS` (English, Hindi and Hinglish) and `BENIGN_INPUT_CORPUS`, with `syntheticAadhaar`, `syntheticCard` and `syntheticGstin`.
- 200b25a: `FakeLlm` (scripted, records every request), `FakeEmbedding` (deterministic vectors) and `providerError` for AI tests. No test calls a paid provider (PL4-D-03).

  `startPostgres().end()` tolerates the server's expected "terminating connection due to administrator command" (57P01) from `drop database … with (force)` on a client that is still closing. This removes an intermittent unhandled error after the tests have passed. Any other error still surfaces.

  Bedrock Runtime, Vertex AI and vLLM stubs (`startBedrockStub`, `startVertexStub`, `startVllmStub`) and the LLM and EMBEDDING contract cases (`llmContractCases`, `embeddingContractCases`).

- bfa324d: Imagen (`:predict` on `imagen*` models of the Vertex stub) and FLUX (`startFluxStub`) stubs, `stubPng`, `imageGenContractCases`, and the fakes `FakeImageGen`, `FakeSpeech` and `FakeRerank` (PL4 session 5).
- c0b6d38: `startPostgres` falls back to `pgvector/pgvector:0.8.1-pg18` (pinned by digest, `TEST_IMAGES.pgvector`, `PG_TEST_IMAGE`) so AI retrieval migrations run; CI's integration job uses the same image. Point `IPB_TEST_PG_URL` at a PostgreSQL 18 server with the `vector` extension available.

### Patch Changes

- 200b25a: `ipb/port-data-class` knows the IMAGE_GEN default class (INTERNAL), mirroring `PORT_DEFAULT_DATA_CLASS` (PL4-D-02).
- Updated dependencies [2b07109]
- Updated dependencies [200b25a]
- Updated dependencies [f6e9a88]
- Updated dependencies [f6e9a88]
- Updated dependencies [200b25a]
- Updated dependencies [9af583a]
- Updated dependencies [288ae44]
- Updated dependencies [b205b1d]
- Updated dependencies [183c532]
- Updated dependencies [f6e9a88]
- Updated dependencies [183c532]
- Updated dependencies [200b25a]
- Updated dependencies [b205b1d]
  - @infrabyx/contracts@0.4.0
  - @infrabyx/config@0.4.0
  - @infrabyx/crypto@0.4.0
  - @infrabyx/tenancy@0.4.0
  - @infrabyx/audit@0.1.3
  - @infrabyx/seed@0.2.2

## 0.3.0

### Minor Changes

- 50093e9: Leegality and Digio stubs (`startLeegalityStub`, `startDigioStub`) and `MemoryEsignEnvelopeStore`
  for the ESIGN contract legs.
- 1ed0659: Expo push and FCM HTTP v1 stubs (the FCM stub checks the RS256 service-account assertion at its
  token endpoint with a throwaway key) and `MemoryPushTokenStore`.
- 53697f5: RULES engine contract cases (`RULE_ENGINE_CASES`, `RULES_FIXTURE`, `fixtureInput`) for
  `defineContractSuite("RULES", …)`.

### Patch Changes

- 2725b6c: `ipb/port-data-class`: PUSH payloads default to INTERNAL, mirroring `@infrabyx/contracts`.
- Updated dependencies [50093e9]
- Updated dependencies [2725b6c]
- Updated dependencies [dd7a98b]
- Updated dependencies [50093e9]
- Updated dependencies [e268b60]
- Updated dependencies [1ed0659]
- Updated dependencies [2725b6c]
- Updated dependencies [1ed0659]
- Updated dependencies [53697f5]
- Updated dependencies [dd7a98b]
- Updated dependencies [e268b60]
- Updated dependencies [1ed0659]
- Updated dependencies [50093e9]
- Updated dependencies [53697f5]
- Updated dependencies [3951517]
- Updated dependencies [3951517]
- Updated dependencies [dd7a98b]
- Updated dependencies [e268b60]
- Updated dependencies [1ed0659]
- Updated dependencies [53697f5]
- Updated dependencies [dd7a98b]
  - @infrabyx/config@0.3.0
  - @infrabyx/contracts@0.3.0
  - @infrabyx/crypto@0.3.0
  - @infrabyx/tenancy@0.3.0
  - @infrabyx/audit@0.1.2
  - @infrabyx/seed@0.2.1

## 0.2.0

### Minor Changes

- 13c7379: Vendor stubs for the messaging hermetic legs (PL2-D-64): a recording stub server with failure injection, stubs for SES v2, Brevo, MSG91, Gupshup Enterprise SMS, Gupshup WhatsApp and the Meta Graph API, and `createSnsSigner()` for SignatureVersion 2 test messages (throwaway certificate per run).
- 0c4535d: Razorpay and Cashfree PG stubs for the PAYMENTS hermetic legs (test mode only; random per-run credentials; Cashfree idempotency replay and conflicts).
- a4b9082: PL2 session 1: contract suites take a leg and honour adapter capabilities (unsupported methods
  must throw IPB-PORT-001); pinned test images with `startService`; the sandbox-leg gate
  (`IPB_TEST_SANDBOX_*`, required on nightly runs); a fault-injection proxy for failover tests; and
  the ESLint rule `ipb/port-data-class` (PL2-D-03).
- 2969424: Test images `keycloak` (26.8.1) and `zitadel` (v4.19.5, GHCR, CI only); `startNetwork()` for
  services that talk to each other; `startService({ readyHttp })` probes readiness over HTTP from the
  host for images without a shell.
- 2f29ec8: `existingServiceUrl(name)` for services that CI starts itself (the MinIO server, built from
  source in CI, PL2-D-61).
- 9ac878e: `TEST_IMAGES` adds OpenBao 2.7.1 (KV v2, Transit and database engines) for the SECRETS and KMS
  hermetic legs.
- 2969424: `TEST_IMAGES` adds OpenFGA v1.22.0 for the AUTHZ hermetic leg.
- 858a76a: `TEST_IMAGES` adds the OTel Collector (contrib 0.162.0) and Unleash 8.2.0; `startService` takes
  `files` (configuration copied in before start) and `configure` (bind mounts, networks).

### Patch Changes

- Updated dependencies [5482043]
- Updated dependencies [efd00ab]
- Updated dependencies [2969424]
- Updated dependencies [858a76a]
- Updated dependencies [9ac878e]
- Updated dependencies [ded1ae2]
- Updated dependencies [9c774b9]
- Updated dependencies [9ac878e]
- Updated dependencies [9ac878e]
- Updated dependencies [858a76a]
- Updated dependencies [7a36249]
- Updated dependencies [7a36249]
- Updated dependencies [7a36249]
- Updated dependencies [13c7379]
- Updated dependencies [13c7379]
- Updated dependencies [13c7379]
- Updated dependencies [0c4535d]
- Updated dependencies [0c4535d]
- Updated dependencies [858a76a]
- Updated dependencies [5482043]
  - @infrabyx/crypto@0.2.0
  - @infrabyx/config@0.2.0
  - @infrabyx/contracts@0.2.0
  - @infrabyx/tenancy@0.2.0
  - @infrabyx/seed@0.2.0
  - @infrabyx/audit@0.1.1

## 0.1.0

### Minor Changes

- 907cfae: PL1 test kit: `startPostgres` (IPB_TEST_PG_URL or Testcontainers postgres:18) with every platform migration, context builders, SECRETS/KMS/STORAGE/FEATURE_FLAG/IDENTITY fakes, the NN pattern suites (@NN-01, @NN-02/45, @NN-18, locked actions, seed refusal), the port contract harness, `infrabyx-migration-lint` over the real PostgreSQL parser with every IPB-09 §09.4.6 rule and checksum manifests, `infrabyx-at-report`, and the IPB ESLint plugin as `@infrabyx/testing/eslint`.

  Audience: developer · Reg: none · Notice class: standard

### Patch Changes

- c2cf60a: PL0 toolchain baseline: pnpm 9 lockfile, Turborepo pipeline, ESLint 10 flat config with the IPB
  rules `ipb/vendor-import`, `ipb/schema-boundary` and `ipb/no-process-env` (placeholders),
  Vitest, Prettier, Renovate per IPB-01 §01.4.1.2, SHA-pinned CI and release workflows, and the
  `ipb:check` structural checks. Released with the seven PL1 packages at 0.1.0 (PL1-D-02 / D-06); the fifteen later-phase packages stay unpublished scaffolds until their own phase.

  Audience: internal · Reg: none · Notice class: standard

- Updated dependencies [c2cf60a]
- Updated dependencies [7dc104c]
- Updated dependencies [542194d]
- Updated dependencies [a17086c]
- Updated dependencies [8f44a2c]
- Updated dependencies [c61454d]
- Updated dependencies [245318b]
  - @infrabyx/audit@0.1.0
  - @infrabyx/config@0.1.0
  - @infrabyx/contracts@0.1.0
  - @infrabyx/crypto@0.1.0
  - @infrabyx/seed@0.1.0
  - @infrabyx/tenancy@0.1.0
