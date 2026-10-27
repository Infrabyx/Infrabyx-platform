---
"@infrabyx/tenancy": minor
---

PL6 session 2: `infrabyx-migrate --db-file <path>` reads the database URL from the first line of a file, so the `infrabyx-app` chart's migration job takes it from the secrets CSI mount and the password never appears in arguments or the environment (IPB-02-28). `--db` still works; passing both is refused.
