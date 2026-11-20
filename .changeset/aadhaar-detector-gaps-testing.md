---
"@infrabyx/testing": minor
---

The no-Aadhaar sweep closes the gaps Udofin found (PR-UDF-063, R1-D-242). Stricter by default; each looser reading is opt-in.

- **Behaviour change, `infrabyx-aadhaar-scan`:** it now exits **2** (fail closed) when it reads no file at all (empty directories, only skipped directories, or every file skipped as binary, too large or a symbolic link), and when a file cannot be read (before: 0, or 1 on a read error). Exit statuses: 0 nothing found, 1 a find, 2 nothing proven (usage error, nothing read, read error). New `--help`, and `--allow e164_in,decimal` (repeatable; default none) to let those look-alikes through.
- **Behaviour change, `scanDatabaseForAadhaar`:** it reads every column of every type (numbers, arrays, `json` as written, `jsonb`, composites, `bytea` as hex and decoded), not only text-like ones, and of every table; it reports a column or JSON field named like an Aadhaar carrier (`aadhaar_number`, `uid_token`, `uid`, ...; `isAadhaarFieldName`) that holds a value as a `FIELD` find (`masked: "(value withheld)"`, `field` the JSON key path), whatever the value. It rejects with `AadhaarScanEmptyError` when it reads no table or no row (`allowEmpty: true` to pass), and with `AadhaarScanLimitError` past `maxRows` (default `AADHAAR_DB_SCAN_MAX_ROWS`, 100 000) rather than pass a partial read. Expect new finds in a suite whose database holds 12-digit numbers in numeric columns or uses a column named `uid`; skip a legitimate column with `skip: ["schema.table.column"]`.
- New `sweepDatabaseForAadhaar` returns `{ finds, tables, rows }`; `allow` on every scan option.
- A UUID is blanked only when it stands alone: digits glued to it (a letter or digit next to it, or a four-digit group joined by one space or hyphen) are read as the rule reads them.
- `TestDatabase.end()` is idempotent: a second call, later or concurrent, returns the first call's promise, so `beforeDrop` and the drop run once.
