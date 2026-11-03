# @infrabyx/audit

## 1.6.1

### Patch Changes

- Updated dependencies [2a95100]
- Updated dependencies [2a95100]
  - @infrabyx/config@1.7.0
  - @infrabyx/crypto@1.5.0

## 1.6.0

### Minor Changes

- bdcdbe4: Chain lanes for the audit ledger and the statutory capture (Finbyx PR-FBX-32; IPB-02-51; ADR-0005; R1-D-58). Each tenant's two chains become 32 lanes (`audit.lane_setting`, raised only with `audit.set_chain_lanes`), so up to 32 of a tenant's transactions append at once instead of queuing on one head row. Each lane is the same SHA-256 chain (PL1-C-01) with the lane and the position (`lane`, `lane_seq`) hashed. A transaction takes a free lane (`FOR UPDATE SKIP LOCKED`) and keeps it until it ends. `seq` becomes a global sequence: unique and increasing in each lane, but no longer a count. Existing chains continue as lane 0 and nothing written is changed. Migrations `audit/0006` (lane heads, sequences, triggers; briefly locks the ledger and the capture) and `audit/0007` (two unique indexes, built concurrently). `verifyChain` and `verifyCaptureChain` verify lane by lane and return `lanes` (`head.hash` is now `lanesRoot`). `AuditService.verify` and `StatutoryCapture.verify` also compare each lane's end with its stored head, so a deleted tail is reported. Anchors are format 3 (`ANCHOR_FORMAT_LANES`: every lane head of both chains), and verification accepts formats 1 to 3. New exports: `lanePosition`, `lanesRoot`, `laneHeadMismatch`, `captureLanes`, the `LaneHead` type. Run `infrabyx-migrate`.

## 1.5.1

### Patch Changes

- Updated dependencies [1b99d7a]
- Updated dependencies [c83e9e0]
- Updated dependencies [af2ae98]
- Updated dependencies [c4117e4]
- Updated dependencies [1e721cd]
- Updated dependencies [854e309]
- Updated dependencies [854e309]
  - @infrabyx/contracts@1.15.0
  - @infrabyx/config@1.6.0
  - @infrabyx/crypto@1.4.0

## 1.5.0

### Minor Changes

- 92706c4: One ledger entry for a job step over many resources (Finbyx PR-FBX-30; IPB-02-51; R1-D-41). Migration `audit/0005` adds `audit.batch_member`, append-only for every role. `PgAuditSink.recordBatch(tx, { action, run, step, resourceType, resourceIds })` writes one `job_step` entry (`<run>/<step>/<type>`) whose digest covers the full id list (1 to 100,000), and lists the ids in order; `verifyBatch(tx, ledgerId)` recomputes it. Run `infrabyx-migrate`.

### Patch Changes

- Updated dependencies [97e8524]
- Updated dependencies [92706c4]
- Updated dependencies [4a87754]
- Updated dependencies [d66ffad]
  - @infrabyx/contracts@1.14.0
  - @infrabyx/config@1.5.2
  - @infrabyx/crypto@1.3.1

## 1.4.4

### Patch Changes

- Updated dependencies [32b53ee]
- Updated dependencies [cff2a02]
  - @infrabyx/crypto@1.3.0
  - @infrabyx/contracts@1.13.0
  - @infrabyx/config@1.5.1

## 1.4.3

### Patch Changes

- Updated dependencies [63c5ad2]
- Updated dependencies [63c5ad2]
  - @infrabyx/config@1.5.0
  - @infrabyx/contracts@1.12.0
  - @infrabyx/crypto@1.2.7

## 1.4.2

### Patch Changes

- 3f20011: An `external` principal is recorded as a `user` actor in the ledger (R1-D-29); its entries name the grant it reads under.
- Updated dependencies [2e3a2d3]
- Updated dependencies [3f20011]
  - @infrabyx/contracts@1.11.0
  - @infrabyx/config@1.4.1
  - @infrabyx/crypto@1.2.6

## 1.4.1

### Patch Changes

- Updated dependencies [138ae44]
- Updated dependencies [138ae44]
  - @infrabyx/config@1.4.0
  - @infrabyx/contracts@1.10.0
  - @infrabyx/crypto@1.2.5

## 1.4.0

### Minor Changes

- 2b307e0: The ledger records the context's branch (`audit/0004`, `branch_id`, R1-D-26). The chain covers it only when it is set, so existing entries verify unchanged.

### Patch Changes

- Updated dependencies [2b307e0]
  - @infrabyx/contracts@1.9.0
  - @infrabyx/config@1.3.2
  - @infrabyx/crypto@1.2.4

## 1.3.0

### Minor Changes

- cd25633: Database-level statutory audit capture (Finbyx PR-FBX-10 item 2; R1-D-25). Migration `audit/0003` adds `audit.register_capture('<schema>.<table>')`: every insert, update and delete on a registered table is captured with before and after values, actor, entity, branch, break-glass grant, trace, action, reason, database login and role, and transaction id. Rows go into a per-tenant hash chain that only `audit.capture_row()` writes and nobody changes. Event triggers refuse disabling it. `StatutoryCapture`, `AuditService.verifyCapture` and `AuditSweep.verifyCaptureAll` are the gap detector. The daily anchor's format 2 signs the capture head, and `verifyCaptureAgainstAnchor` checks an export against it.

### Patch Changes

- Updated dependencies [cd25633]
  - @infrabyx/contracts@1.8.0
  - @infrabyx/config@1.3.1
  - @infrabyx/crypto@1.2.3

## 1.2.7

### Patch Changes

- Updated dependencies [94b706e]
  - @infrabyx/config@1.3.0

## 1.2.6

### Patch Changes

- Updated dependencies [f5622c9]
- Updated dependencies [f5622c9]
  - @infrabyx/config@1.2.0
  - @infrabyx/contracts@1.7.0
  - @infrabyx/crypto@1.2.2

## 1.2.5

### Patch Changes

- Updated dependencies [ceabe3b]
  - @infrabyx/contracts@1.6.0
  - @infrabyx/config@1.1.1
  - @infrabyx/crypto@1.2.1

## 1.2.4

### Patch Changes

- Updated dependencies [849b8f9]
- Updated dependencies [849b8f9]
- Updated dependencies [849b8f9]
  - @infrabyx/config@1.1.0
  - @infrabyx/contracts@1.5.0
  - @infrabyx/crypto@1.2.0

## 1.2.3

### Patch Changes

- Updated dependencies [7e38652]
- Updated dependencies [7e38652]
  - @infrabyx/contracts@1.4.0
  - @infrabyx/crypto@1.1.0
  - @infrabyx/config@1.0.6

## 1.2.2

### Patch Changes

- Updated dependencies [b6058d3]
  - @infrabyx/contracts@1.3.0
  - @infrabyx/config@1.0.5
  - @infrabyx/crypto@1.0.3

## 1.2.1

### Patch Changes

- Updated dependencies [1c869a8]
  - @infrabyx/config@1.0.4

## 1.2.0

### Minor Changes

- 75e9ea4: `AuditSweep` (PR-UDF-013): `verifyAll()` for the weekly chain verification and `anchorAll(date)` for the daily anchor of every tenant (IPB-02-51), over `TenantSweep`.

### Patch Changes

- Updated dependencies [75e9ea4]
  - @infrabyx/contracts@1.2.0
  - @infrabyx/config@1.0.3
  - @infrabyx/crypto@1.0.2

## 1.1.1

### Patch Changes

- Updated dependencies [8a2587e]
  - @infrabyx/config@1.0.2

## 1.1.0

### Minor Changes

- 588b509: Migration `audit/0002` lets the outbox relay (`svc_outbox_relay`, R1-D-01) append the ledger entry of each batch it dispatches, under the ledger's tenant and actor policy; no read and no other table.

### Patch Changes

- Updated dependencies [588b509]
  - @infrabyx/contracts@1.1.0
  - @infrabyx/config@1.0.1
  - @infrabyx/crypto@1.0.1

## 1.0.0

### Major Changes

- 9ec9a2c: 1.0.0, the platform baseline release (IPB-14 §14.5 item 1; owner answer #67(4), PL6-D-16). Every `@infrabyx/*` package moves to 1.0.0 together; the public API is unchanged from the 0.x set of the PL6 gate (`docs/phases/PL6-gate.md` §6), so a product upgrades by moving every dependency to 1.0.0 at once. From 1.0.0 on, semantic versioning holds: a breaking change to an export, a migration or a setting is a major release with an ADR (IPB-09-34/35).

### Patch Changes

- Updated dependencies [9ec9a2c]
  - @infrabyx/config@1.0.0
  - @infrabyx/contracts@1.0.0
  - @infrabyx/crypto@1.0.0

## 0.1.5

### Patch Changes

- Updated dependencies [b3934f9]
  - @infrabyx/config@0.5.1

## 0.1.4

### Patch Changes

- Updated dependencies [de53086]
- Updated dependencies [de53086]
- Updated dependencies [f1a36a1]
- Updated dependencies [1fecf45]
- Updated dependencies [1fecf45]
- Updated dependencies [b0dc390]
- Updated dependencies [b0dc390]
- Updated dependencies [275d4ba]
- Updated dependencies [934355c]
- Updated dependencies [686d24b]
- Updated dependencies [e8e83cb]
- Updated dependencies [275d4ba]
- Updated dependencies [36338c3]
- Updated dependencies [934355c]
- Updated dependencies [b7de3c6]
  - @infrabyx/config@0.5.0
  - @infrabyx/contracts@0.5.0
  - @infrabyx/crypto@0.4.1

## 0.1.3

### Patch Changes

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
  - @infrabyx/contracts@0.4.0
  - @infrabyx/config@0.4.0
  - @infrabyx/crypto@0.4.0

## 0.1.2

### Patch Changes

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
  - @infrabyx/config@0.3.0
  - @infrabyx/contracts@0.3.0
  - @infrabyx/crypto@0.3.0

## 0.1.1

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
- Updated dependencies [13c7379]
- Updated dependencies [13c7379]
- Updated dependencies [13c7379]
- Updated dependencies [0c4535d]
- Updated dependencies [0c4535d]
  - @infrabyx/crypto@0.2.0
  - @infrabyx/config@0.2.0
  - @infrabyx/contracts@0.2.0

## 0.1.0

### Minor Changes

- 7dc104c: PL1 audit ledger: database-computed SHA-256 hash chain over RFC 8785 canonical JSON with per-tenant heads, insert-only for every role, actor bound to the verified context, correction entries, a TypeScript verifier that reports the first break and emits LedgerChainBroken, and signed daily anchors written with retention through the STORAGE and KMS ports. Migration `audit/0001_init.sql`.

  Audience: developer · Reg: none · Notice class: standard

### Patch Changes

- c2cf60a: PL0 toolchain baseline: pnpm 9 lockfile, Turborepo pipeline, ESLint 10 flat config with the IPB
  rules `ipb/vendor-import`, `ipb/schema-boundary` and `ipb/no-process-env` (placeholders),
  Vitest, Prettier, Renovate per IPB-01 §01.4.1.2, SHA-pinned CI and release workflows, and the
  `ipb:check` structural checks. Released with the seven PL1 packages at 0.1.0 (PL1-D-02 / D-06); the fifteen later-phase packages stay unpublished scaffolds until their own phase.

  Audience: internal · Reg: none · Notice class: standard

- Updated dependencies [c2cf60a]
- Updated dependencies [542194d]
- Updated dependencies [a17086c]
- Updated dependencies [8f44a2c]
  - @infrabyx/config@0.1.0
  - @infrabyx/contracts@0.1.0
  - @infrabyx/crypto@0.1.0
