# LDC-69 — a product's own roles on its seed personas (plan, 28 Nov 2026; R1-D-325)

**Request (ComplyCl, forwarded by the owner 28 Nov 2026 12:45 IST):** the product roles in the persona file, so a product's seed personas carry its own roles. Plan, contract cases, a minor.

## Today

`@infrabyx/seed` defines each product's personas in `personas/<product>.ts` with one `role` each, mostly platform roles (`ORG_OWNER`, `ORG_MAKER`). A product's own roles (its RBAC) are known only to the product, so its seeded users cannot exercise them.

## Change (`seed` and `testing` minors; no migration, no setting, no environment variable)

1. **`Persona.productRoles`** and **`PersonaRoles`** (persona key → the product's own role names). The product exports them from the module it already passes to `--adapters` (`seedAdapters.personaRoles`). The platform holds no product's role list.
2. **Validation, before anything is written** (`personaRoleProblems`; refused with `IPB-SEED-003`, the personas-file code):
   - a role must be named `<PRODUCT>_<NAME>`, so `ORG_`, `PLT_` and other products' roles are refused (a product role never widens a platform role);
   - a known persona key only, never a platform-tenant persona;
   - at most 8 roles per persona, with no repeats.
3. **Carried end to end:** `personaRolesOf(p)` is the platform role, then the product roles.
   - the IdP (`provisionUser` roles);
   - `tenancy.membership.roles`;
   - the credentials file's Role column (`ORG_OWNER, LDC_…`), which `checkCredentialsFile` checks with the same `personaRoles`.
4. **Contract cases** (`testing` `seedPersonaRoleContractCases(product, personaRoles)`), run by the product on its own roles:
   - the roles are accepted;
   - each persona is seeded with its roles in order;
   - a credentials run provisions exactly those roles and lists them, and the file stops matching without them;
   - wrong prefixes, `ORG_`, `PLT_`, a platform persona, an unknown persona and more than 8 roles are each refused.

## Exit

- The platform leg runs the cases for LDC and FBX on synthetic role names.
- The seed and testing suites pass.
- Guide §7fo; threat model §3.205; owner question #227 (the reading of "the persona file").
