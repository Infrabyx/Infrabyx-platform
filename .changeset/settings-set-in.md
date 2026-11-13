---
"@infrabyx/config": minor
---

`SettingsService.setIn(tx, key, target, value)`: a UNIT or TENANT write inside the caller's transaction with every check `set` makes; a maker-checker key still answers `pending` (PR-LDC-42).
