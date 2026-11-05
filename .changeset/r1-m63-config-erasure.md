---
"@infrabyx/config": minor
---

DPDP erasure of a person's USER settings (OWNER-QUESTIONS #110, R1-D-95): `SettingsService.eraseUser(ctx, userId, { requestRef, reason })` deletes the person's USER values and USER change history in the caller's tenant in one transaction, ledgered as `settings.user.erase` with the counts and the request reference (never a value). Callers: the product's erasure workflow (a service principal), ORG_OWNER or ORG_ADMIN; agents, externals and platform contexts are refused. Migration `config/0004` adds `config.setting_erasure` and the history's only delete path (USER rows of an erased person, in the caller's tenant); the history stays insert-only otherwise. `SettingsStore.eraseUser` is optional.
