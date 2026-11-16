---
"@infrabyx/export": patch
---

The export map gate reads every column of a multi-column `ALTER TABLE` (`add column a …, add column b …`, `add` without `column`, `if exists`, quoted names), so map fields on later columns are no longer reported as missing (PR-LDC-61).
