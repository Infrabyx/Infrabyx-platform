---
"@infrabyx/seed": minor
---

A product's own roles on its seed personas (LDC-69; R1-D-325): `seedAdapters.personaRoles` (persona key → `<PRODUCT>_…` role names), also taken by `runSeed` and `generateCredentials`, are validated (`personaRoleProblems`; `IPB-SEED-003`) and seeded beside each persona's platform role in the IdP, the tenant membership and the credentials file's Role column, which `checkCredentialsFile` checks with the same roles. Guide §7fo.
