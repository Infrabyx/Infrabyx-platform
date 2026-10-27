---
"@infrabyx/seed": minor
---

The super-admin address is configuration: `AUTH_SUPER_ADMIN_EMAIL` (optional) sets it, and without it the persona uses the placeholder `super.admin@example.test`; no personal address ships in the package any more. `personasFor(product, superAdminEmail?)`, `RunSeedOptions.superAdminEmail`, `CredentialsOptions.superAdminEmail` and `checkCredentialsFile(text, product, superAdminEmail?)` carry it, and `findRealIdentifiers` takes the allowed address as a third argument. Products set `AUTH_SUPER_ADMIN_EMAIL` in their local environment (PL2-D-63).
