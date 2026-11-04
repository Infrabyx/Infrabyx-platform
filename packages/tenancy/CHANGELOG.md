# @infrabyx/tenancy

## 1.12.0

### Minor Changes

- c8b8f88: External grantee kinds `nhb`, `nabard`, `ifsca`, `roc_inspector`, `rcs_inspector`, `crcs_inspector`, `secretarial_auditor`, `tax_auditor`, `concurrent_auditor` and `cooperative_auditor` (PR-LDC-07), with `tenancy.external_grant`'s kind check widened in `tenancy/0016`. A scoped break-glass (PR-LDC-08 (c)): `BreakGlass.request(ctx, reason, minutes, { tenantId, modules?, access? })` narrows a grant to one tenant, its modules (schemas) and `read` (default) or `read_write`; the kernel refuses another tenant, a platform context, a write under `read` and a statement naming another module (`IPB-SEC-005`), and ledgers each refusal (`security.breakglass.scope_refused`) in the tenant touched through the new `PgKernelOptions.audit`, without which a scoped grant is refused. No scope keeps IPB-02-06's behaviour. `BreakGlassGrant.scope` and `BreakGlassUse.scope` show it (R1-D-75).
- c8b8f88: Tenant-consented support access, a grant separate from break-glass (PR-LDC-08 (a), (b), PR-LDC-20; owner answer #104; R1-D-76): `SupportAccess` (`request` by a `PLT_SUPPORT` principal in the tenant; `consent` by the tenant's ORG_OWNER or ORG_ADMIN; `approve` by a second, different one for `read_write`; `refuse`, `revoke` at once; `list`; `reads`, every read made under a grant), `SupportReads.read` (each read ledgered as `platform.support_read` and recorded for the tenant) and `supportContext(tenantId, principalId)`, onto which a product maps its own support role. Grants list modules, are read-only by default and last at most 24 hours (`tenancy/0017`: `tenancy.support_grant`, `tenancy.support_read`, `tenancy.support_read_record`). The kernel refuses a support principal without a live grant in the tenant (`IPB-TRUST-003`), any read outside `SupportReads`, any write under a read grant and any module outside the grant (`IPB-SEC-005`, ledgered as `security.support_access.scope_refused`), and any `PLT_SUPPORT` context with another role, a platform context, impersonation or break-glass.

### Patch Changes

- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
  - @infrabyx/contracts@1.19.0
  - @infrabyx/config@1.10.0
  - @infrabyx/crypto@1.5.4

## 1.11.0

### Minor Changes

- 9c368c7: `fieldCryptoForTenant(kms, tenantId, opts?)` returns a `TenantFieldCrypto`, a FieldCrypto bound to one validated tenant id (`tnt_` and a ULID) with the tenant key-id convention of the KMS adapter (`tenantFieldKeyId`: LocalKms `local:tenant:<id>`, AWS KMS `alias/ipb/tenant/<id>`, Vault Transit `tenant-<id>`); calls for another tenant and unknown adapters are refused (PR-LDC-16; R1-D-73).
- 9c368c7: `EcosystemInbox.receive` takes `exclusiveWith`: event types sharing a business key of which only the first stored is processed, as Ecosystem Spec v1.3 requires for one provisioning request (R1-D-70).

### Patch Changes

- Updated dependencies [9c368c7]
- Updated dependencies [9c368c7]
  - @infrabyx/contracts@1.18.0
  - @infrabyx/config@1.9.2
  - @infrabyx/crypto@1.5.3

## 1.10.1

### Patch Changes

- Updated dependencies [714ad01]
  - @infrabyx/contracts@1.17.0
  - @infrabyx/config@1.9.1
  - @infrabyx/crypto@1.5.2

## 1.10.0

### Minor Changes

- b3edda2: `TenantBootstrap` (PR-LDC-12, R1-D-67): creates a tenant for a provisional id with its initial settings, the product's first rows and its first ledger entry in one transaction; idempotent per id; `bootstrap` refused in prod, dr and pre-prod, `provision` for the Operations Hub adapter in every environment.
- b3edda2: `ApprovalsEngine.consumeMandateApproval` and `mandateVerifier` (R1-D-66): an approved `payments.mandate.change` request at R3 or above is consumed once, under the row lock and with a ledger entry, only for the same tenant, operation, mandate and amount; the action is registered by the engine and never executed on approval or by hand.

### Patch Changes

- Updated dependencies [b3edda2]
- Updated dependencies [b3edda2]
- Updated dependencies [b3edda2]
  - @infrabyx/config@1.9.0
  - @infrabyx/contracts@1.16.0
  - @infrabyx/crypto@1.5.1

## 1.9.2

### Patch Changes

- Updated dependencies [fdd1f1a]
- Updated dependencies [ed143e3]
  - @infrabyx/config@1.8.0

## 1.9.1

### Patch Changes

- Updated dependencies [2a95100]
- Updated dependencies [2a95100]
  - @infrabyx/config@1.7.0
  - @infrabyx/crypto@1.5.0

## 1.9.0

### Minor Changes

- 7910610: Ambient mutations and principal-bound idempotency keys (Udofin PR-UDF-033; Finbyx PR-FBX-21; IPB-10-07; R1-D-48). `PgKernel.ambient(ctx, fn, opts)` opens a mutation that every `mutate` on the same kernel joins in a kernel savepoint with its own settings and ledger check, so `idempotent()` covers handlers whose services open their own mutations; a joined call must be the same tenant, principal, scope and grant, and joined calls run one at a time. Migration `tenancy/0015` adds `principal_id` to `tenancy.idempotency_key`: another principal presenting a key gets 409 IPB-PORT-004. `idempotencyRequestHash(method, route, body, { params })` and `IdempotencyKeyInterceptor` hash the route parameters. Run `infrabyx-migrate`.
- 05c3122: Officer functions per legal entity (Finbyx PR-FBX-31; IPB-02-33; R1-D-46). Migrations `tenancy/0013` (`entity_ref`, `register_ref`, `single_holder` and `revoke_request_id` on `tenancy.function_assignment`) and `tenancy/0014` (a unique partial index built concurrently: one active single-holder row per tenant, function and entity). `TenantFunctions` takes `policies` per function (`FunctionPolicy`: `perEntity`, `singleHolder`, `checkedRevocation`, `registerRequired`; `OFFICER_POLICY` sets all four). `requestAssign` takes `entityRef` and `registerRef`; `requestRevoke` raises an R3 `tenancy.function.revoke` request, and `revoke` refuses a function with `checkedRevocation`; `withFunctions` counts a per-entity function only in `ctx.entityId`; `authzAttributes(ctx)` lists each function's entities for AUTHZ. Without a policy a function behaves as before. Run `infrabyx-migrate`.

### Patch Changes

- 0da0398: `infrabyx-migrate` runs a file marked `-- infrabyx:no-transaction` one statement at a time (Udofin PR-UDF-031; R1-D-44). PostgreSQL runs a multi-statement query as one implicit transaction, so a lint-clean `CREATE INDEX CONCURRENTLY` on an existing table failed with "cannot run inside a transaction block". A failure part-way names how many statements ran; the file stays unrecorded and the next run repeats it from the start, so write such files to be re-runnable. `splitStatements(sql)` is exported from `@infrabyx/tenancy/migrate`.
- Updated dependencies [1b99d7a]
- Updated dependencies [c83e9e0]
- Updated dependencies [af2ae98]
- Updated dependencies [c4117e4]
- Updated dependencies [1e721cd]
- Updated dependencies [854e309]
- Updated dependencies [854e309]
  - @infrabyx/contracts@1.15.0
  - @infrabyx/config@1.6.0
  - @infrabyx/crypto@1.4.0

## 1.8.0

### Minor Changes

- e41c3bd: External grants opened from a product's own approvals (Finbyx PR-FBX-22; IPB-08-19; R1-D-40). Migration `tenancy/0012` adds `source`, `source_approval_id`, `pii_level` (none, masked, full) and `export_allowed` to `tenancy.external_grant` (existing grants read as masked, no export), `tenancy.external_grant_source` (one grant per product approval in a tenant), and `tenancy.external_pii_level()` and `tenancy.external_export_allowed()` for a product's policies and export gate. `ExternalGrants.fromApproved(tx, …)` opens an active grant in the transaction of the product's executor with its approval id, maker and checker (different people), the mapped grantee kind and at most 90 days; `revokeFromApproved` revokes it at once. Run `infrabyx-migrate`.
- 92706c4: Kernel-owned nested units (Finbyx PR-FBX-30; IPB-02-51; R1-D-41). A mutation's `tx.unit(fn)` opens a savepoint the kernel names, runs `fn`, and releases it, or rolls back to it when `fn` throws and returns `{ ok: false, error }`, so one failed item of a batch rolls back alone (with its ledger entries and outbox rows) and the transaction carries on. A rolled-back unit's ledger entry no longer counts for the commit check. Callers still cannot issue `SAVEPOINT` or `RELEASE` themselves; read transactions have no units; at most 100,000 units per transaction.
- d66ffad: Named tenant functions under maker-checker (Finbyx PR-FBX-20; IPB-02-33; R1-D-39). Migration `tenancy/0011` adds `tenancy.function_assignment`. `TenantFunctions` assigns `FN:CRO`, `FN:CCO`, `FN:COMPLIANCE_OFFICER` and a product's own functions through an approved R3 `tenancy.function.assign` request (an ORG_OWNER or ORG_ADMIN asks, a different one approves, never the assignee), revokes at once with a reason, and `withFunctions(ctx)` adds the person's active functions to the session's roles (dropping any a token claimed). `ApprovalsEngine` honours an action's `checkerFunctions` and the tenant's `FN:` entries in `mc.checker_roles.<action>` (tighten-only; `checkerFunctionsFor`), and `ApprovalWorkflow` sends inbox items to the function holders. `contracts`: `FUNCTION_ROLE_REGEX`, `PLATFORM_FUNCTIONS`, `isFunctionRole`, and `FN:` roles in `RoleSchema`. Run `infrabyx-migrate`.

### Patch Changes

- Updated dependencies [97e8524]
- Updated dependencies [92706c4]
- Updated dependencies [4a87754]
- Updated dependencies [d66ffad]
  - @infrabyx/contracts@1.14.0
  - @infrabyx/config@1.5.2
  - @infrabyx/crypto@1.3.1

## 1.7.2

### Patch Changes

- Updated dependencies [32b53ee]
- Updated dependencies [cff2a02]
  - @infrabyx/crypto@1.3.0
  - @infrabyx/contracts@1.13.0
  - @infrabyx/config@1.5.1

## 1.7.1

### Patch Changes

- Updated dependencies [63c5ad2]
- Updated dependencies [63c5ad2]
  - @infrabyx/config@1.5.0
  - @infrabyx/contracts@1.12.0
  - @infrabyx/crypto@1.2.7

## 1.7.0

### Minor Changes

- 2e3a2d3: Break-glass visible to the tenant (Finbyx PR-FBX-10 item 3; R1-D-28). The kernel records each use of a break-glass grant in the tenant it touches (migration `tenancy/0009`, `tenancy.breakglass_use`, readable by the tenant, written only by definer functions). `BreakGlassTenantNotices` lists the uses and raises `BreakGlassUsed` once per grant for the product to notify.
- 3f20011: External read access (Finbyx PR-FBX-10 item 5; R1-D-29). Migration `tenancy/0010` adds the SELECT-only, switch-only `app_external` role, the `tenancy.external_grant` table and `tenancy.external_allows()` for products' restrictive policies. `ExternalGrants` requests, approves (a second ORG_OWNER or ORG_ADMIN), revokes and lists grants; `ExternalReads` is the one way an external grantee reads, with a ledger entry per read; `externalContext` builds its context. rls-lint gains the `external-read` rule.

### Patch Changes

- Updated dependencies [2e3a2d3]
- Updated dependencies [3f20011]
  - @infrabyx/contracts@1.11.0
  - @infrabyx/config@1.4.1
  - @infrabyx/crypto@1.2.6

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
