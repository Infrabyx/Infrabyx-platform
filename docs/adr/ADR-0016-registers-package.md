# ADR-0016 — A `registers` package for regulatory registers

- **Status:** Accepted — regulatory templates item (a) (owner answer 1, 27 Nov 2026 15:45 IST; R1-D-301); spec request PR-052
- **Date:** 2026-11-28
- **Deciders:** owner (`@infrabyx/platform-owners`)
- **IPB sections:** IPB-14 §14.2 (repository layout), IPB-01-09 (module = schema = bounded context), IPB-02-12 and IPB-02-19 (RLS, data classes), IPB-10 (lists, cursors, problems), IPB-02 §02.4.6.1 (maker-checker)

## Context

The owner's filed index has 114 register templates (320 sheets of at most 14 columns), used by LawDocsComply (114), Finbyx (45) and Udofin (16). Each needs typed columns, a check against the filed layout, a list with filters and an audit trail, maker-checker on changes, retention of at least eight years with no purge, and export to xlsx, csv, pdf and ods. Built three times, the layouts and the retention rule would drift. The owner chose a new package with its own schema rather than tables in `tenancy` (answer 1). A trigger refuses deleting a row before its retention date, and corrections are new versions (answer 2).

## Decision

1. **The definition is a contract.** `@infrabyx/contracts/registers` holds `RegisterDefinition` (zod) with its sheets, its typed and data-classed columns and a retention floor of eight years. It also holds `assertLayout` (exact labels, exact order, every problem named), `definitionFromIndex` (a first definition from a filed record) and the row checks. They are pure and have no I/O. This lands first, as a `contracts` minor (part 1).
2. **The export is `@infrabyx/export`'s.** `registerExport(definition, rows, format)` writes xlsx, csv, pdf and ods through the existing writers, and `registerPdfDocument` builds the model for DOCGEN's Indic route. This is an `export` minor (part 1).
3. **The row store is `packages/registers`** (`@infrabyx/registers`, schema `registers`, part 2). It is one generic table of versioned rows, with `jsonb` data checked against the definition. It is tenant-scoped with RLS enabled and forced, and every column is data-classed. A delete trigger refuses a row before its retention date, and there is no purge. It provides lists with filters and cursors, row history from the ledger, and maker-checker per row through the approvals engine. Until its exit (the plan's contract cases), it is `"private": true` at 0.0.0, so no release run publishes it early; publishing 1.0.0 waits for the owner, as `regcalc`'s did.

## Verification

- Part 1: every one of the 114 filed register layouts parses as a definition and passes its own layout. CA-A01's Calendar validates. A swapped pair is refused naming both, and a missing required column naming it. A synthetic 1,000-row register round-trips in the four formats through the readers (the XLSX reader, CSV, pdftotext, LibreOffice).
- Part 2: row history after an edit and an approval; a delete before the retention date refused by the trigger; RLS across tenants; the list's cursor and filters.

## Consequences

The platform gains a 25th package when `registers` 1.0.0 is published. Products keep the content: which registers they offer, the column sources and their screens. IPB-14 §14.2 needs one line for `registers/` (PR-052).
