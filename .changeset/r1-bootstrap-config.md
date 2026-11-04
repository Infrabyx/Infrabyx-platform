---
"@infrabyx/config": minor
---

`SettingsService.setInitial(tx, key, value)`: a new tenant's initial tenant-tier value inside `TenantBootstrap`'s transaction, with `set`'s validation, tighten check and ledger entry; refused outside a tenant's creation and for settings under maker-checker (R1-D-67).
