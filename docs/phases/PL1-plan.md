# PL1 — Core kernel

**Phase:** PL1 (IPB-14 §14.3) · **Packages:** `contracts`, `config`, `tenancy`, `audit`, `crypto`, `seed`, `testing` · **Plus:** RLS lint, migration lint, NN pattern tests
**Date:** 2026-10-26 · **Branch:** `claude/funny-cori-6upyrr` (plan only)
**IPB files read in full for this plan:** IPB-01, IPB-02, IPB-07, IPB-11. Also read for interfaces: IPB-09 §09.3–09.4 (flags, migration lint, ATs), IPB-10 (error and event envelope rows), IPB-12 (crypto-provider, `fut.*` register), Ecosystem Spec v1.2 §3.2, §3.12, §4.1, §5.1.
**Owner approval:** _pending_. Nothing in this file is implemented until approved. Section 13 lists the decisions I need; section 14 lists cryptography choices, which are on the CLAUDE.md locked list and need explicit approval.

---

## 1. Scope and what PL1 is not

PL1 builds the kernel every other package and every product depends on: the shared vocabulary (`contracts`), configuration and settings (`config`), tenant isolation and the transaction kernel (`tenancy`), the hash-chained ledger (`audit`), the single cryptography call-site (`crypto`), seeds and seed credentials (`seed`), and the reusable test harness (`testing`).

Out of PL1, by IPB-14 §14.3:

- Real vendor adapters (Keycloak, Cerbos, S3, AWS KMS, Secrets Manager, Unleash, OTel). PL1 defines their **ports** where the kernel needs them and ships **in-memory or local fakes** only. Reference adapters are PL2.
- `provider_routing` runtime, circuit breakers, failover (PL2).
- Temporal-backed approvals, SLAs, Work Inbox (PL3 `workflow`).
- NestJS and Next.js apps (`apps/reference`, PL5–PL6). PL1 ships framework-agnostic code plus thin NestJS adapters as optional subpath exports (decision D-07).

## 2. Package dependency order

```
contracts  (Zod only)
   ├── crypto        (node:crypto; contracts)
   ├── config        (contracts, crypto)            env loader, guards, settings registry, flags
   ├── tenancy       (contracts, crypto, config)    context, RLS, transaction kernel, outbox, approvals, migrate
   ├── audit         (contracts, crypto, tenancy)   ledger, chain, anchors, verifier
   ├── seed          (contracts, crypto, config, tenancy, audit)
   └── testing       (all of the above; devDependency of products)
```

Implementation and commit order follows the arrows: one package per commit, one Changeset per package (CLAUDE.md). `packages/*` never import from `apps/*` (IPB-01 §01.4.2).

## 3. Cross-cutting design (applies to every PL1 package)

### 3.1 Database, schemas and migrations

- **Module = schema** (IPB-01-09): `tenancy`, `audit`, `config`, `seed` schemas, plus `meta` for migration checksums (IPB-01 §01.4.6). Cross-schema FKs only to `tenancy.tenant` and `tenancy.user` (IPB-01 §01.4.3.1).
- **IDs:** prefix + ULID (`tnt_`, `ent_`, `usr_`, `apr_`, `led_`, `anc_`, `run_`, `set_`, `bgr_`, `imp_`). Ecosystem Spec §5.1 and IPB-01 §01.4.6. Generated in `@infrabyx/crypto` (randomness is a crypto concern, IPB-12-05).
- **Time:** `timestamptz`, UTC in the application (IPB-01 §01.4.6).
- **Roles:** `app_rw`, `app_migrate`, `app_ro`; no `BYPASSRLS`, ever (IPB-01 §01.4.6, IPB-02-12). Created by the bootstrap migration. (IPB-11's example `app_migrator` is treated as a typo: decision D-14.)
- **Data-class tags** (IPB-02-19): a Drizzle helper `.$dataClass('REGULATED')` emits `COMMENT ON COLUMN … IS 'dataclass:REGULATED'`, so both migration lint and catalog checks can read the class from SQL. Every PL1 column is tagged.
- **Packaging migrations in a library** (decision D-04): each package ships forward-only SQL migrations in `migrations/` with a Drizzle schema; `@infrabyx/tenancy/migrate` applies platform migrations in dependency order before the product's own, records SHA-256 checksums in `meta.migration_checksums`, and refuses an edited released file (IPB-01-24, IPB-09-32).
- **Extensions:** only `pgcrypto` and `citext` in PL1 (whitelist IPB-01-22).
- **Tests run against real PostgreSQL 18** via Testcontainers in CI (IPB-01 §01.4.10 `test`). This cloud session has a Docker client but no daemon, so local runs use a PostgreSQL 18 binary installed in the session; CI is authoritative.

### 3.2 Transaction kernel (the IPB "every mutation writes the ledger in the same transaction" rule)

```ts
await kernel.mutate(ctx, async (tx) => {
  const row = await tx.insert(...);                    // RLS-subject: SET LOCAL app.tenant_id already applied
  await audit.record(tx, { action: 'cases.case.create', resource: row.id, before: null, after: row });
  await outbox.publish(tx, event('in.<product>.cases.CaseFiled.v1', ...));
});
```

`kernel.mutate` (in `tenancy`) opens the transaction, applies `SET LOCAL app.tenant_id / app.actor_id / app.trace_id` from the verified context, runs the callback, and **fails the commit if no ledger entry was written** for a mutating callback. That last check turns IPB-02-51 from a convention into an invariant.

### 3.3 Errors and events

- Errors are `PortError` / `IpbError` with codes from a single catalogue in `contracts/errors` and an RFC 9457 serializer (IPB-10-04, IPB-02-48). Products re-export as `<PRODUCT>-AREA-NNN` (IPB-01 §01.6.3).
- Two envelopes in `contracts/events`, because the specs differ and both are binding in their own scope (decision D-13):
  - **Internal** `in.<product>.<module>.<Event>.v<n>`: IPB-10-37 (ULID `id`, `source=/infrabyx/<product>/<module>`).
  - **Ecosystem** `in.infrabyx.<domain>.<Event>.v<major>`: Spec §3.2 (UUIDv7 `id`, `source=urn:infrabyx:<product>:<tenantid>`, `reid`, `consentref|legalbasis`, `dataclass`, `seq`). The Spec prevails for cross-product contracts.

### 3.4 Test convention

Vitest only; no Cucumber runtime. Each acceptance test is a `describe('@IPB-nn-AT-xx <feature>')` block, so `pnpm ipb:at-report` can list which ATs exist and pass. Unit tests sit beside code; DB tests in `src/**/*.int.test.ts` run in a separate `test:int` task against Testcontainers.

---

## 4. `@infrabyx/contracts` (IPB-01, IPB-10)

**Rule:** zero runtime dependencies beyond Zod (IPB-01 §01.4.2).

**Public interface (subpath exports):**

| Export                           | Contents                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@infrabyx/contracts/data-class` | `DataClass` (PUBLIC…SECRET), Spec §13.2 field-class → tier map (IPB-02 §02.4.3.1), `Residency` (`IN`, `IN-ZR`, `GLOBAL`), default residency policy (IPB-01 §01.4.5)                                                                                                                                                                                                                           |
| `@infrabyx/contracts/ids`        | `IdPrefix` registry and `idSchema(prefix)` Zod validator (format only; generation in `crypto`)                                                                                                                                                                                                                                                                                                |
| `@infrabyx/contracts/env`        | `AppEnv` enum (9 environments, IPB-09-15) and guard groups (IPB-11 §11.2)                                                                                                                                                                                                                                                                                                                     |
| `@infrabyx/contracts/roles`      | Role enum assembled from the IPB files (`PLT_*`, `ORG_*`, `OPS_*`, `AGT_*`, `SVC_*`); `isAgent()`. **[VERIFY: brief §3 role list, decision D-10]**                                                                                                                                                                                                                                            |
| `@infrabyx/contracts/tiers`      | Settings tiers PLATFORM, PLAN, BRAND, TENANT, ENTITY, USER and precedence (IPB-07-38); risk classes R0–R5 (IPB-02 §02.4.6.1)                                                                                                                                                                                                                                                                  |
| `@infrabyx/contracts/errors`     | `IpbError`, `PortError`, code catalogue for every code in IPB-01 §01.6.3, IPB-02 §02.6.3, IPB-07 §07.6.3, IPB-11 §11.6 (with D-03 resolution), `toProblem()` RFC 9457 shape                                                                                                                                                                                                                   |
| `@infrabyx/contracts/events`     | Internal and Ecosystem CloudEvents envelope schemas, type-grammar validators, the PL1 internal event schemas (SettingChanged, UserPreferenceChanged, ScheduledAction*, Approval*, BreakGlass*, Impersonation*, LedgerAnchorWritten, LedgerChainBroken, KillSwitchChanged, ConfigValidated, ConfigGuardFailed, Seed*)                                                                          |
| `@infrabyx/contracts/modules`    | `defineModule()` and the manifest Zod schema (IPB-01 §01.4.3.2)                                                                                                                                                                                                                                                                                                                               |
| `@infrabyx/contracts/ports`      | Common port conventions (`health()`, residency, `maxDataClass`, `idempotencyKey`), the port catalogue as metadata (name, tier, config prefix, owner file), and full interfaces for the ports PL1 consumes: `SECRETS`, `KMS`, `STORAGE` (anchor writes), `FEATURE_FLAG` (OpenFeature-shaped), `IDENTITY` (token-claims types only). Other interfaces land with their adapters (decision D-02). |

**Data model / migrations:** none.

**Tests:** schema round-trips; envelope fixtures from IPB-10 §10.4.9.1 and Spec §3.2 validate; event-type grammar accepts and rejects examples; error catalogue has unique codes and every code has an HTTP status or `boot`/`exit`/`ci`; `@IPB-01-AT-16` (manifest schema part).

**Stubs:** none. **Changeset:** minor (`0.1.0`).

---

## 5. `@infrabyx/crypto` (IPB-02 §02.4.3.2, IPB-12-05, IPB-12 §12.6 item 1)

**Rule:** the only cryptography call-site. Node built-in `node:crypto` only; no third-party crypto libraries (decision C-09).

**Public interface:**

- `hash(alg, bytes)`, `hmac(keyRef, bytes)`, `randomBytes(n)`, `newId(prefix)` (ULID), `deterministicId(prefix, namespace, naturalKey)` (seeds).
- `aead.encrypt / decrypt` and envelope helpers: `sealField({ tenantId, dataKey, plaintext, aad }) → { ciphertext, keyId, alg }` and its inverse.
- `blindIndex(keyRef, normalisedValue)`.
- `sign / verify` via the `KMS` port, recording `alg`, `key_id`, `created_at`, `cert_chain_ref` on every signature record (IPB-01 KMS port, IPB-12-05).
- **Algorithm registry** (`registry.ts`): each algorithm's id, purpose, status (`approved`, `deprecated`, `planned`), and the `crypto.pqc.sign_hybrid` slot. **CBOM export** (`pnpm crypto:cbom`, CycloneDX) behind `fut.cbom-export`, OFF by default (IPB-12 §12.5).
- `generateSeedPassword()` implementing IPB-11 §11.4.7 (rejection sampling, class coverage, no substrings).
- `LocalKms` fake (software keys from `dev-keys.json`) for `local`/`dev`/`test`. Its key fingerprints are published so `config` guards can refuse them in prod (IPB-11-17).

**Lint:** new ESLint rule `ipb/no-direct-crypto`: no `node:crypto`/`crypto` imports, `createHash`, `createSign`, `createHmac`, `subtle.*` outside `packages/crypto` (IPB-12-05, `@IPB-12-AT-03`).

**Data model / migrations:** none (keys live in KMS; ciphertext columns belong to the owning table).

**Tests:** known-answer vectors for SHA-256, HMAC-SHA-256 and AES-256-GCM; tamper (tag, AAD, nonce) fails decrypt; nonce uniqueness over 1 M encryptions; password rule property tests (length ≥ 24, classes, uniqueness, no modulo bias χ² check); deterministic IDs stable across runs; `@IPB-12-AT-03`.

**Stubs:** `LocalKms` only; AWS KMS, Vault Transit etc. are PL2. **Changeset:** minor.

---

## 6. `@infrabyx/config` (IPB-07 §07.3.3, §07.4.2, §07.5; IPB-11 §11.3–11.4; IPB-09-24; IPB-12-01)

### 6.1 Environment loader and guards (IPB-11)

- `envVar(schema, meta)`, `secretRef(meta)`, `loadAndValidate(schema)`. On failure it prints variable names and reasons only, never values, and exits **78** (IPB-11-02).
- `guards.ts`: table-driven guards IPB-11-14 to IPB-11-20 (NODE_ENV, seed vars, literal secrets, forbidden hosts, known dev values including `LocalKms` fingerprints, https and host-map match, `DB_SSL_MODE=verify-full`, India regions for AI adapters), plus IPB-01's `supabase-guard` (no `*.supabase.co` host in `staging`/`pre-prod`/`prod`). Guard groups follow IPB-11 §11.2 (`pre-prod` gets prod rules; `demo` gets staging rules).
- `secret://` resolution through the `SECRETS` port (fakes: `env` for local, in-memory for tests). Unresolvable → exit 78.
- `redact.ts`: redaction map derived from the schema's `sens: 'S'` (IPB-11-07).
- `config.guard.passed=true` boot log line with check names (IPB-11-21).
- CLI `infrabyx-env example [--check]`: generates `.env.example` from a schema and fails CI on drift (IPB-11-03, `@IPB-11-AT-06`).
- `no-process-env` already enforced by `ipb/no-process-env` (PL0); `packages/config` is the only exempt package (IPB-01-19, IPB-11-01).

### 6.2 Settings registry and resolution (IPB-07)

- **Source of truth:** `settings-tree.yaml`, with the 20 binding nodes in order, the console-only nodes, and per key: tier, type, default, floor/ceiling, `locked`, `allow_user_override`, `tighten_only` (security/privacy), who may change, maker-checker, help key. A generator emits `registry.ts` so `settings.get('ux.density')` is typed and an unknown key **fails typecheck** (IPB-01 §01.5), and also throws `IPB-UX-007` at runtime (`@IPB-07-AT-05`). Decision D-12 covers the YAML-plus-generated-TS split.
- **Keys registered in PL1:** every key in IPB-01 §01.5, IPB-02 §02.5, IPB-07 §07.5 and IPB-11 §11.5, plus the IPB-12 §12.5 `fut.*` flags and all `kill.*` switches. Keys owned by later phases are registered by those phases (decision D-11).
- **Resolution:** PLATFORM floor/ceiling → PLAN → BRAND → TENANT → ENTITY → USER (IPB-07-38). A lower tier may only tighten `tighten_only` keys (`IPB-UX-008`). Locked keys refuse writes (`IPB-SEC-020`, IPB-02-86).
- **Writes:** `settings.set(ctx, key, value)` goes through `kernel.mutate`, so it writes the ledger and `SettingChanged` (or `UserPreferenceChanged`) in the same transaction (IPB-07-39). Keys marked maker-checker create an approval request instead (`IPB-SEC-006`, `@IPB-07-AT-06`).

### 6.3 Flags (IPB-09-24, IPB-02-83, IPB-12-01)

- `flags.ts` registry with owner, created date, expiry, default and description, plus taxonomy validation (`mod.`, `exp.`, `ops.`, `kill.`, `fut.`); expiry rules per IPB-09-25.
- `FEATURE_FLAG` port fakes: file provider and DB-backed provider (the IPB-01 fallback alternative). Unleash is PL2.
- **Safe state:** when the provider is unreachable and the snapshot is older than 24 h, `kill.*` evaluates **on** (`@IPB-02-AT-20`, `@IPB-09-AT-10`).

### 6.4 Data model (schema `config`)

| Table                            | Columns (data class)                                                                                                                                                                                                        | RLS                                                                                                                                     |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `config.setting_value`           | `id set_` · `key` (INTERNAL) · `tier` · `scope_id` (tenant/entity/user/plan/brand id, INTERNAL) · `tenant_id` nullable · `value jsonb` (class per key; REGULATED keys refused) · `version int` · `updated_at`, `updated_by` | ENABLE + FORCE; tenant rows by `app.tenant_id`; PLATFORM/PLAN/BRAND rows readable, writable only by `app_migrate` or a platform context |
| `config.flag_snapshot`           | `flag_key`, `value jsonb`, `fetched_at`                                                                                                                                                                                     | platform (no tenant data)                                                                                                               |
| `config.outbox` / `config.inbox` | per IPB-01 §01.4.3.3                                                                                                                                                                                                        | ENABLE + FORCE                                                                                                                          |

Migration `config/0001_init.sql` is expand-only.

**Tests:** `@IPB-11-AT-01` (all four scenarios), `@IPB-11-AT-06`, `@IPB-11-AT-07`, `@IPB-01-AT-12` (supabase-guard scenario), `@IPB-07-AT-04` (tree order and names, data level; the UI part is PL5), `@IPB-07-AT-05`, `@IPB-07-AT-06`, `@IPB-02-AT-20`, `@IPB-09-AT-09` (unregistered flag), `@IPB-09-AT-10`, `@IPB-12-AT-01` (flag snapshot equals §12.5), scope-precedence unit tests, redaction test (IPB-11-07).

**Stubs:** SECRETS resolution against real stores (PL2); Unleash (PL2). **Changeset:** minor.

---

## 7. `@infrabyx/tenancy` (IPB-02 §02.3.A–B, §02.4.2; IPB-01 §01.3.D, §01.4.3, §01.4.6)

### 7.1 Public interface

- **Context:** `TenantContext` on `AsyncLocalStorage` with `tenantId`, `entityId`, `principal` (id, type user/service/agent/breakglass, roles, `productScope`), `act` (RFC 8693 actor, set during impersonation), `bg` (break-glass), `traceId`. Built only from a verified token (claims type from `contracts/ports/identity`), **never** from a header, query or body (IPB-02-13).
- **Transaction kernel:** `kernel.mutate(ctx, fn)` and `kernel.read(ctx, fn)` (§3.2): `SET LOCAL` only, never session-level (IPB-01 §01.4.6). A mutation guard refuses any write when `act` is present (`IPB-SEC-003`) or when an `AGT_*` principal attempts approve/sign/disburse/delete/grant (`IPB-SEC-004`, IPB-02-10).
- **Drizzle helpers:** `tenantTable()` (adds `tenant_id`, FK to `tenancy.tenant`), `.$dataClass()`, and `rlsPolicySql(table)` emitting `ENABLE` + `FORCE` + `USING / WITH CHECK (tenant_id = current_setting('app.tenant_id', true))`.
- **Outbox / inbox:** `outbox.publish(tx, envelope)`, `inbox.seen(tx, consumer, eventId)` (IPB-01 §01.4.3.3). The dispatcher itself lives in the product worker.
- **Approvals engine** (IPB-02 §02.4.2 places it in `packages/tenancy/approvals`; decision D-01): `approvals.request(ctx, action, payload, riskClass)`, `approvals.decide(ctx, id, decision)`, `approvals.execute(ctx, id)`, `approvals.cancel(ctx, id)`. Enforces checker ≠ maker (DB CHECK and code), no `AGT_*` checker, two checkers for tenant delete, delay windows (R4 ≥ 60 min, R5 ≥ 72 h, tenant delete 168 h; `IPB-SEC-008`), and emits Approval* events. PL3 `workflow` adds Temporal timers, SLAs and Work Inbox on top.
- **Break-glass and impersonation** (IPB-02-06, IPB-02-09): grant and session lifecycle on the approvals engine, ≤ 4 h and ≤ 60 min ceilings from settings, events, and ledger tagging.
- **Field encryption wrapper:** `encryptField(tenantId, class, plaintext, aad)` / `decryptField(...)` with the IPB-02 §02.4.3.2 API name. Primitives come from `@infrabyx/crypto`, tenant data keys from the `KMS` port (fake in PL1). REGULATED/SECRET classes are always field-encrypted (IPB-02-20).
- **Masking:** `mask(field, value)` server rules file `mask.rules.json`, shared later with `packages/ui/mask` (IPB-02 §02.4.3.3).
- **Migrations runner:** `infrabyx-migrate` (decision D-04).
- **RLS lint:** `infrabyx-rls-lint --db <url>` (below).
- **NestJS adapter (optional subpath `@infrabyx/tenancy/nest`):** interceptor building the context from the verified principal; `@nestjs/common` as an optional peer dependency (decision D-07).

### 7.2 Data model (schema `tenancy`)

| Table                   | Key columns (data class)                                                                                                                                                                                                                      | RLS                                                                         |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `tenant`                | `id tnt_`, `org_id` (Spec §4.1, INTERNAL), `product`, `name` (INTERNAL), `status`, `residency`, `brand_id`, `plan_ref`, `created_at`, `deleted_at` (soft delete, IPB-02-81)                                                                   | ENABLE + FORCE; own row only; platform context sees all                     |
| `legal_entity`          | `id ent_`, `tenant_id`, `name`, `cin`, `gstin` (CONFIDENTIAL)                                                                                                                                                                                 | tenant                                                                      |
| `user`                  | `id usr_`, `idp_subject` (CONFIDENTIAL), `status`, `created_at` (identity anchor; profile stays in IDENTITY)                                                                                                                                  | not tenant-scoped; readable only through `membership`                       |
| `membership`            | `tenant_id`, `user_id`, `roles text[]`, `entity_ids`, `product_scope` (IPB-D-12)                                                                                                                                                              | tenant                                                                      |
| `approval_request`      | `id apr_`, `tenant_id`, `action`, `risk_class`, `payload_digest`, `payload_enc` (encrypted when CONFIDENTIAL+), `maker_id`, `state`, `delay_until`, `required_checkers`                                                                       | tenant                                                                      |
| `approval_decision`     | `request_id`, `maker_id`, `checker_id`, `decision`, `decided_at`; composite FK `(request_id, maker_id) → approval_request(id, maker_id)` so `maker_id` cannot drift, then `CHECK (checker_id <> maker_id)`; unique `(request_id, checker_id)` | tenant                                                                      |
| `breakglass_grant`      | `id bgr_`, requester, approver (≠ requester), reason, `expires_at` (≤ 4 h)                                                                                                                                                                    | platform tenant                                                             |
| `impersonation_session` | `id imp_`, actor, target user, target tenant, ticket ref, `expires_at` (≤ 60 min)                                                                                                                                                             | platform + visible to target tenant's ORG_OWNER via a security-invoker view |
| `outbox`, `inbox`       | IPB-01 §01.4.3.3                                                                                                                                                                                                                              | tenant                                                                      |

Also `meta.migration_checksums` and the role bootstrap (`app_rw`, `app_migrate`, `app_ro`). All migrations are expand-only.

### 7.3 RLS lint (IPB-02-12, IPB-09 §09.4.2)

A catalog-based check against a database with all migrations applied:

- Every table with a `tenant_id` column, or listed in a module manifest's `rlsTables`, has `relrowsecurity` and `relforcerowsecurity` and at least one policy whose expression references `app.tenant_id`.
- Views over such tables are `security_invoker`.
- No policy references `auth.*` (the Supabase rule, IPB-01 §01.4.11).
- No role has `BYPASSRLS` or `SUPERUSER` except the bootstrap owner.
- No `SECURITY DEFINER` function is executable by `app_rw`/`app_ro` unless it is allow-listed.

It runs as CI job `rls-lint` and as a library call products use in their own CI.

### 7.4 Tests

`@IPB-02-AT-04` (header ignored), `@IPB-02-AT-08` (mutation during impersonation refused; the tenant audit view part needs `audit`), `@IPB-02-AT-10`, `@IPB-02-AT-11`, `@IPB-02-AT-12`, `@IPB-01-AT-05` (schema-boundary rule, already in PL0, extended to real Drizzle imports), `@IPB-01-AT-16` (manifest lists a table without RLS → boot fails `IPB-MOD-001`), cross-tenant read with crafted ID returns nothing, `SET` without `LOCAL` is rejected by the kernel, `kernel.mutate` without a ledger write fails, field-encryption ciphertext in a raw dump (IPB-02-20 test).

**Stubs:** IDENTITY token verification (claims come from a test signer; Keycloak is PL2), KMS (LocalKms). **Changeset:** minor.

---

## 8. `@infrabyx/audit` (IPB-02-51, IPB-02-52, §02.4.7.1)

### 8.1 Public interface

- `audit.record(tx, entry)`: called inside `kernel.mutate`. The entry holds `action`, `resource_type`, `resource_id`, `before`/`after`, which are hashed to `before_digest`/`after_digest` (full payloads are never stored in the ledger).
- `audit.correct(tx, entryId, correction)`: a correction is a new entry referencing `corrects_id`; nothing is ever updated.
- `audit.verify(tenantId, range?)`: recomputes the chain and reports the first break. It also runs as the weekly verifier job and emits `LedgerChainBroken`.
- `audit.buildAnchor(date)` and `audit.writeAnchor(storage, kms)`: per-tenant head hashes, signed through the `KMS` port and written with retention through the `STORAGE` port. The PL1 targets are in-memory fakes; the S3 Object Lock adapter is PL2.
- `audit.query(ctx, filter)`: tenant-scoped read for the Audit trails node and the tenant export slice (IPB-02-18).

### 8.2 Data model (schema `audit`)

| Table        | Columns                                                                                                                                                                                                                                           | Protection                                                                                                                                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ledger`     | `id led_`, `tenant_id`, `seq bigint` (per tenant), `actor_id`, `actor_type`, `action`, `resource_type`, `resource_id`, `before_digest`, `after_digest`, `corrects_id`, `trace_id`, `ip_hash`, `ua_hash`, `occurred_at`, `prev_hash`, `entry_hash` | Insert-only: `UPDATE`/`DELETE`/`TRUNCATE` revoked from every role, plus a trigger that raises on update/delete for any role including the owner. RLS on read. Character-set CHECK constraints on every hashed field (see C-01). |
| `chain_head` | `tenant_id`, `seq`, `entry_hash`                                                                                                                                                                                                                  | Locked `FOR UPDATE` by the insert trigger, which serialises appends per tenant                                                                                                                                                  |
| `anchor`     | `id anc_`, `date`, `tenant_id`, `head_hash`, `signature`, `alg`, `key_id`, `storage_key`                                                                                                                                                          | insert-only                                                                                                                                                                                                                     |

The `entry_hash` is computed **in the database by trigger** (IPB-02 §02.4.7.1 requires it; IPB-01 §01.4.6 permits exactly this trigger), so no application path can write an unchained row. The TypeScript verifier reproduces the same canonical form. Algorithm details are in C-01 and C-02.

### 8.3 Tests

`@IPB-02-AT-15` (1,000-entry chain, alter one `after_digest` → break reported at that entry, event emitted), concurrent appends from 20 transactions keep one gap-free chain per tenant, update/delete refused for `app_rw`, `app_migrate` and owner, correction entries verify, anchor signature verifies with the public key, a tenant can verify its own chain from the anchor alone, and `migration-lint` rule `audit-ledger-untouched` fixture.

**Stubs:** anchor storage (STORAGE fake), KMS (LocalKms), the public timestamp anchor (IPB-OI-02-05, flag `trust.audit.external_anchor` OFF). **Changeset:** minor.

---

## 9. `@infrabyx/seed` (IPB-11 §11.3.D–E, §11.4.5–11.4.8; IPB-D-04)

### 9.1 Public interface

- CLI `infrabyx-seed --profile <dev|demo|test|load>` (products alias it as `pnpm seed`): refuses with `IPB-SEED-001` when `APP_ENV ∈ {prod, dr, pre-prod}` or `SEED_ENABLED != true` and emits `SeedRefused` (IPB-11-22, `@IPB-11-AT-02`). The load profile needs `SEED_LOAD_CONFIRM=yes` (`IPB-SEED-002`).
- `defineSeedModule({ module, profiles, run(ctx, faker) })` for product seed modules; deterministic faker (`@faker-js/faker`, `en_IN`, `SEED_RANDOM_SEED`) and `deterministicId()` (IPB-11-23).
- Upsert-on-natural-key helper; the run report shows `inserted / unchanged` (IPB-11-24).
- Synthetic identifier generators and the "no real identifier" validator (IPB-11-25): Aadhaar-like values start with `9999` and must **fail** Verhoeff; PAN-like values have `Z` as the fourth character (decision D-15); IFSC `TEST0000001`; mobiles `+91 99999 0xxxx`.
- Platform seed: tenants `tnt_platform`, `tnt_demo`, `tnt_sandbox` (IPB-11-26), the common personas of IPB-11 §11.4.5 and a slot for product personas (IPB-11-27), settings defaults from the registry, all `fut.*` flags OFF (IPB-11-29). IPB-11-30's model-registry rows are a hook for PL4.
- `seed:purge --profile` removes exactly what a profile created and refuses in prod (IPB-11-31). Seeded rows are tracked in `seed.seed_row` rather than by adding columns to every product table, which IPB-11-31 allows ("or a tag in metadata"; decision D-16).
- CLI `infrabyx-seed credentials [--rotate] [--no-file]` (IPB-11-35 to IPB-11-39, §11.4.7): generates passwords with `crypto.generateSeedPassword()`, writes them to the seed vault through `SECRETS`, sets them on the IdP through the `IDENTITY` port, writes `SEED_CREDENTIALS.md` with mode `0600`, adds it to `.git/info/exclude`, prints exactly one line, and never logs a password. It refuses in `prod`, `dr` and `pre-prod` (the stricter IPB-11-14 set, not only prod/dr from §11.4.7 step 1; decision D-17). Agents get client credentials only.
- The super admin `rjnprajapati@gmail.com` is seeded as `PLT_SUPER_ADMIN` in `tnt_platform` with MFA always required (IPB-11-32, IPB-11-37). In production it is created by the identity bootstrap, never by seed.

### 9.2 Data model (schema `seed`)

`seed.seed_run` (`id run_`, profile, product, started_at, finished_at, counts jsonb) and `seed.seed_row` (`run_id`, `table_name`, `row_id`, `profile`). Neither holds personal data.

### 9.3 Repository hooks

`lefthook` pre-commit blocks `.env*` except `.env.example` and `SEED_CREDENTIALS.md`, and runs gitleaks on staged content (IPB-11-09). This is new repo tooling in PL1.

### 9.4 Tests

`@IPB-11-AT-02`, `@IPB-11-AT-03` (super admin exists after seeding; the first-production-login scenario needs IDENTITY and lands in PL2/PL6), `@IPB-11-AT-04` (generation scenario in full; for the commit-attempt scenario the pre-commit part is testable now, the server-side ruleset part is blocked by PL0-D-07), `@IPB-11-AT-05`, `@IPB-02-AT-07` (boot refusal scenario; the seed-credential login scenario needs IDENTITY), determinism (two runs give byte-identical dumps), idempotency, purge precision, CI log scan for generated passwords.

**Stubs:** IDENTITY admin API (fake IdP records users and passwords in memory), SECRETS vault (in-memory). **Changeset:** minor.

---

## 10. `@infrabyx/testing` (IPB-01 §01.4.2, IPB-14 §14.5 item 4)

**Public interface:**

- `startPostgres({ version: 18, extensions })` (Testcontainers) with roles bootstrapped and all platform migrations applied; `withTenant(ctx)` helpers; fake factories for `SECRETS`, `KMS`, `STORAGE`, `FEATURE_FLAG`, `IDENTITY`.
- **NN pattern suites** that products run against their own modules (IPB-14 §14.5 item 4):
  1. `describeTenantIsolation({ table, insert, select })`: cross-tenant read by crafted ID, header injection, missing `SET LOCAL`, view without `security_invoker`.
  2. `describeAuditChain({ mutate })`: every mutation leaves exactly one chained entry; a tamper is detected.
  3. `describeMakerChecker({ action })`: maker ≠ checker, agent cannot check, delay window holds.
  4. `describeLockedActions({ actions })`: AGT principals are refused approve/sign/disburse/delete/grant. The Vidhi locked list itself is PL4.
  5. `describeSeedRefusal({ entrypoint })`: prod, dr and pre-prod refuse seeds.
     The mapping to the NN-01/02/45 IDs named in IPB-14 §14.3 is decision D-09.
- **Port contract harness:** `defineContractSuite(port, factory)`, used by PL2 adapters (IPB-01-15).
- **Migration lint:** `infrabyx-migration-lint <dir>` implementing every rule in IPB-09 §09.4.6.2 and every forbidden operation in §09.4.6.3, using a real PostgreSQL parser (`libpg-query`, WASM build, checked at implementation for licence and Node 24 support). It runs on every package's `migrations/` in CI (`@IPB-09-AT-11`, `@IPB-09-AT-12`, `@IPB-01-AT-11`).
- **ESLint IPB plugin moves here** as `@infrabyx/testing/eslint`, so products can install the same `vendor-import`, `schema-boundary`, `no-process-env` and `no-direct-crypto` rules. Today they live in `infra/policy/eslint`, which products cannot install (decision D-05).
- `ipb:at-report`: lists `@IPB-..-AT-..` tests found and their result (§3.4).

**Tests:** each NN suite runs against the PL1 packages themselves; migration-lint fixtures for every rule (pass and fail); contract-harness self-test with an in-memory port.

**Changeset:** minor.

---

## 11. CI additions in PL1 (IPB-09-07 required checks)

| Job                   | New in PL1 | Notes                                                                                                                                                   |
| --------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test:int`            | yes        | Testcontainers PostgreSQL 18 on the GitHub runner                                                                                                       |
| `rls-lint`            | yes        | catalog check after all migrations                                                                                                                      |
| `migration-lint`      | yes        | static check of every `migrations/` dir                                                                                                                 |
| `env-example --check` | yes        | for the `apps/reference` schema once it exists; in PL1 for a fixture schema                                                                             |
| `ipb:at-report`       | yes        | report only, not blocking                                                                                                                               |
| existing PL0 steps    | —          | lint (now with `no-direct-crypto`), typecheck, build, unit, policy-rules, licence, ipb-check, secret-scan, commitlint, changeset-required, pr-checklist |

---

## 12. Exit-gate checklist (IPB-09 + IPB-14 §14.3)

- [x] All seven packages build, typecheck, lint and pass unit and integration tests on Node 24.22.1.
- [x] `rls-lint` and `migration-lint` green on every PL1 migration.
- [x] Acceptance tests present and passing: IPB-01-AT-05, -11, -12 (supabase-guard), -16; IPB-02-AT-04, -07 (boot), -08 (mutation refusal), -10, -11, -12, -15, -20; IPB-07-AT-04 (data level), -05, -06; IPB-09-AT-09, -10, -11, -12; IPB-11-AT-01, -02, -03 (seed part), -04 (generation + pre-commit), -05, -06, -07; IPB-12-AT-01, -03.
- [x] The five NN pattern suites pass against the PL1 packages.
- [x] One Changeset per package; `docs/STATUS.md` updated; assumptions in `docs/DECISIONS.md`.
- [ ] PR merged to `main` with CI green; `release.yml` publishes pre-release **0.1.0** of the seven packages to GitHub Packages, and they appear under the organisation's Packages tab (IPB-14 §14.4 step 5). The held "chore: version packages" PR (O7) is superseded by this release.

Deferred ATs, named so the gap is explicit: IPB-02-AT-03 (IDOR suite, needs an API), IPB-02-AT-07 second scenario and IPB-11-AT-03 production scenario (need IDENTITY, PL2), IPB-11-AT-04 server-side ruleset (PL0-D-07), IPB-01-AT-12 Helm scenario (PL6).

---

## 13. Owner decisions needed (D-nn)

| ID   | Decision                                                                                                                                                                                                          | Recommendation                                                                                                                                                                                          | Why it matters                                                                                          |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| D-01 | Put the approvals engine, break-glass and impersonation in PL1 `tenancy` (as IPB-02 §02.4.2 says) or defer to PL3 `workflow`                                                                                      | **PL1 `tenancy`**; PL3 adds Temporal orchestration                                                                                                                                                      | IPB-07-39 and AT-06 need maker-checker for settings in PL1; IPB-14 §14.5 NN tests include maker-checker |
| D-02 | Define all ~55 port interfaces in PL1, or only the five PL1 consumes plus a catalogue                                                                                                                             | **Five plus catalogue**; the rest land with their adapters                                                                                                                                              | Keeps PL1 to its 4–6 sessions; interfaces get written next to their contract tests                      |
| D-03 | Reconcile `IPB-ENV-*` codes: IPB-01 and IPB-02 use ENV-001 = "seed refused in prod", ENV-002 = "disallowed engine/host"; IPB-11 §11.6 uses ENV-001 = "schema validation failed", ENV-002 = "seed present in prod" | **Keep IPB-01/02 meanings for 001/002; keep IPB-11's 003–010 unchanged; give "schema validation failed" the new code ENV-011.** Every IPB acceptance test still passes. Logged as change request PR-002 | Error codes are a public contract; they cannot change after products adopt them                         |
| D-04 | How library packages ship migrations                                                                                                                                                                              | **Each package ships SQL under `migrations/`; `infrabyx-migrate` (tenancy) applies platform migrations first, with checksums in `meta.migration_checksums`**                                            | Products must apply platform schemas the same way everywhere                                            |
| D-05 | Where the publishable lint rules live                                                                                                                                                                             | **`@infrabyx/testing/eslint` subpath** (no new package; IPB-14 §14.2 list unchanged)                                                                                                                    | Products need the same lint rules; `infra/policy` is not installable                                    |
| D-06 | Pre-release at PL1 exit                                                                                                                                                                                           | **Publish 0.1.0 of the seven PL1 packages** per IPB-14 §14.4; close the held version-packages PR                                                                                                        | Confirms the O7 hold ends at PL1                                                                        |
| D-07 | Ship NestJS adapters in PL1                                                                                                                                                                                       | **Yes, as optional subpath exports with `@nestjs/common` as an optional peer**                                                                                                                          | The tenancy interceptor is the IPB-02-13 control; products should not each write it                     |
| D-08 | ADR-0002 pnpm 10 (from PR #5)                                                                                                                                                                                     | **Accept before PL1 code starts**, so PL1 lockfiles are built once                                                                                                                                      | pnpm 9.x has 12 unfixed high advisories and no 9.x fix                                                  |
| D-09 | NN-01 / NN-02 / NN-45 test IDs in IPB-14 §14.3 are not defined in this repository                                                                                                                                 | **Tell me the source pack**, or confirm they map to the five §14.5 patterns in §10                                                                                                                      | I cannot tag tests with IDs I cannot see                                                                |
| D-10 | Role list: IPB files cite "brief §3" for roles; the brief is not in the repository                                                                                                                                | **Provide brief §3**, or approve the role enum assembled from IPB-01/02/07/11                                                                                                                           | Roles are a contract used by Cerbos policies later                                                      |
| D-11 | Register settings keys from every IPB file now, or per owning phase                                                                                                                                               | **Per owning phase**; PL1 registers keys from IPB-01, -02, -07, -11 plus `fut.*` and `kill.*`                                                                                                           | Avoids registering keys whose types the owning phase has not designed                                   |
| D-12 | Settings source format                                                                                                                                                                                            | **`settings-tree.yaml` as source, generated `registry.ts`** (both named in the IPB: IPB-07-36 and IPB-01 §01.5)                                                                                         | Satisfies "unregistered read fails typecheck" and the YAML tree at the same time                        |
| D-13 | Two event envelopes                                                                                                                                                                                               | **Internal (IPB-10-37) and Ecosystem (Spec §3.2) both in `contracts/events`**                                                                                                                           | The IPB and the Spec define different `id` and `source` formats                                         |

Small spec inconsistencies I will resolve as assumptions and log in `docs/DECISIONS.md` unless you object:

| ID   | Inconsistency                                                                                                 | Assumption                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| D-14 | Migration role `app_migrate` (IPB-01 §01.4.6) vs `app_migrator` (IPB-11 `.env.example`)                       | `app_migrate`; IPB-01 defines roles, IPB-11 only gives an example value |
| D-15 | IPB-11-AT-05 says synthetic PAN has `Z` as fourth character; the IPB-11-25 example `ZZZPZ9999Z` has `P`       | Follow the acceptance test: pattern `ZZZZ[A-Z]9999Z`                    |
| D-16 | Seed tracking by columns on every row vs "a tag in metadata"                                                  | `seed.seed_row` registry table                                          |
| D-17 | `seed:credentials` refuses prod/dr (§11.4.7) vs seeds refuse prod/dr/pre-prod (IPB-11-14, -22)                | Refuse prod, dr and pre-prod everywhere (stricter)                      |
| D-18 | IPB-01 local seed profile `minimal` vs IPB-11 profiles `dev/demo/test/load`                                   | IPB-11 governs; `local` uses `dev`                                      |
| D-19 | IPB-11 `.env.example` shows `STORAGE_OBJECT_LOCK_MODE=GOVERNANCE` vs IPB-01-28 "compliance, never governance" | Not PL1; flagged for PL2 STORAGE, compliance mode wins                  |

---

## 14. Cryptography choices (locked list: need explicit approval)

These follow the IPB where it is specific. Where the IPB is silent or inconsistent I give a recommendation. None will be implemented without your approval.

| ID   | Choice                                                                                                                     | Recommendation                                                                                                                                                                                                                                                                                                                                                                                                 | Basis                                                                              |
| ---- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| C-01 | Ledger hash                                                                                                                | `entry_hash = SHA-256(prev_hash ‖ 0x0A ‖ JCS(entry))`, hex. JCS = RFC 8785 canonical JSON over a fixed field list. The genesis `prev_hash` per tenant is 64 zeros. Hashed fields are restricted by CHECK constraints to a safe character set (IDs, dotted action names, hex digests, ISO timestamps), so the SQL trigger and the TypeScript verifier produce identical bytes without a JSON escaping edge case | IPB-02-51 says SHA-256 over canonical JSON; §02.4.7.1 says a trigger computes it   |
| C-02 | IPB-11 lists `OBS_AUDIT_HASH_CHAIN_KEY_REF` ("HMAC key for audit ledger chain"); IPB-02 specifies an unkeyed SHA-256 chain | **Keep the chain unkeyed** so a tenant can verify its own chain from the anchor files (IPB-02 §02.4.7.1 says tenants download them). **Use the HMAC key for `ip_hash`, `ua_hash` and hashed actor IDs**, which must be keyed or they can be reversed by dictionary                                                                                                                                             | IPB-02 vs IPB-11 conflict; logged as change request PR-003                         |
| C-03 | Anchor signature algorithm                                                                                                 | **ECDSA P-256 with SHA-256 through the KMS port.** It is the curve every KMS alternative in IPB-01 supports (AWS KMS, Azure Key Vault, Google Cloud KMS, Vault Transit, PKCS#11 HSMs). Ed25519 support differs between them **[VERIFY at implementation]**, so it is listed in the registry as `planned`                                                                                                       | IPB-01 KMS port portability                                                        |
| C-04 | Field encryption                                                                                                           | **AES-256-GCM**, 96-bit random nonce, 128-bit tag; per-tenant data key from KMS `generateDataKey`, cached ≤ 5 min and re-generated after 2^20 uses (far below the GCM random-nonce limit); AAD = `tenant_id ‖ table ‖ column ‖ row_id`; stored as `<col>_enc`, `<col>_key_id`, `<col>_alg`                                                                                                                     | IPB-02 §02.4.3.2 names AES-256-GCM, the cache limit and the columns                |
| C-05 | Blind index                                                                                                                | **HMAC-SHA-256 with a separate tenant-scoped blind-index key** (never the encryption key), over a normalised value (upper-case, whitespace stripped), full 32-byte output                                                                                                                                                                                                                                      | IPB-02 §02.4.3.2: "HMAC with a tenant-scoped key — never deterministic encryption" |
| C-06 | Randomness and IDs                                                                                                         | `node:crypto.randomBytes` for all secrets, nonces and ULID entropy                                                                                                                                                                                                                                                                                                                                             | IPB-12-05                                                                          |
| C-07 | Deterministic seed IDs                                                                                                     | ULID time component fixed to the seed anchor date; random component = first 80 bits of SHA-256(namespace ‖ natural key). Not used for anything secret                                                                                                                                                                                                                                                          | IPB-11-23                                                                          |
| C-08 | Seed passwords                                                                                                             | Exactly IPB-11 §11.4.7: 24+ chars, base62 plus two of `-_.!@#`, rejection sampling from `randomBytes(32)`. Uniqueness across products is checked against salted SHA-256 hashes in the seed vault                                                                                                                                                                                                               | IPB-11 §11.4.7                                                                     |
| C-09 | Library                                                                                                                    | **Node built-in `node:crypto` only**; no third-party crypto dependency                                                                                                                                                                                                                                                                                                                                         | Smallest supply-chain surface; FIPS-capable OpenSSL build available later          |
| C-10 | Local and dev keys                                                                                                         | `LocalKms` with software keys in `dev-keys.json` for `local`, `dev` and `test` only; their fingerprints are refused by the prod guards                                                                                                                                                                                                                                                                         | IPB-11-17                                                                          |

---

## 15. Change requests to raise for the spec owner (`docs/platform-requests.md`)

- **PR-002:** reconcile `IPB-ENV-*` codes across IPB-01 §01.6.3, IPB-02 §02.6.3 and IPB-11 §11.6 (D-03).
- **PR-003:** clarify the purpose of `OBS_AUDIT_HASH_CHAIN_KEY_REF` in IPB-11 against the unkeyed chain in IPB-02-51 (C-02).
- **PR-004:** IPB-11-25 PAN example versus IPB-11-AT-05 (D-15); `app_migrator` versus `app_migrate` (D-14); `STORAGE_OBJECT_LOCK_MODE` example (D-19).

I will add these rows when the plan is approved.

---

## 16. Risks

- **Scope.** PL1 is the largest kernel phase. If D-01 and D-07 are accepted it is at the top of the 4–6 session estimate. The natural split is PL1a (`contracts`, `crypto`, `config`) and PL1b (`tenancy`, `audit`, `seed`, `testing`), each with its own exit check.
- **Canonical JSON in SQL.** C-01 depends on restricting hashed fields to a safe character set. If a product needs free text in a hashed field, it must go into `before`/`after`, which are hashed as digests, never inlined.
- **Testcontainers availability.** Local verification in cloud sessions needs a PostgreSQL 18 binary; CI is authoritative.
- **Unsupported pnpm.** Building PL1 on pnpm 9 means re-generating every lockfile when D-08 lands; deciding first avoids that.
