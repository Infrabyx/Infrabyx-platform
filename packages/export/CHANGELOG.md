# @infrabyx/export

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
