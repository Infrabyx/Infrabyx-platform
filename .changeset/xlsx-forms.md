---
"@infrabyx/export": minor
---

`toXlsx` workbook forms (PR-LDC-31 writer, M81): column `width`, typed data validations (`list` of values or of a named range, `whole`, `decimal`, `date`, `textLength`, with prompt and error messages), workbook `namedRanges`, and sheet `protection` as lock flags with `editable` columns, never a password. A workbook that uses none of these is unchanged byte for byte.
