---
"@infrabyx/testing": patch
---

`startPostgres` migrates each fresh database under a server-wide advisory lock (`infrabyx:test-migrate`), so parallel test databases on one server never interleave their migrations. Roles are cluster-wide, and `tenancy/0003` grants `app_ro` a role that `0004` revokes: a test checking role grants could otherwise see another database's half-applied migration (R1-D-31).
