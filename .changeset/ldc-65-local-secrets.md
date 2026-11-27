---
"@infrabyx/connectors": minor
"@infrabyx/config": patch
---

LDC-65 (R1-D-299; guide §7fe): `LocalFileSecrets` (adapter `local-file`, `@infrabyx/connectors/secrets`), a SECRETS adapter backed by a 0600 JSON file (default `.infrabyx/local-secrets.json`) or by memory, for a product's local stack and tests, so `seed:credentials` runs without Vault. Refused in every `APP_ENV` but `local` and `test`, and listed unproven (off by the new `int.secrets.local_file.enabled`) so the routing check refuses it in staging and above. `config` registers the setting.
