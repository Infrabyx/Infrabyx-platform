---
"@infrabyx/hlp": minor
---

PL5 session 7: the platform help registry ships with the package (`registry/<module>.yaml`, `PLATFORM_REGISTRY_DIR`, `@infrabyx/hlp/registry/*`), with an entry for every help key the platform packages use. `hlp-lint` now counts only quoted `hlp.*` literals in code (expressions such as `v.help` and comment lines are not keys) and `help_key:`/`help:` fields in YAML and JSON, skips generated files and quoted key prefixes ending in a dot (`"hlp.web.field."`).
