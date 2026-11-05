# @infrabyx/export

## 1.5.0

### Minor Changes

- 67be297: PDF: the rupee sign, and Indic text through DOCGEN (OWNER-QUESTIONS #117, R1-D-96). `toPdf` now embeds Noto Sans (Regular, Bold, Italic, Bold Italic; SIL OFL 1.1, subset once and shipped in `fonts/`, provenance in `fonts/FONTS.md`) as CIDFontType2 fonts with a ToUnicode map, in place of the standard Helvetica: Latin (Basic, Latin-1, Extended-A), the usual punctuation, the euro and the rupee sign (U+20B9). Text in an Indic script is refused with `shaping_required` (other characters the fonts lack: `char_unsupported`); never replaced. `renderPdf(doc, { docgen, lang, outputPrefix })` routes a document with Indic text to the DOCGEN port's `renderHtml` (Gotenberg's Chromium shapes it) and renders the rest in process; `blocksToHtml(doc, { lang })` writes the same blocks as a self-contained HTML page that fetches nothing; `pdfNeedsShaping(doc)` tells which path applies.

### Patch Changes

- Updated dependencies [67be297]
- Updated dependencies [67be297]
- Updated dependencies [67be297]
- Updated dependencies [67be297]
  - @infrabyx/contracts@1.23.0
  - @infrabyx/tenancy@1.16.0
  - @infrabyx/crypto@1.5.8

## 1.4.0

### Minor Changes

- 3c9bb25: PDF export (PR-LDC-28; dependency review `docs/phases/R1-pdf-dependency-review.md`, R1-D-95): `toPdf(doc, { creator, created, maxBytes })` renders the `toDocx` block model (headings, paragraphs with bold, italic, underline and https links, bullet and numbered lists with one nested level, tables with a header row repeated on each page, page breaks) as a PDF 1.7 file, A4, with no new dependency. Text is set in the standard Helvetica fonts with WinAnsiEncoding (no font embedded); a character outside WinAnsi, such as the rupee sign or Indic script, is refused with `char_unsupported`, never replaced. No JavaScript, forms, attachments or actions other than https link annotations; the same input and `created` time give the same bytes.
- 3c9bb25: `REF-EXPORT-1.5` (R1-D-95, OWNER-QUESTIONS #110): the tenant export carries the setting change history, `01 Data/setting_change.csv` and `.jsonl` (from `config.setting_change`: who changed which setting at which scope, when, from what to what, and the approval request). `REF-EXPORT-1.4` stays exported beside it for the 90-day dual run (`REF_EXPORT_MAP_1_4`); the golden archive is `golden/REF-EXPORT-1.5`.

  Customer note: archives gain `01 Data/setting_change.csv` and `.jsonl`, the history of setting changes; every existing file is unchanged.

  export_map: REF-EXPORT-1.5

### Patch Changes

- Updated dependencies [3c9bb25]
- Updated dependencies [3c9bb25]
  - @infrabyx/tenancy@1.15.0
  - @infrabyx/contracts@1.22.0
  - @infrabyx/crypto@1.5.7

## 1.3.1

### Patch Changes

- Updated dependencies [bc2c301]
  - @infrabyx/tenancy@1.14.1

## 1.3.0

### Minor Changes

- 1dda4b2: XLSX and DOCX writers over the package's own ZIP writer, with no new dependency (R1-plan M59; PR-LDC-28). `toXlsx(sheets, { created?, title?, creator?, maxBytes? })` writes a SpreadsheetML workbook: typed columns (`string`, `number`, `integer`, `boolean`, `date`, `datetime`), inline strings with formula injection neutralised (`neutraliseFormula`: a leading `=`, `+`, `-`, `@`, tab or CR gets an apostrophe), never a formula cell, finite numbers only, dates as Excel serials (UTC), a bold frozen header, Excel's sheet-name rules, and refusals past 1 048 576 rows, 16 384 columns, 32 767 characters a cell or the byte cap (64 MiB uncompressed by default). `toDocx({ title?, blocks }, { created?, creator?, maxBytes? })` renders headings 1 to 6, paragraphs of bold, italic, underlined and https-hyperlink runs, bullet and numbered lists with one nested level, plain-text tables and page breaks; no macros, fields or images. Both escape all text, drop characters invalid in XML 1.0, refuse with `OfficeExportError` (`reason`), and give the same bytes for the same input and `created` time. `toCsv` takes an optional `{ neutraliseFormulas: true }` for spreadsheet-bound CSV (off by default, so archive datasets are unchanged). PDF follows in wave 7.

### Patch Changes

- Updated dependencies [1dda4b2]
- Updated dependencies [1dda4b2]
- Updated dependencies [1dda4b2]
  - @infrabyx/tenancy@1.14.0
  - @infrabyx/contracts@1.21.0
  - @infrabyx/crypto@1.5.6

## 1.2.7

### Patch Changes

- Updated dependencies [b8c1f2c]
- Updated dependencies [b8c1f2c]
  - @infrabyx/contracts@1.20.0
  - @infrabyx/tenancy@1.13.0
  - @infrabyx/crypto@1.5.5

## 1.2.6

### Patch Changes

- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
  - @infrabyx/tenancy@1.12.0
  - @infrabyx/contracts@1.19.0
  - @infrabyx/crypto@1.5.4

## 1.2.5

### Patch Changes

- Updated dependencies [9c368c7]
- Updated dependencies [9c368c7]
- Updated dependencies [9c368c7]
- Updated dependencies [9c368c7]
  - @infrabyx/tenancy@1.11.0
  - @infrabyx/contracts@1.18.0
  - @infrabyx/crypto@1.5.3

## 1.2.4

### Patch Changes

- Updated dependencies [714ad01]
  - @infrabyx/contracts@1.17.0
  - @infrabyx/crypto@1.5.2
  - @infrabyx/tenancy@1.10.1

## 1.2.3

### Patch Changes

- Updated dependencies [b3edda2]
- Updated dependencies [b3edda2]
- Updated dependencies [b3edda2]
- Updated dependencies [b3edda2]
  - @infrabyx/tenancy@1.10.0
  - @infrabyx/contracts@1.16.0
  - @infrabyx/crypto@1.5.1

## 1.2.2

### Patch Changes

- @infrabyx/tenancy@1.9.2

## 1.2.1

### Patch Changes

- Updated dependencies [2a95100]
  - @infrabyx/crypto@1.5.0
  - @infrabyx/tenancy@1.9.1

## 1.2.0

### Minor Changes

- bdcdbe4: Reference export map `REF-EXPORT-1.4` (R1-D-58, Finbyx PR-FBX-32). The audit trail (`audit_event`) gains the ledger's `lane` and `lane_seq` (`audit/0006`), which the chain hashes when set. The archive's `verify.mjs` verifies the trail lane by lane: it reads every monthly file first, then follows each lane in `seq` order, so an exported laned chain verifies offline. A minor bump, because fields are only added. `REF-EXPORT-1.3` stays registered as `REF_EXPORT_MAP_1_3` for the dual run. In golden archives, `seq`, `lane` and `lane_seq` are normalised (now run-time values), and the golden archive is regenerated as `golden/REF-EXPORT-1.4`.

  export_map: REF-EXPORT-1.4

## 1.1.6

### Patch Changes

- Updated dependencies [7910610]
- Updated dependencies [1b99d7a]
- Updated dependencies [c83e9e0]
- Updated dependencies [af2ae98]
- Updated dependencies [c4117e4]
- Updated dependencies [854e309]
- Updated dependencies [0da0398]
- Updated dependencies [05c3122]
  - @infrabyx/tenancy@1.9.0
  - @infrabyx/contracts@1.15.0
  - @infrabyx/crypto@1.4.0

## 1.1.5

### Patch Changes

- Updated dependencies [97e8524]
- Updated dependencies [e41c3bd]
- Updated dependencies [92706c4]
- Updated dependencies [92706c4]
- Updated dependencies [4a87754]
- Updated dependencies [d66ffad]
  - @infrabyx/contracts@1.14.0
  - @infrabyx/tenancy@1.8.0
  - @infrabyx/crypto@1.3.1

## 1.1.4

### Patch Changes

- Updated dependencies [32b53ee]
- Updated dependencies [cff2a02]
  - @infrabyx/crypto@1.3.0
  - @infrabyx/contracts@1.13.0
  - @infrabyx/tenancy@1.7.2

## 1.1.3

### Patch Changes

- Updated dependencies [63c5ad2]
  - @infrabyx/contracts@1.12.0
  - @infrabyx/tenancy@1.7.1
  - @infrabyx/crypto@1.2.7

## 1.1.2

### Patch Changes

- Updated dependencies [2e3a2d3]
- Updated dependencies [2e3a2d3]
- Updated dependencies [3f20011]
- Updated dependencies [3f20011]
  - @infrabyx/contracts@1.11.0
  - @infrabyx/tenancy@1.7.0
  - @infrabyx/crypto@1.2.6

## 1.1.1

### Patch Changes

- Updated dependencies [138ae44]
- Updated dependencies [138ae44]
  - @infrabyx/contracts@1.10.0
  - @infrabyx/tenancy@1.6.0
  - @infrabyx/crypto@1.2.5

## 1.1.0

### Minor Changes

- 2b307e0: Reference export map `REF-EXPORT-1.3` (R1-D-26): the audit trail (`audit_event`) gains the ledger's `branch_id` (`audit/0004`), which the ledger chain hashes when it is set, and the archive's `verify.mjs` hashes it the same way, so an exported chain with branch entries verifies. A minor bump: a field is only added. `REF-EXPORT-1.2` stays registered as `REF_EXPORT_MAP_1_2` for the dual run. The golden archive is regenerated as `golden/REF-EXPORT-1.3`.

  export_map: REF-EXPORT-1.3

### Patch Changes

- Updated dependencies [2b307e0]
- Updated dependencies [2b307e0]
  - @infrabyx/contracts@1.9.0
  - @infrabyx/tenancy@1.5.0
  - @infrabyx/crypto@1.2.4

## 1.0.13

### Patch Changes

- Updated dependencies [cd25633]
- Updated dependencies [cd25633]
  - @infrabyx/contracts@1.8.0
  - @infrabyx/tenancy@1.4.0
  - @infrabyx/crypto@1.2.3

## 1.0.12

### Patch Changes

- @infrabyx/tenancy@1.3.5

## 1.0.11

### Patch Changes

- Updated dependencies [f5622c9]
  - @infrabyx/contracts@1.7.0
  - @infrabyx/tenancy@1.3.4
  - @infrabyx/crypto@1.2.2

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
