---
"@infrabyx/export": minor
---

PDF: the rupee sign, and Indic text through DOCGEN (OWNER-QUESTIONS #117, R1-D-96). `toPdf` now embeds Noto Sans (Regular, Bold, Italic, Bold Italic; SIL OFL 1.1, subset once and shipped in `fonts/`, provenance in `fonts/FONTS.md`) as CIDFontType2 fonts with a ToUnicode map, in place of the standard Helvetica: Latin (Basic, Latin-1, Extended-A), the usual punctuation, the euro and the rupee sign (U+20B9). Text in an Indic script is refused with `shaping_required` (other characters the fonts lack: `char_unsupported`); never replaced. `renderPdf(doc, { docgen, lang, outputPrefix })` routes a document with Indic text to the DOCGEN port's `renderHtml` (Gotenberg's Chromium shapes it) and renders the rest in process; `blocksToHtml(doc, { lang })` writes the same blocks as a self-contained HTML page that fetches nothing; `pdfNeedsShaping(doc)` tells which path applies.
