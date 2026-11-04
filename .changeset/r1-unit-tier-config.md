---
"@infrabyx/config": minor
---

UNIT setting scopes below ENTITY (PR-042; LawDocsComply PR-LDC-17; R1-D-95). A key opts in with `unit_override` in `settings-tree.yaml` (`SettingDef.unitOverride`; TENANT, ENTITY or USER keys only; off for every platform key). Reads resolve ENTITY → each of `ctx.unitIds` outermost first → USER, so the innermost unit wins; writes at UNIT need the key's change role and the unit in the caller's own chain, stay tighten-only against the outer units, and go to the change history. Migration `config/0005` admits `UNIT` in the tier checks (a UNIT row belongs to one tenant). At most 8 units of 1 to 64 of `[A-Za-z0-9_-]`.
