---
"@infrabyx/export": minor
---

`pdfIdentification(bytes, { maxBytes? })` and `pdfUaClaimed(bytes)` (Udofin PR-UDF-077, R1-D-259): the PDF/A (`pdfaid:part`, `conformance`) and PDF/UA (`pdfuaid:part`) identification a PDF **claims** in its catalog's XMP metadata; not a validation (veraPDF says whether a file conforms). A bounded reader, not a parser: the file is capped (64 MiB by default; over it `too_large`), the catalog is the last top-level one or one inside an object stream (FlateDecode, at most 64 streams, each inflated to at most 4 MiB), its `/Metadata` stream is read uncompressed or FlateDecode only, and the XMP is matched by namespace (any prefix, element or attribute form). Metadata of pages, images or fonts never counts; anything missing, malformed or over a limit is no claim (`{}`). `toPdf`'s PDF/A-2b output reads as `{ pdfa: { part: 2, conformance: "B" } }`, with `pdfua: { part: 1 }` under `pdfua: true`.
