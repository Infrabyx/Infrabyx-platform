---
"@infrabyx/export": minor
---

`toOds(sheets, options)` and `toOdt(document, options)` (regulatory templates plan §7, item (b); R1-D-313): OpenDocument 1.3 spreadsheets from the `toXlsx` sheet model and text documents from the `toDocx` block model, with no dependency. Values are checked as `toXlsx` checks them, strings are formula-neutralised, and tabs, line breaks and runs of spaces survive. The header is bold and frozen, column widths are kept, and `mimetype` is the first entry, stored. A `toXlsx` feature an ODS cannot carry (validations, protection, frozen columns, AutoFilter, fills, row layout, page set-up, conditional formats, formula cells, named ranges) is refused `ods_unsupported`, never dropped. `writeZip` gains an opt-in `firstStored`; existing archives keep their bytes.
