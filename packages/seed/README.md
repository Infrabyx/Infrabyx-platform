# @infrabyx/seed

Deterministic, idempotent, synthetic-only seeds for every product, with purge and seed credentials.

**Specified by:** `docs/ipb/` — IPB-11 §11.3.D–E, §11.4.5–11.4.8; IPB-D-04. Plan: `docs/phases/PL1-plan.md` §9. Decisions PL1-D-06, PL1-D-07, PL1-D-10, PL1-D-15.

## Commands

```sh
infrabyx-seed --profile dev [--modules dist/seed/index.js]   # products alias as: pnpm seed --profile dev
infrabyx-seed purge --profile demo [--db <owner url>]        # pnpm seed:purge
infrabyx-seed credentials --adapters dist/seed/adapters.js [--rotate] [--no-file]   # pnpm seed:credentials
```

- **Refusal first** (IPB-11-14, IPB-11-22): in `prod`, `dr` and `pre-prod`, or without `SEED_ENABLED=true`, every command exits 1 with `IPB-SEED-001` and emits `in.<product>.seed.SeedRefused.v1` before reading any other configuration. The `load` profile also needs `SEED_LOAD_CONFIRM=yes` (`IPB-SEED-002`).
- Configuration comes from `seedEnvSchema` (`APP_ENV`, `APP_PRODUCT`, `DB_URL`, `DB_PASSWORD`, `SEED_*`) through `@infrabyx/config`.

## Framework

- `defineSeedModule({ module, profiles, dependsOn, run(ctx) })`; `ctx.write(tenant, async (w) => w.upsert({ table, key, values, id }))`. Each `write` is one kernel transaction with one ledger entry (`seed.module.apply`).
- **Deterministic** (IPB-11-23): faker `en_IN` seeded from `SEED_RANDOM_SEED` and the module name; IDs are `deterministicId(prefix, table, JCS(natural key))` with a fixed time component, never the clock.
- **Idempotent** (IPB-11-24): upsert on the natural key; the report shows `inserted / updated / unchanged`, and a re-run is `0 / 0 / N`.
- **Tracked** (IPB-11-31): every inserted row is recorded in `seed.seed_row` (profile, run, table, key). `purgeSeed()` deletes exactly those rows, newest first, in one transaction, and ledgers the purge.
- The platform module seeds `tnt_platform`, `tnt_demo` ("Demo Co"), `tnt_sandbox`; every persona as a user with its membership; and an explicit OFF for each switchable `fut.*` flag (IPB-11-29, PL1-D-10). Settings stay at registry defaults.

## Synthetic identifiers (IPB-11-25)

Every upserted value passes `findRealIdentifiers()`, or the write fails with `IPB-SEED-004`.

| Identifier   | Generator (`synthetic.*`)                                     | Rule checked                                              |
| ------------ | ------------------------------------------------------------- | --------------------------------------------------------- |
| Aadhaar-like | `9999 xxxx xxxx`, check digit chosen to **fail** Verhoeff     | starts `9999` and fails Verhoeff                          |
| PAN-like     | `ZZZZ[A-Z][0-9]{4}Z` (PL1-D-07)                               | fourth character `Z`                                      |
| GSTIN-like   | state 27 + synthetic PAN + `1Z` + a **wrong** check character | checksum must not validate                                |
| CIN-like     | `U…ZZ<year>PTC…`                                              | state code `ZZ`                                           |
| IFSC         | `TEST0` + 6 digits                                            | starts `TEST0`                                            |
| Mobile       | `+91 99999 0xxxx`                                             | that range only                                           |
| Email        | `@<product>.test` (RFC 2606)                                  | `.test` domain; only the super admin keeps a real address |

## Personas and credentials

- `personasFor(product)`: the common personas of IPB-11 §11.4.5 (super admin as `PLT_SUPER_ADMIN` in `tnt_platform`, MFA always; its address is `AUTH_SUPER_ADMIN_EMAIL`, set only in each product repository's local environment, with the placeholder `super.admin@example.test` when unset) plus `personas/<product>.ts`. Emails: `test.<persona>@<lawdocs|ldc|equator|finbyx|udofin|ophub>.test` (IPB-11-33).
- `generateCredentials()` (IPB-11-35 to 39, §11.4.7): passwords from `@infrabyx/crypto` `generateSeedPassword()`, unique within the file and across products (salted hash list in the vault), written to the seed vault through SECRETS before anything else (`IPB-SEED-006` and no file on failure), set on the IdP through IDENTITY (temporary + MFA in staging/demo), `SEED_CREDENTIALS.md` in the §11.4.6 template with mode 0600 and an entry in `.git/info/exclude`, exactly one stdout line, and `CredentialsGenerated` with counts only. Agents and services are listed without passwords. Refused in prod, dr and pre-prod. `checkCredentialsFile()` cross-checks the file against the personas (IPB-11-27, `IPB-SEED-003`).
- In PL1 the SECRETS and IDENTITY adapters are supplied by the product (`--adapters`); Keycloak and Vault adapters arrive in PL2.

## Repository hooks

`lefthook.yml` (repository root) blocks `.env*` other than `.env.example` and `SEED_CREDENTIALS.md` at commit time and runs gitleaks on staged content (IPB-11-09). Install with `pnpm exec lefthook install`.

## Migrations

`migrations/0001_init.sql`: schema `seed` with `seed_run`, `seed_row`, `outbox`.
