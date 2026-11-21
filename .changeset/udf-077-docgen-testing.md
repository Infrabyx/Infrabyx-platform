---
"@infrabyx/testing": minor
---

`docgenStorageContractCases(storage)` (Udofin PR-UDF-077, R1-D-259): DOCGEN cases for an adapter that writes its files, checking that each PDF and PDF/A `renderHtml` output is an object in `storage` under the prefix, starts `%PDF-`, is stored as `application/pdf` and hashes to the returned `sha256`. Run against `FakeDocgen` with files, here with `pdfFixture` and in `@infrabyx/export` with `toPdf`. Re-exports the `FakeDocgenFiles`, `FakeDocgenRenderers`, `FakeDocgenDocument` and `FakeDocgenPdfOptions` types.
