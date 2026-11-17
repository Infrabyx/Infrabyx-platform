---
"@infrabyx/export": minor
---

`readXlsx` and `xlsxRecords`: a bounded, dependency-free XLSX reader for untrusted uploads (PR-LDC-31 reader). It checks the ZIP container's sizes, counts and ratios before inflating, caps every inflate at its declared size, refuses a DOCTYPE, entities and macro projects, and limits sheets, rows, columns and cell length. It returns values only (cached formula results, dates as ISO strings).
