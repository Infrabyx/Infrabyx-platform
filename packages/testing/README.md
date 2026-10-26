# @infrabyx/testing

The test kit every product installs as a devDependency: a PostgreSQL test database with the platform migrations, context builders, port fakes, the NN pattern suites, the port contract harness, `migration-lint`, the acceptance-test report and the IPB ESLint plugin.

**Specified by:** `docs/ipb/` — IPB-01 §01.4.2, IPB-01-15 (port contracts), IPB-09-31 and §09.4.6.2–3 (migration lint), IPB-14 §14.5 item 4 (NN suites). Plan: `docs/phases/PL1-plan.md` §10. Decisions PL1-D-02 (D-05: lint rules published here), PL1-D-04 (NN tags).

## Database

`startPostgres({ migrations? })` creates a fresh database, applies the platform migrations (tenancy → audit → config → seed → connectors) then the product's, and returns `{ pool, admin, kernel, audit, end }`. With `IPB_TEST_PG_URL` set (CI's `postgres:18` service) it uses that server; otherwise it starts a `postgres:18` container through Testcontainers. `APP_ENV` defaults to `test`.

## NN pattern suites (IPB-14 §14.5 item 4)

| Suite                                                      | Tag             | Checks                                                                                                                                                                              |
| ---------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `describeTenantIsolation({ table, insert, select })`       | `@NN-01`        | crafted ID from another tenant returns nothing; tenant switch inside a transaction refused; no rows without `SET LOCAL`; RLS enabled, forced, tenant-scoped; security-invoker views |
| `describeAuditChain({ mutate })`                           | `@NN-45 @NN-02` | every mutation leaves chained entries in the same transaction; a mutation without an entry is refused (`IPB-MOD-003`); history cannot be edited and tampering is detected           |
| `describeMakerChecker({ request, maker, checker, agent })` | `@NN-18`        | maker ≠ checker (`IPB-SEC-007`); agents cannot check (`IPB-SEC-004`); the delay window holds (`IPB-SEC-008`)                                                                        |
| `describeLockedActions({ actions, agent })`                | `@IPB-02-10`    | approve/sign/disburse/delete/grant refused for `AGT_*`                                                                                                                              |
| `describeSeedRefusal({ entrypoint })`                      | `@IPB-11-14`    | prod, dr and pre-prod refuse seeds                                                                                                                                                  |

## Port contract harness (IPB-01-15)

`defineContractSuite("STORAGE", () => new S3Storage(...))` runs the common conventions (descriptor, `health()`), the built-in cases for that port (SECRETS versions, KMS round-trip and signatures, STORAGE write-once retention and `IPB-STOR-003`, FEATURE_FLAG defaults and snapshot) and any adapter-specific cases. Fakes: `MemorySecrets`, `fakeKms()` (LocalKms), `MemoryStorage`, `MemoryFlagProvider`, `MemoryIdentity`.

PL2 additions (plan §3.11, §7):

- `defineContractSuite(port, factory, cases, { leg })` takes the leg: `unit`, `hermetic` or `sandbox`. It checks that an adapter's residency can carry its own maximum class. A case that names a `method` the adapter declares `unsupported` must throw `IPB-PORT-001` with `meta.reason: "unsupported"` (PL2-D-21).
- `startService(name, opts)` starts a pinned image from `TEST_IMAGES` (digests in `infra/docker/TEST_IMAGES.md`), or reuses the service named by `IPB_TEST_<NAME>_URL`.
- `sandboxLeg(adapter, names)` reads `IPB_TEST_SANDBOX_<NAME>` variables. It skips the leg when they are absent, and fails instead when `IPB_TEST_SANDBOX_REQUIRED=true` (nightly, pre-release; IPB-DEV-04). It names missing variables only, never values.
- `startFaultProxy(target, plan)` injects failures or delay in front of a stub or vendor sandbox (`@IPB-01-AT-08`).
- The ESLint rule `ipb/port-data-class` refuses a port call whose literal `dataClass` is below the port default, and a port payload schema field without a data-class annotation (PL2-D-03).

## migration-lint (IPB-09-31)

`infrabyx-migration-lint <migrations dir>... [--contract-label] [--record-checksums]` parses every `NNNN_*.sql` with the real PostgreSQL 18 parser (`libpg-query`) and applies every rule of IPB-09 §09.4.6.2 (`ext-whitelist`, `no-engine-specific`, `rls-required`, `data-class-tag`, `index-concurrently`, `no-expand-contract-same-release`, `not-null-two-step`, `fk-not-valid`, `lock-timeout-set`, `no-data-in-ddl`, `rename-forbidden`, `type-change-forbidden`, `drop-requires-contract-label`, `checksum-immutable`, `audit-ledger-untouched`, `object-lock-untouched`) and every forbidden operation of §09.4.6.3 (`forbidden`, no override). Findings carry `IPB-ENG-004`, `IPB-ENG-005` (edited released file, from `checksums.json`), `IPB-DB-001` (extension) or `IPB-DB-002` (engine-specific). A file that must run outside a transaction (`CREATE INDEX CONCURRENTLY`) starts with `-- infrabyx:no-transaction`. `--record-checksums` adds new files to `checksums.json`; existing entries are never rewritten.

## Other tools

- `infrabyx-at-report [--root .] [--spec docs/ipb] [--results vitest.json]`: every `@IPB-nn-AT-nn` / `@NN-nn` tag found in tests, its result, and the spec ATs with no test yet (report only).
- `@infrabyx/testing/eslint`: the IPB ESLint plugin (`ipb/vendor-import`, `ipb/schema-boundary`, `ipb/no-process-env`, `ipb/no-direct-crypto`) for product `eslint.config.mjs` files; rule tests in `eslint/rules.test.mjs`.
