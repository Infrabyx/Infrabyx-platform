---
"@infrabyx/export": minor
---

`registerExport(definition, rows, format)` writes a register as xlsx, csv, pdf or ods from its `RegisterDefinition`, with every row checked first and the filed labels as headers (CSV formula-neutralised; an AutoFilter on xlsx only). `registerPdfDocument` gives the PDF model for `renderPdf` when rows hold Indic text, which the in-process PDF refuses (templates item (a), part 1; R1-D-322; guide §7fm).
