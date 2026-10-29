# @infrabyx/export

## 1.0.10

### Patch Changes

- Updated dependencies [ceabe3b]
  - @infrabyx/contracts@1.6.0
  - @infrabyx/crypto@1.2.1
  - @infrabyx/tenancy@1.3.3

## 1.0.9

### Patch Changes

- Updated dependencies [849b8f9]
- Updated dependencies [849b8f9]
  - @infrabyx/contracts@1.5.0
  - @infrabyx/crypto@1.2.0
  - @infrabyx/tenancy@1.3.2

## 1.0.8

### Patch Changes

- Updated dependencies [7e38652]
- Updated dependencies [7e38652]
  - @infrabyx/contracts@1.4.0
  - @infrabyx/crypto@1.1.0
  - @infrabyx/tenancy@1.3.1

## 1.0.7

### Patch Changes

- Updated dependencies [b6058d3]
- Updated dependencies [b6058d3]
  - @infrabyx/contracts@1.3.0
  - @infrabyx/tenancy@1.3.0
  - @infrabyx/crypto@1.0.3

## 1.0.6

### Patch Changes

- @infrabyx/tenancy@1.2.1

## 1.0.5

### Patch Changes

- Updated dependencies [75e9ea4]
- Updated dependencies [75e9ea4]
  - @infrabyx/contracts@1.2.0
  - @infrabyx/tenancy@1.2.0
  - @infrabyx/crypto@1.0.2

## 1.0.4

### Patch Changes

- Updated dependencies [c0ce8ff]
- Updated dependencies [2724cd6]
  - @infrabyx/tenancy@1.1.3

## 1.0.3

### Patch Changes

- 8a2587e: The `infrabyx-*` CLI entry points run when started through a `node_modules` symlink (`pnpm exec`, npm `.bin`, `node node_modules/@infrabyx/export/…`); before, they exited 0 without running (PR-UDF-005).
- Updated dependencies [8a2587e]
  - @infrabyx/tenancy@1.1.2

## 1.0.2

### Patch Changes

- Updated dependencies [53a973c]
  - @infrabyx/tenancy@1.1.1

## 1.0.1

### Patch Changes

- Updated dependencies [588b509]
- Updated dependencies [588b509]
  - @infrabyx/contracts@1.1.0
  - @infrabyx/tenancy@1.1.0
  - @infrabyx/crypto@1.0.1

## 1.0.0

### Major Changes

- 9ec9a2c: 1.0.0, the platform baseline release (IPB-14 §14.5 item 1; owner answer #67(4), PL6-D-16). Every `@infrabyx/*` package moves to 1.0.0 together; the public API is unchanged from the 0.x set of the PL6 gate (`docs/phases/PL6-gate.md` §6), so a product upgrades by moving every dependency to 1.0.0 at once. From 1.0.0 on, semantic versioning holds: a breaking change to an export, a migration or a setting is a major release with an ADR (IPB-09-34/35).

### Patch Changes

- Updated dependencies [9ec9a2c]
  - @infrabyx/contracts@1.0.0
  - @infrabyx/crypto@1.0.0
  - @infrabyx/tenancy@1.0.0

## 0.2.2

### Patch Changes

- Updated dependencies [9d8cd8c]
  - @infrabyx/tenancy@0.6.0

## 0.2.1

### Patch Changes

- Updated dependencies [de53086]
- Updated dependencies [f1a36a1]
- Updated dependencies [1fecf45]
- Updated dependencies [b0dc390]
- Updated dependencies [b0dc390]
- Updated dependencies [686d24b]
- Updated dependencies [686d24b]
- Updated dependencies [e8e83cb]
- Updated dependencies [275d4ba]
- Updated dependencies [36338c3]
- Updated dependencies [934355c]
- Updated dependencies [e8e83cb]
- Updated dependencies [275d4ba]
  - @infrabyx/contracts@0.5.0
  - @infrabyx/tenancy@0.5.0
  - @infrabyx/crypto@0.4.1

## 0.2.0

### Minor Changes

- 2b07109: Owner answers to OWNER-QUESTIONS #24 (PL3-D-25).

  **Breaking change, accepted by the owner (27 Oct 2026, PL4-D-05):** the `roles` option of 0.1.0 is
  removed, because only `ORG_OWNER` exports directly. No product consumes `@infrabyx/export` yet;
  any caller that passed `roles` must drop it and route `ORG_ADMIN` exports through `submit`.

  - `ORG_ADMIN` calls `submit`, an R2 approval (`export.job.request`) that only an `ORG_OWNER` may
    check; pass the workflow `approvals` engine. The requester downloads their approved archive.
  - Archives are downloadable for 30 days; run `sweep()` from one worker every few minutes. It
    enqueues approved jobs and deletes expired archives, with each deletion ledgered. After that a
    download is refused with `IPB-EXP-006`.
  - Migration `export/0002_owner_answers.sql` (run `infrabyx-migrate`; it creates the
    `svc_export_sweep` reader role).
  - The archive README shows the export time in IST; data stays in UTC.

  export_map: REF-EXPORT-1.1

- 272160f: Reference export map `REF-EXPORT-1.2` (PL4-D-12): adds the AI run log `ai_runs` (from `ai.run`: model, route, class, usage, cost, guard flags and duration; no content) and the Vidhi action log `vidhi_actions` (from `vidhi.task_step`: task, tool, outcome, approval and actor), as `01 Data/ai_runs.{csv,jsonl}` and `01 Data/vidhi_actions.{csv,jsonl}` (IPB-03-55, 03-83). A minor bump: entities are only added. `REF-EXPORT-1.1` stays registered as `REF_EXPORT_MAP_1_1` for the dual run. The golden archive is regenerated as `golden/REF-EXPORT-1.2`.

  export_map: REF-EXPORT-1.2

### Patch Changes

- Updated dependencies [2b07109]
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
  - @infrabyx/crypto@0.4.0
  - @infrabyx/tenancy@0.4.0

## 0.1.0

### Minor Changes

- e268b60: First release (publishable, PL1-D-20): export maps and `REF-EXPORT-1.0`, the deterministic archive
  writer to the Ecosystem §12.1 standard with the C-22 signed manifest and an offline verifier,
  `ExportService` (jobs, reconciled snapshot, STORAGE, ledgered downloads), `goldenArchive`, and the
  `infrabyx-export` CLI (`map-gate`, `diff`, `verify`). Migration `export/0001_init.sql`.

  export_map: REF-EXPORT-1.0
  Customer note: the first export map; downloads hold tenants, legal entities, memberships, settings,
  approvals, notifications, inbox items and the audit trail.

### Patch Changes

- 70d52b2: `export-map-gate` triggers only on the export package's source, maps, verifier and migrations, not
  on tests, the golden fixture, the README, the changelog or `package.json`, so the version PR no
  longer needs a map bump (found at the PL3 gate).
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
- Updated dependencies [3951517]
- Updated dependencies [3951517]
- Updated dependencies [dd7a98b]
- Updated dependencies [e268b60]
- Updated dependencies [1ed0659]
- Updated dependencies [53697f5]
- Updated dependencies [dd7a98b]
  - @infrabyx/contracts@0.3.0
  - @infrabyx/crypto@0.3.0
  - @infrabyx/tenancy@0.3.0
