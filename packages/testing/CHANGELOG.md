# @infrabyx/testing

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
