# Regulatory templates: what the platform must provide (gap analysis)

**Status: approved by the owner, 27 Nov 2026 15:45 IST (#212, R1-D-301), with the answers in §5a. Built item by item in the order (b), (c), (a), (d), (e), (f).**

Finbyx, Udofin and LawDocsComply will build the owner's 492 regulatory templates (`docs/regulatory-templates/`, merged as specifications, R1-D-297) into registers, documents, checklists, obligation tasks and calculators. This plan says, for each generic the three need, whether a published package already provides it, so that no product builds a generic itself.

## 1. The inputs

Each record of `template index.json` has `code`, `title`, `area`, `md` (the governing law), `kind`, `module`, `products`, `integration` (the pattern), `priority`, `export`, `sheets: [{ name, cols[] }]`, and also `file`, `path`, `source_file` and `basis` (the SOP step or section, on 285 records).

| Pattern (`integration`)                                                                                   | Templates | High | Comply | Finbyx | Udofin | Layout given                             | `export`                     |
| --------------------------------------------------------------------------------------------------------- | --------- | ---- | ------ | ------ | ------ | ---------------------------------------- | ---------------------------- |
| Module with list view, filters, audit trail and export (**register**)                                     | 114       | 87   | 114    | 45     | 16     | 320 sheets, ≤ 14 cols                    | Excel (.xlsx), CSV, PDF, ODS |
| Digital checklist with maker-checker sign-off and evidence upload (**checklist**)                         | 70        | 24   | 67     | 18     | 13     | `.docx`                                  | PDF, Word (.docx), ODT       |
| Generate from system data with merge fields; e-sign, deliver and archive (**document**)                   | 93        | 35   | 82     | 34     | 19     | `.docx`                                  | PDF, Word (.docx), ODT       |
| Computation module with inputs, results, alerts and export (**calculator**)                               | 23        | 10   | 22     | 10     | 2      | 47 sheets                                | Excel (.xlsx), CSV, PDF, ODS |
| Obligation and task library: each row a scheduled task with owner, due date and evidence (**obligation**) | 70        | 43   | 70     | 0      | 0      | 70 sheets; 69 share one 13-column layout | Excel (.xlsx), CSV, PDF, ODS |
| Template library (download and fill), with approval workflow where noted (**library**)                    | 122       | 0    | 117    | 26     | 10     | `.docx`                                  | PDF, Word (.docx), ODT       |

**Finding:** the document patterns export **ODT** as well as PDF and `.docx`, so the standard is wider than xlsx, csv, pdf and ods: (b) below covers ODS and ODT.

## 2. The standards every pattern meets

| Standard                                                              | Platform today                                                                                                                                                                                       | Gap                                                                                                                                 |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Export to xlsx, csv, pdf, ods (registers); pdf, docx, odt (documents) | `@infrabyx/export`: `toXlsx` (typed columns, layout), `toCsv` (formula-neutralised), `toPdf` (tagged, Indic shaping, PDF/A-2b), `toDocx`. No ODS, no ODT                                             | (b)                                                                                                                                 |
| An audit trail on every row                                           | `tenancy` `MutationKernel.mutate` writes the hash-chained ledger in the same transaction (IPB-02; every mutation). Row history is the ledger's, read through `audit`                                 | A register-level "history of this row" read is missing: part of (a)                                                                 |
| Maker-checker                                                         | `tenancy` `ApprovalsEngine` and `workflow` `ApprovalWorkflow` (IPB-02 §02.4.6.1, the checker never the maker, R-levels, expiry, escalation, bulk)                                                    | None for the engine; (a) and (d) wire it per row and per item                                                                       |
| Retention "at least eight years", a floor, never a purge              | STORAGE write-once with COMPLIANCE retention (IPB-01-29), `extendRetention` only later, erasure refused under statutory retention (`IPB-SEC-022`); shortening retention is maker-checker (IPB-02-80) | A register-row retention floor in the database: rows are never deleted today only by convention. (a) adds a guard; owner question 2 |

## 3. Gap analysis

| Item    | Need                                                                                                                                               | Status      | Where today / the gap                                                                                                                                                                                                                                                                            | Proposal (package, release)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | IPB                                                                       | Contract cases (filed layouts, synthetic data)                                                                                                                                                                                                                                                                                 | Size |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| **(a)** | A register-definition schema: columns typed, ordered, required, with sources; validated against a sheet layout; list, filter, audit and export     | **Partial** | `ui` `DataGrid` (typed columns, PR-LDC-32), `export` `toXlsx`/`toCsv`/`toPdf` and the bounded XLSX reader (PR-LDC-31), the kernel's ledger. Missing: one definition that drives all of them, the layout check, and list/filter/history over a register's rows                                    | `contracts` `RegisterDefinition` (zod): `code`, `title`, `columns[{ key, label, type, required, source, order, enum? }]`, `sheets`, `retention`; `assertLayout(def, sheet)` against an index record's `sheets` or an uploaded workbook (exact names and order). `export` `registerExport(def, rows, format)` to xlsx, csv, pdf, ods. `tenancy` or a new `@infrabyx/registers` (owner question 1): a generic row store with RLS (one table, `jsonb` row data validated by the definition, data class per column), list with filters and cursor (IPB-10), row history from the ledger, maker-checker per row. Minors | IPB-02-12, IPB-02-19, IPB-10 (lists, cursors, problems), IPB-02 §02.4.6.1 | CA-A01's `Calendar` layout validates; a sheet with two columns swapped is refused naming both; a missing required column refused; every one of the 114 index layouts parses as a definition; row history after edit and approval; export of a synthetic 1,000-row register in the four formats round-trips through the readers | L    |
| **(b)** | ODS beside xlsx, csv and pdf (and ODT for documents)                                                                                               | **Missing** | `export` writes OOXML only                                                                                                                                                                                                                                                                       | `export` `toOds` (same `XlsxColumn` model, OpenDocument 1.3 spreadsheet, zip with `mimetype` stored first) and `toOdt` (the `DocxDocument` model). Both deterministic, so golden tests hold. A minor                                                                                                                                                                                                                                                                                                                                                                                                               | IPB-09-34/35 (export map stability)                                       | A filed register layout written as ODS opens in LibreOffice headless and reads back cell for cell; formula triggers neutralised as in CSV; Indic text kept; ODT of a filed document's text blocks                                                                                                                              | M    |
| **(c)** | DOCGEN: a `.docx` template with merge fields bound to data, missing-field refusal, then the ESIGN handoff and the archive with version and SHA-256 | **Partial** | The DOCGEN port has `render`, `validateTemplate`, `listTemplates`, but the only adapter (`gotenberg`) does HTML to PDF; template rendering (docxtemplater, IPB-01's named reference) is declared unsupported. ESIGN takes documents by reference; STORAGE writes once with retention and SHA-256 | `connectors` `docxtemplater` DOCGEN adapter: tags `{field}` and loops only (no code, no expressions), every tag must be bound (missing → refused with the field names, never an empty string), `validateTemplate` lists tags, then Gotenberg's LibreOffice route for PDF/PDF-A. `workflow` `issueDocument(render → approve → esign → archive)`: the template version and the output's SHA-256 on the record, archived write-once. A minor each in `connectors` and `workflow`                                                                                                                                      | IPB-01 DOCGEN, ESIGN, STORAGE; IPB-01-29                                  | PD-A02 (Deposit Receipt) with merge fields added on a test copy renders; one unbound field refused naming it; an extra data key ignored; the archived object's SHA-256 equals the rendered bytes; the template version on the record; e-sign handoff with the fake                                                             | L    |
| **(d)** | A checklist primitive: item states, reasons, evidence, maker-checker with step-up, a failed item → action                                          | **Missing** | Pieces only: approvals, the staff `acr` step-up (`identity` `stepUp`, RFC 9470), the upload pipeline (`releaseUpload`), the inbox                                                                                                                                                                | `workflow` `Checklist`: a definition (items with `id`, `text`, `basis`, evidence required or not); a run with item states `open`, `met`, `not_met`, `not_applicable` (a reason for the last two), evidence as released file refs (PR-FBX-56), sign-off by maker then checker with step-up on sign-off, and a `not_met` item raising an action (an inbox item or a GRC issue). A minor, with a `tenancy` migration for the run tables                                                                                                                                                                               | IPB-02 §02.4.6.1, IPB-02-44                                               | AA-A01 (FIP and FIU onboarding checklist) items as a definition; sign-off refused while an item is open; a `not_met` item without a reason refused; the checker cannot be the maker; sign-off without step-up refused; a `not_met` item raises one action                                                                      | M    |
| **(e)** | An obligation row → a scheduled task with owner, due date and evidence                                                                             | **Partial** | `workflow` timers (product timer kinds), the inbox (due, snooze, escalation), the GRC port (`listObligations`, `submitEvidence`) and `ObligationPublished` (spec v1.5). Missing: turning a filed obligation list into recurring tasks                                                            | `workflow` `ObligationLibrary`: import a list in the 13-column layout (69 of 70 lists) or the advisories' 7-column one, map `Frequency / timeline` to a recurrence (owner question 3), `Responsible` to a role, create inbox tasks with due dates, evidence on completion, `Status` and `Evidence location` written back. Only if the owner wants it in the platform (owner question 4); LawDocsComply alone uses these lists                                                                                                                                                                                      | IPB-07 (inbox), Ecosystem §6.15 (`ObligationPublished`)                   | The Companies Act list imports; "Annual, within 30 days of the AGM" and "Quarterly" give the right next due dates; an unknown frequency is refused for review, never guessed; completing a task without evidence refused                                                                                                       | M    |
| **(f)** | The template-library pattern in `cms`: download, fill, upload back as evidence, approval                                                           | **Missing** | `cms` holds pages, blocks and resources for the websites; nothing serves a tenant a controlled template and takes it back                                                                                                                                                                        | `cms` `TemplateLibrary`: versioned templates (the owner's files, by code and SHA-256), download as an attachment (presigned, R1-D-292), upload back through `releaseUpload`, linked to the template version, approval where the index says so, kept under retention. A minor                                                                                                                                                                                                                                                                                                                                       | IPB-02-44, IPB-01-29                                                      | ABAC-A01 (Gifts, Hospitality and Third-Party Due Diligence Forms) downloads with its SHA-256; an upload of the filled form passes the upload pipeline and links to the version; a filled form of an old version is flagged; approval required where marked                                                                     | M    |
| **(g)** | The regcalc package of B.5, with the models' worked examples as oracles                                                                            | **Missing** | Nothing                                                                                                                                                                                                                                                                                          | `@infrabyx/regcalc`: plan `docs/phases/R1-regcalc-plan.md` (stops for the owner separately)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | IPB-01                                                                    | As that plan                                                                                                                                                                                                                                                                                                                   | L    |

The 23 **calculators** are (g) plus product-specific monitors (ALM, ICAAP, provisioning and others): (a) gives them inputs and results as registers; their formulas join `regcalc` model by model when a product asks.

## 4. What the products keep

- The content: which templates a product offers, their wording, translations and the fields its data maps to (`source` in a column definition points at the product's own data).
- Merge fields in each `.docx`: the filed templates are Word documents with blanks, not tagged templates; each product tags the ones it generates and keeps them under its own DOCGEN template store.
- Product screens: the register, checklist and library views are built from `ui` components; the routes and permissions are the product's.
- The ledger events a product emits about its own registers (`in.<product>.<module>.<Event>.v<n>`).
- Calculators beyond `regcalc`'s modules, until a second product needs the same one.

## 5. Owner decisions needed

1. **Where register rows live:** a new `@infrabyx/registers` package (its own schema, IPB-01-09 module = schema) or inside `tenancy`? The plan proposes a new package with an ADR and a platform request for IPB-14 §14.2.
2. **The eight-year floor in the database:** a trigger that refuses a delete of a register row before its retention date (never a purge job), with corrections as new versions?
3. **Frequencies:** a fixed vocabulary (once, monthly, quarterly, half-yearly, annual, event-driven with an offset) that each filed `Frequency / timeline` value is mapped to by a reviewed table, and anything else refused for a person to map?
4. **(e) in the platform or in LawDocsComply only?** Only LawDocsComply's 70 lists use it today.
5. **ODT:** confirm documents export ODT as the index says (the order named xlsx, csv, pdf and ods).
6. **DOCGEN tags:** plain `{field}` and loops only, no conditions or expressions in templates (the safe subset), with conditions decided in data?
7. **Order:** (b) and (c) first (every product needs export and documents), then (a), (d), (f), (e). Each its own PR and minor, each with its own plan section when it starts.

## 5a. The owner's answers (27 Nov 2026 15:45 IST; R1-D-301)

1. A new `@infrabyx/registers` package (its own schema), with an ADR and the platform request for IPB-14 §14.2.
2. A trigger refuses deleting a register row before its retention date. Corrections are new versions. No purge job ever exists. Shortening retention stays maker-checker and is on the owner's locked list.
3. A fixed vocabulary: once, daily, weekly, fortnightly, monthly, quarterly, half-yearly, annual, and event-driven with an offset in days (before or after). A reviewed mapping table covers each filed `Frequency / timeline` value; anything unmapped is refused for a person to map, never guessed.
4. (e) is in the platform: Udofin waits for a platform calendar (its #234 (a)), and Finbyx has filing calendars too.
5. ODT for documents, as the index says, beside PDF and DOCX; ODS for registers and calculators.
6. `{field}` and loops only, no conditions or expressions; conditions are decided in data. Values are escaped, there are no external references or includes, and a missing binding is refused with the field names.
7. Order: (b), (c), (a), (d), (e), (f). Each is its own PR and minor, with its plan section when it starts.

## 6. Exit checklist (for each item when built)

- Contract cases above, on synthetic data, built from the filed layouts.
- Threat model entries: (a) a generic row store (RLS, data class per column, `jsonb` validation), (c) template rendering (no code in templates), (d) evidence uploads, (f) files going back to tenants.
- Guide sections and DECISIONS rows; the owner's decisions recorded.

## 7. Item (b): ODS and ODT in `@infrabyx/export` (plan section, 28 Nov 2026; R1-D-313)

**Interfaces** (an `export` minor; no dependency, migration or setting):

- `toOds(sheets: readonly XlsxSheet[], o?: OdsOptions): Buffer`: an OpenDocument 1.3 spreadsheet from the **same** sheet model as `toXlsx`.
  - **Cells by column type:** `string` as text, `number` and `integer` as floats, `boolean`, and `date` and `datetime` as ISO values in UTC. Every value is checked as `toXlsx` checks it, and a bad one is refused `cell_invalid`, never coerced.
  - **Strings:** they pass `neutraliseFormula` as in `toCsv` and `toXlsx`, so a cell never starts with a formula trigger. Line breaks, tabs and runs of spaces are kept as ODF elements, and Indic text is kept as written.
  - **Header and widths:** the header row is bold and frozen, as in `toXlsx`, and the column widths are kept.
  - **Limits:** the same sheet-name rules and row and column limits as `toXlsx`, and the `maxBytes` cap.
  - **Refused, not dropped:** any feature `toXlsx` has and an ODS cannot carry the same way is refused `ods_unsupported`, naming the feature. Those are validations, protection, frozen columns, AutoFilter, fills, row layout, page set-up, conditional formats, formula cells and named ranges. A register is never exported with a control silently missing.
- `toOdt(doc: DocxDocument, o?: OdtOptions): Buffer`: an OpenDocument 1.3 text document from the **same** block model as `toDocx`.
  - **Blocks:** headings 1 to 6, runs (bold, italic, underline, https hyperlinks), bullet and numbered lists with one nested level, tables with a repeated header row, and page breaks. A4 portrait with 2.54 cm margins.
  - **Refusals:** the same as `toDocx`, with the same reasons (`block_invalid`, `link_invalid`, `too_many_blocks`, `too_large`).
- **Both outputs:**
  - **Package layout:** `mimetype` is the first ZIP entry, stored uncompressed (ODF 1.3 Part 2 §3.3; `writeZip` gains an opt-in `firstStored`, so every existing archive keeps its bytes), followed by `META-INF/manifest.xml`, `content.xml`, `styles.xml` and `meta.xml`.
  - **Nothing executable or external:** no macros, scripts, embedded objects, images or fields, and no external reference except the https hyperlinks the caller names.
  - **Deterministic:** the same input and `created` time always give the same bytes, so golden tests hold.

**Contract cases** (synthetic data, filed layouts):

- **A filed register layout (CA-A01's `Calendar`) written as ODS:**
  - its parts parse, and every cell reads back to its value and type;
  - formula triggers are neutralised;
  - Indic text, tabs, line breaks and space runs are kept;
  - the header is frozen;
  - the same input gives the same bytes;
  - `mimetype` is first and stored.
- **A LibreOffice Calc leg:** `soffice --headless` converts the ODS to XLSX, and `readXlsx` reads it back cell for cell. It runs where `soffice` exists; this session ran it.
- **A filed document's text blocks as ODT:** headings, lists, a table with its header and a hyperlink read back from `content.xml`, and a LibreOffice Writer leg converts it to DOCX without loss of text.
- **Refusals:** each `ods_unsupported` feature is refused by name; a bad cell is refused `cell_invalid`; an `http:` link is refused `link_invalid`.

**Threat model:** one entry for the ODF writers (no active content, escaping, neutralised formula triggers, the byte cap).

**Exit:** the cases above; `export` lint, typecheck and unit tests; guide section; a DECISIONS row.

## 8. Item (c): the DOCGEN template adapter and `issueDocument` (plan section, 28 Nov 2026; R1-D-314, R1-D-315)

Two PRs, each a minor: first the adapter (`connectors`, with its contract cases in `testing`), then `workflow` `issueDocument`.

**1. `connectors` `DocxtemplaterDocgen` (adapter `docxtemplater`; IPB-01 DOCGEN's named reference).** It runs in-process, so there is no external account and no flag. A product supplies its template store, and the adapter fills its tagged `.docx` templates (owner answer 6):

- **Tags:** only `{field}` and loops `{#items}…{/items}` are allowed. A field or loop name is `[A-Za-z_][A-Za-z0-9_]*`, with no dots, expressions or filters.
- **Refused in a template:** a raw-XML tag `{@…}`, an inverted section `{^…}`, any other syntax, and a syntax error.
- **Data:** a loop's value must be an array of objects (a boolean or an object would make it a condition, and conditions are decided in data). A field's value must be text, a number or a boolean.
- **Missing bindings:** every field must be bound; a missing one is refused `binding_missing` with the field names (loop fields as `items[].field`), never rendered as an empty string. Extra data keys are ignored.
- **Escaping:** values are XML-escaped (docxtemplater's default), so a value can never add a paragraph, a field or a link. Line breaks in a value become breaks.
- **Template safety, checked by `validateTemplate` and again before every render** (a template that fails is refused `template_unsafe` with its problems):
  - no macros (`vbaProject.bin`, macro-enabled content types);
  - no ActiveX, OLE embeddings or `altChunk`;
  - no external relationship except an https hyperlink;
  - no `INCLUDETEXT`, `INCLUDEPICTURE`, `DDE`, `DDEAUTO`, `LINK`, `IMPORT` or `DATABASE` field;
  - a size cap.
- **Templates and files:** the template is read from STORAGE by reference and its SHA-256 checked. The output goes to STORAGE under the request's prefix with its SHA-256 and the template version.
- **Formats:**
  - `docx` in-process.
  - `pdf` and `pdfa` through Gotenberg's LibreOffice route (`GotenbergDocgen.convertDocx`, a new method), A4, PDF/A-2b for `pdfa`.
  - `html` is unsupported, and so is `previewHtml`.
  - `renderHtml` is delegated to Gotenberg when one is configured.
- **Dependencies** (pinned exactly, past the 7-day rule): `docxtemplater` 3.71.1 (MIT, 15 Oct 2026; its `@xmldom/xmldom` 0.9.12, MIT) and `pizzip` 3.3.0 (MIT OR GPL-3.0, taken as MIT; its `pako`, MIT AND Zlib).
- **Contract cases** (`testing` `docgenTemplateContractCases`, on a test copy of PD-A02, the Deposit Receipt, with merge fields added):
  - it renders, a tag split across Word runs included, with values escaped;
  - a missing binding is refused, naming it;
  - an extra key is ignored;
  - a raw tag, an inverted section, a dotted name, an `INCLUDETEXT` field, an external image and a macro part are each refused;
  - a loop given a boolean is refused;
  - the output's SHA-256 is the stored bytes' own.
  - The Gotenberg leg renders PDF and PDF/A (hermetic, CI).

**2. `workflow` `issueDocument(render → approve → esign → archive)`** (built 28 Nov 2026, 2c): the template version and the output's SHA-256 on the record, and the signed file archived write-once with retention (IPB-01-29).

**2a. `workflow` `issueDocument`: the detailed plan** (written 28 Nov 2026 for the next session; R1-D-315)

One `workflow` minor with one migration (`workflow/0006_document_issue.sql`). It builds on the `docxtemplater` adapter (item 1), the approvals engine (`tenancy`), ESIGN and STORAGE.

- **Record, `workflow.document_issue`** (tenant-scoped, RLS enabled and forced, each column with its data class):
  - `id` (`dis_` ULID);
  - `template_id` and `template_version`, both INTERNAL;
  - `format`;
  - `data_sha256` (the SHA-256 of the canonical JSON of the data, never the data itself), CONFIDENTIAL;
  - `rendered_key` and `rendered_sha256`;
  - `approval_id`, null when the product's policy needs none;
  - `envelope_id`;
  - `signed_key` and `signed_sha256`;
  - `archived_key`, `archived_sha256` and `retain_until`;
  - `state`: `rendered`, then `approval_pending`, `approved`, `signing`, `signed`, `archived`; or `rejected`, `expired` or `failed`;
  - `created_by`, `created_at` and `updated_at`.
- **Mutations:** each runs through `MutationKernel.mutate` with a ledger entry `workflow.document_issue.<step>`, which names the record and both hashes but never the data.
- **Steps:**
  1. **`issue(ctx, { templateId, data, format, outputPrefix, approval?, signers?, retainUntil })`:** renders through DOCGEN, records `rendered` with the template version and the output's SHA-256. If the product asks for approval, it requests one through the `ApprovalsEngine` (R-level from the product; the checker is never the maker, PL3-D-07), which leaves the record at `approval_pending`.
  2. **Approval:** the `ApprovalWorkflow` observer moves the record to `approved`, or to `rejected` or `expired`. Executing the approval starts signing.
  3. **Signing:** `ESIGN.createEnvelope(rendered, signers)` and `sendForSignature`, leaving the record at `signing`. On completion (the ESIGN webhook or a poll by a product timer), the signed file is read back. It is checked against the envelope's own record and stored with its SHA-256, and the record moves to `signed`.
  4. **Archive:** `STORAGE.putWithRetention(signed bytes, retainUntil)` to a REGULATED write-once key; the record moves to `archived` with `archived_sha256`, which must equal `signed_sha256`, else `failed`. Retention is the product's input with a floor of today; shortening it is never possible here (IPB-02-80; the locked list).
- **Idempotent:** each step keys on the record id, so re-running a step changes nothing.
- **Open points for the owner** (asked when the plan is posted; **answered 28 Nov 2026, see 2b**):
  - whether a document with no signers skips straight to the archive;
  - whether the rendered, unsigned copy is kept after archiving. The default is to keep it, since deleting it is on the locked list.
- **Contract cases** (synthetic, the fakes):
  - **The happy path:** PD-A02's tagged copy renders, is approved by a checker other than the maker, is signed with `FakeEsign` and is archived. The archived SHA-256 equals the signed bytes, and the template version is on the record.
  - **Refusals:** the maker cannot approve; a rejected approval never signs; a signed file whose hash changes before the archive is `failed`; and a retry of any step is a no-op.
- **Threat model:** a new data flow (rendered documents through approval, signing and archive) and the new table (RLS, data classes).

**2b. The owner's answers to the two open points (28 Nov 2026 11:45 IST; R1-D-318).** They replace the open points of 2a.

- **A document with no signers:** it goes from `rendered` straight to the archive only when both of these hold:
  - its template is registered as **unsigned** (`signing: "none"`; for example a notice, a register extract or an MIS report);
  - a person has **reviewed** the render. The review is a recorded step (`reviewed_by`, `reviewed_at`), and the reviewer is never the maker. Where the product's rules ask for maker-checker, the review is an approval through the `ApprovalsEngine`.
  - A template registered as **needing signatures** (`signing: "required"`) can never skip signing: `issueDocument` refuses it without signers (`signers_required`). Signers given for an unsigned template are refused as well (`signers_not_expected`), so the registration decides, never the caller.
- **The unsigned rendered copy is kept** after archiving, with the signed copy's retention: it is the evidence of exactly what was sent for signature.
  - At the archive step it is written write-once with the same `retain_until` (`rendered_archived_key`, with its SHA-256, which must equal `rendered_sha256`).
  - The record links it to the signed version. Nothing is deleted.

**2c. As built (28 Nov 2026; R1-D-321).** `DocumentIssuer` in `@infrabyx/workflow`, migration `workflow/0006_document_issue.sql`:

- **Registration:** `registerTemplate(templateId, { signing: "required" | "none" })`; an unregistered template is refused (`template_unregistered`).
- **Steps:** `issue` → `review` (unsigned, no approval) or the approval → `sendForSignature` → `completeSigning` → `archive`. Each step returns the record, and a repeated step changes nothing and writes no ledger entry. A step that loses a race writes a `stale` entry, since every mutation is ledgered.
- **Approval:** the product registers `issuer.approvalPolicy({ checkerRoles })` on `DOCUMENT_ISSUE_ACTION`. Its executor moves the record to `approved` in the approval's own executing transaction, after checking the request's payload digest against the record. `refreshApproval` brings in a rejection, cancellation or expiry.
- **Signers:** given at `issue` and again at `sendForSignature`. Only their SHA-256 is kept, and any change is refused (`signers_changed`). A signing template renders as `pdf` or `pdfa` only. Without an approval an agent may issue but not send (IPB-SEC-004).
- **Review:** by a person (never an agent, IPB-SEC-004) other than the one who issued the document (IPB-SEC-007).
- **Archive:** REGULATED, write-once with the record's `retain_until`, under `tenant/<tenant>/document_archive/<ULID>.<ext>`.
  - The keys are recorded before any write, so a retry writes to the same keys.
  - Every source and every archived copy is read back and hashed; each copy is proved immutable.
  - A changed source is recorded `failed` (`hash_mismatch`).
  - The database refuses an archived signing template without a signed hash, and an archived hash that is not the file's.
- **Tests:** eleven integration cases on PostgreSQL with the platform fakes (synthetic data). No contract-case export: the issuer is not a port with adapters.

**Threat model:** template rendering (no code in templates, escaping, no external references, no includes) and the two new dependencies.
