# @infrabyx/tenancy

## 1.6.0

### Minor Changes

- 138ae44: Inbound idempotency (IPB-10-07; Finbyx PR-FBX-10 item 4; R1-D-27). `idempotent(tx, request, work, { audit })` claims the client's `Idempotency-Key` inside the change's transaction: identical replays return the stored response; another body is 409 IPB-PORT-004; a key still running is 409 IPB-API-011. `IdempotencyKeyInterceptor` (`@infrabyx/tenancy/nest`) requires the UUIDv7 key on POST and PATCH and sets the replay headers. `IdempotencyExpiry` purges expired keys per tenant. Migration `tenancy/0008` adds `tenancy.idempotency_key`.

### Patch Changes

- Updated dependencies [138ae44]
- Updated dependencies [138ae44]
  - @infrabyx/config@1.4.0
  - @infrabyx/contracts@1.10.0
  - @infrabyx/crypto@1.2.5

## 1.5.0

### Minor Changes

- 2b307e0: The branch context (R1-D-26). The kernel checks and sets `app.branch_id`, `app.branch_ids` and `app.branch_scope` for each transaction. Migration `tenancy/0007` adds `tenancy.branch_allowed(branch_id)` for branch-level RLS policies; it denies by default.

### Patch Changes

- Updated dependencies [2b307e0]
  - @infrabyx/contracts@1.9.0
  - @infrabyx/config@1.3.2
  - @infrabyx/crypto@1.2.4

## 1.4.0

### Minor Changes

- cd25633: The kernel sets `app.action` and `app.reason` (`MutateOptions.reason`, 1 to 500 characters) for each mutation, so the statutory capture records why a change was made (R1-D-25).

### Patch Changes

- Updated dependencies [cd25633]
  - @infrabyx/contracts@1.8.0
  - @infrabyx/config@1.3.1
  - @infrabyx/crypto@1.2.3

## 1.3.5

### Patch Changes

- Updated dependencies [94b706e]
  - @infrabyx/config@1.3.0

## 1.3.4

### Patch Changes

- Updated dependencies [f5622c9]
- Updated dependencies [f5622c9]
  - @infrabyx/config@1.2.0
  - @infrabyx/contracts@1.7.0
  - @infrabyx/crypto@1.2.2

## 1.3.3

### Patch Changes

- Updated dependencies [ceabe3b]
  - @infrabyx/contracts@1.6.0
  - @infrabyx/config@1.1.1
  - @infrabyx/crypto@1.2.1

## 1.3.2

### Patch Changes

- Updated dependencies [849b8f9]
- Updated dependencies [849b8f9]
- Updated dependencies [849b8f9]
  - @infrabyx/config@1.1.0
  - @infrabyx/contracts@1.5.0
  - @infrabyx/crypto@1.2.0

## 1.3.1

### Patch Changes

- Updated dependencies [7e38652]
- Updated dependencies [7e38652]
  - @infrabyx/contracts@1.4.0
  - @infrabyx/crypto@1.1.0
  - @infrabyx/config@1.0.6

## 1.3.0

### Minor Changes

- b6058d3: The Ecosystem inbox (Spec §3.5; G2): migration `0006` adds `tenancy.create_ecosystem_inbox('<schema>')`, and `EcosystemInbox` stores each event before processing, de-duplicates by `(source, id)` and business key, processes in `seq` order per subject, parks gaps for 15 minutes, replays them through the product's callback and turns a gap still open into a reconciliation break. Every write is ledgered.

### Patch Changes

- Updated dependencies [b6058d3]
  - @infrabyx/contracts@1.3.0
  - @infrabyx/config@1.0.5
  - @infrabyx/crypto@1.0.3

## 1.2.1

### Patch Changes

- Updated dependencies [1c869a8]
  - @infrabyx/config@1.0.4

## 1.2.0

### Minor Changes

- 75e9ea4: `TenantSweep` and migration `0005` (PR-UDF-013): list the tenants as `SVC_TENANT_SWEEP` (only `id` and `status`; the read is ledgered in each tenant) and run a scheduled job once per tenant in that tenant's context, as the job's own service principal, reporting each tenant's failure without stopping the others.

### Patch Changes

- Updated dependencies [75e9ea4]
  - @infrabyx/contracts@1.2.0
  - @infrabyx/config@1.0.3
  - @infrabyx/crypto@1.0.2

## 1.1.3

### Patch Changes

- c0ce8ff: `infrabyx-migrate` names each platform package with migrations that it skipped as not installed, and `--require-all` refuses instead (IPB-MOD-001) before connecting; `platformSources` takes `{ missing: "error" }`, an `onSkipped` callback and several directories to resolve from (PR-FBX-06).
- 2724cd6: Security (PR-UDF-016): migration `0004` makes every `svc_*` service role switch-only for `app_rw` and `app_ro` (INHERIT FALSE, SET TRUE), makes both NOINHERIT, and revokes `svc_outbox_relay` from `app_ro`, so the read-only role can no longer append to the audit ledger or update outbox tables. Run `infrabyx-migrate`.

## 1.1.2

### Patch Changes

- 8a2587e: The `infrabyx-*` CLI entry points run when started through a `node_modules` symlink (`pnpm exec`, npm `.bin`, `node node_modules/@infrabyx/tenancy/…`); before, they exited 0 without running (PR-UDF-005).
- Updated dependencies [8a2587e]
  - @infrabyx/config@1.0.2

## 1.1.1

### Patch Changes

- 53a973c: Mask rule `passport` (IPB-02-22: last 3 characters shown, ledgered reveal), used by the telemetry scrubber (PR-UDF-007).

## 1.1.0

### Minor Changes

- 588b509: `OutboxRelay` relays registered module outboxes to the QUEUE as the `SVC_OUTBOX_RELAY` service reader (owner answer #74(e), R1-D-01). Migration `tenancy/0003` creates the `svc_outbox_relay` role with no grant and `tenancy.register_outbox('<schema>')`, which a module migration calls to grant it select of the relayed columns and update of `dispatched_at` and `attempts` on that one `<schema>.outbox`, plus a platform-scope discovery policy. One pass reads the pending rows per tenant (ledgered per tenant, as every service read), then in each tenant's own context delivers the batch, marks it dispatched and writes the batch's ledger entry in the same transaction. The kernel lets that reader mutate only `<schema>.outbox.dispatch` in a tenant context, running as its own database role. Products replace their own relays: run `infrabyx-migrate`, add `select tenancy.register_outbox('<schema>')` to a migration per module, and run `new OutboxRelay({ kernel, audit, deliver })` in the worker.

### Patch Changes

- Updated dependencies [588b509]
  - @infrabyx/contracts@1.1.0
  - @infrabyx/config@1.0.1
  - @infrabyx/crypto@1.0.1

## 1.0.0

### Major Changes

- 9ec9a2c: 1.0.0, the platform baseline release (IPB-14 §14.5 item 1; owner answer #67(4), PL6-D-16). Every `@infrabyx/*` package moves to 1.0.0 together; the public API is unchanged from the 0.x set of the PL6 gate (`docs/phases/PL6-gate.md` §6), so a product upgrades by moving every dependency to 1.0.0 at once. From 1.0.0 on, semantic versioning holds: a breaking change to an export, a migration or a setting is a major release with an ADR (IPB-09-34/35).

### Patch Changes

- Updated dependencies [9ec9a2c]
  - @infrabyx/config@1.0.0
  - @infrabyx/contracts@1.0.0
  - @infrabyx/crypto@1.0.0

## 0.6.0

### Minor Changes

- 9d8cd8c: PL6 session 2: `infrabyx-migrate --db-file <path>` reads the database URL from the first line of a file, so the `infrabyx-app` chart's migration job takes it from the secrets CSI mount and the password never appears in arguments or the environment (IPB-02-28). `--db` still works; passing both is refused.

### Patch Changes

- Updated dependencies [b3934f9]
  - @infrabyx/config@0.5.1

## 0.5.0

### Minor Changes

- e8e83cb: `infrabyx-migrate` applies `@infrabyx/brand` migrations after `@infrabyx/vidhi` when the package is installed.

### Patch Changes

- b0dc390: `infrabyx-migrate` applies `@infrabyx/cms` migrations after `@infrabyx/brand`.
- 686d24b: `infrabyx-migrate` applies `@infrabyx/consent` migrations after `@infrabyx/cms`.
- 275d4ba: `infrabyx-migrate` applies `@infrabyx/feedback` and then `@infrabyx/trust` migrations after `@infrabyx/consent`.
- Updated dependencies [de53086]
- Updated dependencies [de53086]
- Updated dependencies [f1a36a1]
- Updated dependencies [1fecf45]
- Updated dependencies [1fecf45]
- Updated dependencies [b0dc390]
- Updated dependencies [b0dc390]
- Updated dependencies [275d4ba]
- Updated dependencies [934355c]
- Updated dependencies [686d24b]
- Updated dependencies [e8e83cb]
- Updated dependencies [275d4ba]
- Updated dependencies [36338c3]
- Updated dependencies [934355c]
- Updated dependencies [b7de3c6]
  - @infrabyx/config@0.5.0
  - @infrabyx/contracts@0.5.0
  - @infrabyx/crypto@0.4.1

## 0.4.0

### Minor Changes

- 183c532: `memberStatus(tx, userId)`: whether a member of the transaction's tenant is active and the roles they hold now, for background re-checks such as scheduled Vidhi runs (PL4-D-09).

### Patch Changes

- 200b25a: `infrabyx-migrate` applies `@infrabyx/ai` migrations after `export` (PL4-D-03).
- b205b1d: `infrabyx-migrate` applies `@infrabyx/vidhi` migrations after `ai` (PL4 session 6).
- Updated dependencies [2b07109]
- Updated dependencies [200b25a]
- Updated dependencies [f6e9a88]
- Updated dependencies [f6e9a88]
- Updated dependencies [200b25a]
- Updated dependencies [9af583a]
- Updated dependencies [288ae44]
- Updated dependencies [b205b1d]
- Updated dependencies [183c532]
- Updated dependencies [f6e9a88]
  - @infrabyx/contracts@0.4.0
  - @infrabyx/config@0.4.0
  - @infrabyx/crypto@0.4.0

## 0.3.0

### Minor Changes

- 3951517: Cross-tenant service readers (owner answer #22, PL3-D-21): `ServiceReader`, `serviceReaderContext`
  and `serviceReaderRole`. The kernel runs a reader's platform-scope read as its own database role,
  refuses every reader mutation except the `platform.service_read` ledger entry for its own read,
  and `contextFromClaims` refuses a token that claims a reader role. Each read that returns rows is
  ledgered in every tenant it touched. Also `tenantHasRoleHolder` for the rules review assignee.
- dd7a98b: Maker-checker additions (PL3-D-07, PL3-D-08, PL3-D-19), migration `tenancy/0002_approvals_pl3.sql`
  (expand-only): requests expire after 7 days, or 72 hours for R4, R5 and financial R3
  (`expire`, terminal, `IPB-UX-012`, `ApprovalExpired`); `remind` and `escalate` (to `ORG_ADMIN`,
  `ApprovalEscalated`, never decides); the checker `diff` (field names only above INTERNAL); the
  tighten-only tenant policy hook for `mc.checker_roles` and `mc.dual_checker_above`;
  `PLT_SECURITY_OFFICER` may cancel (IPB-02-80); `observers` called inside each transition's
  transaction. Products run `infrabyx-migrate` to apply 0002.
- e268b60: `PgKernel.read(ctx, fn, { snapshot: true })` runs a REPEATABLE READ read-only transaction, and
  `infrabyx-migrate` applies `@infrabyx/export` migrations when the package is installed (PL3-D-22).
- 1ed0659: `infrabyx-migrate` applies `@infrabyx/notify` migrations (after `@infrabyx/workflow`).
- 53697f5: `infrabyx-migrate` applies `@infrabyx/rules` migrations (after `@infrabyx/connectors`) when the
  package is installed.
- dd7a98b: `infrabyx-migrate` applies `@infrabyx/workflow` migrations (after `@infrabyx/rules`).

### Patch Changes

- Updated dependencies [50093e9]
- Updated dependencies [2725b6c]
- Updated dependencies [dd7a98b]
- Updated dependencies [50093e9]
- Updated dependencies [e268b60]
- Updated dependencies [1ed0659]
- Updated dependencies [2725b6c]
- Updated dependencies [1ed0659]
- Updated dependencies [53697f5]
- Updated dependencies [dd7a98b]
- Updated dependencies [e268b60]
- Updated dependencies [1ed0659]
- Updated dependencies [50093e9]
- Updated dependencies [53697f5]
- Updated dependencies [3951517]
  - @infrabyx/config@0.3.0
  - @infrabyx/contracts@0.3.0
  - @infrabyx/crypto@0.3.0

## 0.2.0

### Minor Changes

- 7a36249: `FieldCrypto` seals with envelope format v2 under `{ tenant_id, purpose: "field" }` (PL2-D-50), adds `rewrapField` and `formatVersion`; v1 fields stay readable.
- 858a76a: `infrabyx-migrate` applies `@infrabyx/connectors` migrations after seed whenever the package is
  installed, so products keep a single migrate command (PL2-D-34).

### Patch Changes

- Updated dependencies [5482043]
- Updated dependencies [efd00ab]
- Updated dependencies [2969424]
- Updated dependencies [858a76a]
- Updated dependencies [9ac878e]
- Updated dependencies [ded1ae2]
- Updated dependencies [9c774b9]
- Updated dependencies [9ac878e]
- Updated dependencies [9ac878e]
- Updated dependencies [858a76a]
- Updated dependencies [7a36249]
- Updated dependencies [7a36249]
- Updated dependencies [13c7379]
- Updated dependencies [13c7379]
- Updated dependencies [13c7379]
- Updated dependencies [0c4535d]
- Updated dependencies [0c4535d]
  - @infrabyx/crypto@0.2.0
  - @infrabyx/config@0.2.0
  - @infrabyx/contracts@0.2.0

## 0.1.0

### Minor Changes

- 245318b: PL1 tenancy: tenant context from verified claims only, the PostgreSQL transaction kernel (SET LOCAL, app_rw, statement guard, impersonation and agent guards, ledger-required commit), outbox and inbox, the maker-checker engine with risk-class delays and two-checker tenant delete, break-glass and impersonation, field-level envelope encryption and masking rules, `infrabyx-migrate` with checksums, `infrabyx-rls-lint`, Drizzle and NestJS adapters, and migration `tenancy/0001_init.sql`.

  Audience: developer · Reg: none · Notice class: standard

### Patch Changes

- c2cf60a: PL0 toolchain baseline: pnpm 9 lockfile, Turborepo pipeline, ESLint 10 flat config with the IPB
  rules `ipb/vendor-import`, `ipb/schema-boundary` and `ipb/no-process-env` (placeholders),
  Vitest, Prettier, Renovate per IPB-01 §01.4.1.2, SHA-pinned CI and release workflows, and the
  `ipb:check` structural checks. Released with the seven PL1 packages at 0.1.0 (PL1-D-02 / D-06); the fifteen later-phase packages stay unpublished scaffolds until their own phase.

  Audience: internal · Reg: none · Notice class: standard

- Updated dependencies [c2cf60a]
- Updated dependencies [542194d]
- Updated dependencies [a17086c]
- Updated dependencies [8f44a2c]
  - @infrabyx/config@0.1.0
  - @infrabyx/contracts@0.1.0
  - @infrabyx/crypto@0.1.0
