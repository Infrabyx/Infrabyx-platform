# @infrabyx/tenancy

Tenant context, the transaction kernel, RLS tooling, outbox/inbox, the maker-checker engine, break-glass, impersonation, field encryption and masking.

**Specified by:** `docs/ipb/` — IPB-02 §02.3.A–B, §02.4.2, §02.4.3, §02.4.6.1; IPB-01 §01.3.D, §01.4.3, §01.4.6. Plan: `docs/phases/PL1-plan.md` §7. Decisions PL1-D-02, PL1-D-13, PL1-D-14.

## Context and kernel

- `contextFromClaims(verifiedClaims)` is the only way to build a context: tenant, entity, principal, `act` (impersonation), `bg` (break-glass). Headers, query and body are never read (IPB-02-13). A platform context (`scope: "platform"`) needs a `PLT_*` role and a non-agent principal.
- `new PgKernel({ pool })` implements `MutationKernel`. Each transaction runs `SET LOCAL ROLE app_rw` and sets `app.tenant_id`, `app.entity_id`, `app.actor_id`, `app.trace_id`, `app.scope` with `set_config(…, true)`. Callbacks may not run session-level `SET`/`RESET`, role switches, `app.*` writes, `session_replication_role` or transaction control.
- `mutate()` refuses writes during impersonation (`IPB-SEC-003`), refuses `approve`/`sign`/`disburse`/`delete`/`grant` for agents (`IPB-SEC-004`), checks a break-glass grant is active (`IPB-SEC-009`), and fails the commit with `IPB-MOD-003` unless the audit ledger was written in the transaction.
- `PgOutbox.publish(tx, schema, { envelope })` and `PgInbox.firstSeen(tx, schema, consumer, eventId)` (IPB-01 §01.4.3.3).
- `TenantSweep` (`migrations/0005`, `SVC_TENANT_SWEEP`): list the tenants with a ledgered read and run a scheduled job once per tenant in its own context (`docs/product-guide.md` §7c).

## Approvals, break-glass, impersonation

- `ApprovalsEngine` implements `ApprovalGateway`: `request` (inside the caller's mutation), `decide`, `execute`, `cancel`, `register(action, { checkerRoles, execute, delayMinutes })`. Risk classes per IPB-02 §02.4.6.1: R4 waits ≥ 60 min, R5 ≥ 72 h, tenant delete needs two checkers and 7 days. Checker ≠ maker in code (`IPB-SEC-007`) and in the database (composite FK + CHECK). Agents never check. Executing inside the window fails `IPB-SEC-008`. CONFIDENTIAL/REGULATED payloads are stored field-encrypted.
- `BreakGlass`: request by `PLT_SUPER_ADMIN`, approval by a second `PLT_SUPER_ADMIN` or `PLT_SECURITY_OFFICER` (`IPB-SEC-009` on self-approval), ≤ 4 h, review ticket reference, `BreakGlassGranted` alert event.
- `Impersonation`: `PLT_SUPER_ADMIN`, ticket reference, ≤ 60 min, ledgered in the target tenant and listed for its `ORG_OWNER`.

## Data protection

- `FieldCrypto.encryptField(tenantId, class, plaintext, { table, column, rowId })` / `decryptField` — envelope encryption with per-tenant KMS keys from `@infrabyx/crypto` (IPB-02-20).
- `mask(field, value)` from `mask.rules.json`, shared with `packages/ui/mask`.

## Tools

- `infrabyx-migrate --db <url> [--dir migrations --name <product>]` (`@infrabyx/tenancy/migrate`): applies tenancy → audit → config → seed → connectors migrations (each only when the package is installed), then the product's; SHA-256 checksums in `meta.migration_checksums`; an edited released file fails `IPB-ENG-005`. A file whose first line is `-- infrabyx:no-transaction` runs outside a transaction (for `CREATE INDEX CONCURRENTLY`).
- `infrabyx-rls-lint --db <url>` (`@infrabyx/tenancy/rls-lint`): RLS enabled and forced with an `app.tenant_id` policy on every tenant table, security-invoker views, no `auth.*` policies, no `BYPASSRLS`/`SUPERUSER` roles, no unlisted `SECURITY DEFINER` function executable by `app_rw`/`app_ro`. `assertManifestsRls()` is the boot check (`IPB-MOD-001`).
- `@infrabyx/tenancy/drizzle`: `tenantIdColumn()`, `rlsPolicySql()`, `dataClassCommentsSql()` (drizzle-orm optional peer).
- `@infrabyx/tenancy/nest`: `TenantContextInterceptor` reading `request.verifiedClaims` (`@nestjs/common` optional peer).

## Migrations

`migrations/0001_init.sql`: roles `app_rw`, `app_ro`, `app_migrate` (NOLOGIN, never BYPASSRLS), schema `tenancy` with `tenant`, `legal_entity`, `user`, `membership`, `approval_request`, `approval_decision`, `breakglass_grant`, `impersonation_session`, `outbox`, `inbox`, all with RLS enabled and forced, and the allow-listed definer function `tenancy.breakglass_active`.

Integration tests (`pnpm test:int`) need `IPB_TEST_PG_URL` pointing at a PostgreSQL 16+ server; each run creates and drops its own database.
