---
"@infrabyx/testing": minor
---

LDC-67 (R1-D-298; guide §7fd): `startPostgres` migrates once per server and migration set into a template database (`tpl_<hash>`, built under the existing lock, marked a template only once complete) and copies it per call with `CREATE DATABASE … TEMPLATE`: the same schema and isolation, about seven times faster per database. On by default on a shared server (`IPB_TEST_PG_URL`); `template: false` migrates the database itself. New `templateDatabaseName` and `TestDatabase.template`.
