---
"@infrabyx/export": minor
---

PDF export (PR-LDC-28; dependency review `docs/phases/R1-pdf-dependency-review.md`, R1-D-95): `toPdf(doc, { creator, created, maxBytes })` renders the `toDocx` block model (headings, paragraphs with bold, italic, underline and https links, bullet and numbered lists with one nested level, tables with a header row repeated on each page, page breaks) as a PDF 1.7 file, A4, with no new dependency. Text is set in the standard Helvetica fonts with WinAnsiEncoding (no font embedded); a character outside WinAnsi, such as the rupee sign or Indic script, is refused with `char_unsupported`, never replaced. No JavaScript, forms, attachments or actions other than https link annotations; the same input and `created` time give the same bytes.
