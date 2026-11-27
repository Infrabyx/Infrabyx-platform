# @infrabyx/tenancy

## 1.30.3

### Patch Changes

- Updated dependencies [bdd282a]
  - @infrabyx/contracts@1.55.0
  - @infrabyx/config@1.24.9
  - @infrabyx/crypto@1.15.7

## 1.30.2

### Patch Changes

- Updated dependencies [c45aaa0]
- Updated dependencies [4e319d1]
  - @infrabyx/config@1.24.8
  - @infrabyx/contracts@1.54.0
  - @infrabyx/crypto@1.15.6

## 1.30.1

### Patch Changes

- Updated dependencies [f4f525b]
  - @infrabyx/contracts@1.53.0
  - @infrabyx/config@1.24.7
  - @infrabyx/crypto@1.15.5

## 1.30.0

### Minor Changes

- 591ff53: An unsigned partner original in the inbox (Udofin PR-UDF-085; R1-D-288). `EcosystemInbox.receive(ctx, mapped, { original })` without a `jws` keeps the original after the same checks, REGULATED, written once and with the JWS's reader roles; `ReceiveResult.originalSigned` and `InboxEvent.originalSigned` (`false` for unsigned, `null` with no original) and `originalRecordOf` (`{ original, signed }`) say which, and nothing claims a signature for it. Migration `tenancy/0033` drops 0029's original-with-JWS check; existing rows are untouched.

## 1.29.1

### Patch Changes

- Updated dependencies [95acbf9]
  - @infrabyx/contracts@1.52.0
  - @infrabyx/config@1.24.6
  - @infrabyx/crypto@1.15.4

## 1.29.0

### Minor Changes

- c07aefe: Two tenant approvers for a scoped `read` break-glass grant (owner addition (A) to #203; R1-D-286): `PgKernelOptions.breakGlassTenantApproversForRead` (1, the default, or 2). With 2 a `read` grant needs two different ORG_OWNER/ORG_ADMIN approvers, as `read_write` does, enforced by the kernel at use; `BreakGlassTenantApproval` takes the kernel's value. Migration `tenancy/0032` loosens two checks of 0031 so a `read` row may hold a second approver, and lets a second manager complete an earlier single `read` approval without lengthening it.

## 1.28.0

### Minor Changes

- fc9e98c: R1-D-284 (Finbyx PR-FBX-55). A scoped break-glass grant under the tenant's own control: migration `tenancy/0031` adds `tenancy.breakglass_tenant_approval` (forced RLS; a trigger lets only the acting tenant manager write a decision) and the definer `tenancy.breakglass_tenant_pending()`; `BreakGlassTenantApproval` (`pending`, `approve`, `refuse`, `revoke`, `status`) lets the tenant's ORG_OWNER or ORG_ADMIN approve a scoped grant (two different managers for `read_write`), at most for the grant's duration, refuse it or revoke at once, ledgered in the tenant. The kernel always refuses a scoped grant its tenant refused or revoked, and with the new `PgKernelOptions.requireTenantApprovedBreakGlass` (default false) any scoped grant without a live tenant approval: `IPB-SEC-005`, `meta.refusal` `tenant_approval`, ledgered in the tenant, not recorded as a use. Unscoped break-glass is unchanged. `SupportGrant.tenantApproved` is new. `@infrabyx/contracts`: the internal events `BreakGlassTenantApproved` and `BreakGlassTenantRevoked`. Product step: run `infrabyx-migrate` (0031), add the tenant's page and set the option (guide §7ev).

### Patch Changes

- Updated dependencies [fc9e98c]
  - @infrabyx/contracts@1.51.0
  - @infrabyx/config@1.24.5
  - @infrabyx/crypto@1.15.3

## 1.27.0

### Minor Changes

- 061f0d4: R1-D-283 (owner answer #201 (1), PR-UDF-083). The partner's original signed body is `REGULATED`, the class of the mapped `envelope` whose lender data it carries: migration `tenancy/0030` replaces `tenancy.add_ecosystem_inbox_original(...)` so new inboxes tag `<schema>.eco_inbox.original` `dataclass:REGULATED`, and retags the column of every inbox where tenancy 0029's `dataclass:INTERNAL` stands (a class a product set itself is left). A comment change only: the column, checks, trigger, grants and readers are 0029's. Product step: run `infrabyx-migrate` (0030); export, masking and AI-routing rules that read column classes now treat `original` as `envelope` (guide §7eu).

## 1.26.0

### Minor Changes

- 613e0e0: R1-D-280 (PR-UDF-084). An inbox's JWS can be narrowed to named roles: migration `tenancy/0028` adds `tenancy.restrict_ecosystem_inbox_jws('<schema>', array[<roles>])` (run from the product's own migration; app_rw and app_ro then select every column of `<schema>.eco_inbox` but `jws`), `tenancy.refresh_ecosystem_inbox_jws_grants()`, the registry `tenancy.eco_inbox_jws_reader` and the definers `tenancy.eco_inbox_jws(...)` and `tenancy.eco_inbox_jws_readable(...)` (allow-listed in the RLS lint). The kernel now sets `app.roles` from the verified context (well-formed role names only). `EcosystemInbox` reads `jws` only through the definer, so `receive`, `drain`, `sweep` and `list` behave as before on an inbox that is not restricted; new `jwsOf(ctx, source, eventId)` refuses a non-reader with `IPB-UX-011` (`INBOX_JWS_REFUSED`). Product step: run `infrabyx-migrate` (0028) before deploying this version, as `EcosystemInbox` calls the new functions; nothing is restricted until your migration asks for it (guide §7et).
- 90ffc18: R1-D-281 (PR-UDF-083). The inbox can keep a partner's original signed body beside the mapped event: migration `tenancy/0029` adds the nullable, write-once `<schema>.eco_inbox.original jsonb` (a JSON object of at most 262,144 octets, only with a JWS) to every inbox, `tenancy.add_ecosystem_inbox_original(...)`, and the definer `tenancy.eco_inbox_original(...)` (allow-listed in the RLS lint); a restricted inbox keeps `original` to the JWS's reader roles. `EcosystemInbox.receive(ctx, mapped, { jws, original })` refuses an original that is not an envelope, is too long or differs from the mapped event outside `data` (IPB-API-018, `meta.reason` `original-malformed`, `original-too-long`, `original-mismatch`), verifies the JWS over the original and stores both. `ReceiveResult` gains `original` (null without one), `InboxEvent` an optional `original`; new `originalOf(ctx, source, eventId)`, `INBOX_ORIGINAL_MAX_OCTETS` and `jsonbTextOctets`. Product step: run `infrabyx-migrate` (0029) before deploying this version, as `EcosystemInbox` writes and reads the new column (guide §7eu).

### Patch Changes

- Updated dependencies [9abffba]
  - @infrabyx/contracts@1.50.0
  - @infrabyx/config@1.24.4
  - @infrabyx/crypto@1.15.2

## 1.25.0

### Minor Changes

- a37e9fe: Finbyx PR-FBX-54 (R1-D-273): a scoped branch read inside a mutation. An approval executor gets a fourth argument, `kernel` (`ApprovalExecutorKernel`), whose `scopedBranchRead({ branchIds, reason }, fn)` runs `fn` read-only inside the executing transaction (a read unit as the read role, `transaction_read_only`, always rolled back) under the executor's context with its branch scope set to exactly the named branches (`allBranches` false, no current branch); it is bound to that one execution and refused once the executor returns. A capability named in the new `PgKernelOptions.scopedBranchReadCapabilities` is issued once by `kernel.scopedBranchReadCapability(name)` for the same call outside an executor (`cap.scopedBranchRead(tx, opts, fn)`); an ordinary request's `Tx` has no way in, and only a mutation transaction the kernel opened (or a joined call on one) is accepted. Every named branch (1 to 1000 distinct ids) must be granted to the caller: the new `PgKernelOptions.branchGrants(tx)` returns every branch the principal holds a grant on, closed ones included; without it the context's own `allBranches` or `branchIds` are the grants. The reason (1 to 500 characters, no control character) is required. Each read is ledgered `security.branch_scope.read` in the mutation's own transaction (it commits or rolls back with the mutation and does not count as the mutation's own ledger entry), naming the branches, the reason and the approval request (its business id) or the capability. A refusal is `IPB-SEC-005` with a fixed `meta.refusal` (`principal`, `branch_ids`, `reason`, `grants`, `ungranted`), ledgered `security.branch_scope.read_refused` after the transaction ends. Agents, support access, break-glass, service readers, external principals, impersonation and platform scope are refused. Writes inside are refused by PostgreSQL; units, nested scoped reads and any other statement on the mutation's transaction are refused while the read is open; the refusal of product code setting `app.*` is unchanged. Works inside `kernel.ambient` (the read takes its turn). New exports: `SCOPED_BRANCH_READ_ACTION`, `SCOPED_BRANCH_READ_REFUSED_ACTION`, `SCOPED_BRANCH_READ_REFUSALS`, `MAX_SCOPED_BRANCH_READ_REASON`, `BRANCH_ID_PATTERN`, `MAX_BRANCH_IDS` and the types `ScopedBranchReadOptions`, `ScopedBranchReadCapability`, `BranchGrantSource`, `ApprovalExecutorKernel`. No migration, setting or environment variable.

### Patch Changes

- Updated dependencies [4fbcf73]
  - @infrabyx/contracts@1.49.0
  - @infrabyx/config@1.24.3
  - @infrabyx/crypto@1.15.1

## 1.24.1

### Patch Changes

- Updated dependencies [e98dfeb]
- Updated dependencies [24c16c4]
- Updated dependencies [5fc6afe]
- Updated dependencies [daa13b9]
  - @infrabyx/crypto@1.15.0
  - @infrabyx/contracts@1.48.0
  - @infrabyx/config@1.24.2

## 1.24.0

### Minor Changes

- cb859aa: Finbyx PR-FBX-53 (R1-D-266): the outbox relay keeps going past a row it cannot deliver. Each row's delivery is its own unit: a failure is counted on that row (`attempts`) and the rest of the batch is delivered and marked dispatched in the same commit; after `maxAttempts` failed attempts (new option, 1 to 100, default 5, `DEFAULT_OUTBOX_MAX_ATTEMPTS`) the row is parked in `tenancy.outbox_parked` (migration `tenancy/0027`, expand-only) with a fixed reason (`queue_refused`, `queue_unavailable`, `delivery_failed`; `OUTBOX_PARK_REASONS`, `outboxFailureReason`) and its attempt count, ledgered as `<schema>.outbox.park`, and skipped by every later pass. The batch's `<schema>.outbox.dispatch` entry gains `failed` and `parked` counts when a row failed. New `onFailure` option for the operational log. `OutboxParking` lists a tenant's parked rows and `requeue(ctx, schema, eventId)` hands one back with a fresh attempt budget: a ledgered mutation (`tenancy.outbox.requeue`) by a person holding `ORG_OWNER` or `ORG_ADMIN` (option `requeueRoles`). `outboxEventJob(event)` builds the QUEUE job (`eventJobName(type)` as the name, the full type in the data). Apply `tenancy/0027` before deploying the new relay.

### Patch Changes

- Updated dependencies [5ee71f6]
  - @infrabyx/contracts@1.47.0
  - @infrabyx/config@1.24.1
  - @infrabyx/crypto@1.14.1

## 1.23.1

### Patch Changes

- Updated dependencies [2769b78]
- Updated dependencies [5aba118]
- Updated dependencies [2a0ea72]
- Updated dependencies [21a2bc4]
- Updated dependencies [ef3adc2]
- Updated dependencies [01f9313]
- Updated dependencies [200a8a4]
  - @infrabyx/config@1.24.0
  - @infrabyx/contracts@1.46.0
  - @infrabyx/crypto@1.14.0

## 1.23.0

### Minor Changes

- a107b8d: `EcosystemInbox.receive` verifies a regulated message's detached JWS and keeps it beside the event (Udofin PR-UDF-073; R1-D-257). With the new `regulated: { keys, replay }` option, `receive(ctx, envelope, { jws })` checks the `X-Infrabyx-JWS` value against the envelope's limits (compact detached, at most 1,024 octets), verifies it with `verifyRegulatedMessage`, and stores it in the new nullable `eco_inbox.jws` column; a failure is IPB-API-018 (`signature-invalid`) and nothing is stored. Handlers and `list` get `event.jws`; `receive` answers the stored JWS (the first one for a duplicate). Migration `tenancy/0026` adds the column to every existing inbox and to new ones, with a CHECK on its length and form and a trigger that refuses any later change (written once). Run `infrabyx-migrate`; pass the header value to `receive` instead of verifying it yourself first.

### Patch Changes

- Updated dependencies [75cbd9a]
- Updated dependencies [beca045]
- Updated dependencies [5b1257d]
- Updated dependencies [199c930]
- Updated dependencies [27057c2]
- Updated dependencies [a702fdc]
- Updated dependencies [f3293a2]
  - @infrabyx/contracts@1.45.0
  - @infrabyx/crypto@1.13.0
  - @infrabyx/config@1.23.1

## 1.22.2

### Patch Changes

- Updated dependencies [d4636a3]
- Updated dependencies [ae319d5]
- Updated dependencies [2d543fe]
- Updated dependencies [98a1d62]
- Updated dependencies [461fe2c]
  - @infrabyx/contracts@1.44.0
  - @infrabyx/config@1.23.0
  - @infrabyx/crypto@1.12.0

## 1.22.1

### Patch Changes

- Updated dependencies [648c511]
- Updated dependencies [9be2fc7]
- Updated dependencies [f0edee3]
- Updated dependencies [2d2729b]
  - @infrabyx/crypto@1.11.0
  - @infrabyx/contracts@1.43.0
  - @infrabyx/config@1.22.3

## 1.22.0

### Minor Changes

- 206b3c1: `PgKernel.ambient` (Udofin PR-UDF-062; R1-D-237): a `mutate` by another principal of the ambient call's tenant now joins in a savepoint with its own `app.*` settings and ledger entries, and the settings of the call it was made from come back on every path; with `joinReads` its reads join the same way. Another tenant's `mutate` or `read` runs in its own transaction, as if no ambient mutation were open. Concurrent joined calls are queued and run one at a time in order instead of being refused; a call made inside a running joined call runs at once, and the ambient callback's own statements wait while a joined call runs. Still refused: another principal when it or the ambient call carries a break-glass grant or support access, an external principal or service reader, another scope, and a role other than the app role. No migration, setting or type change.

### Patch Changes

- Updated dependencies [2cb5b3f]
- Updated dependencies [a38f921]
- Updated dependencies [f62dcaa]
- Updated dependencies [dbb08e6]
  - @infrabyx/contracts@1.42.0
  - @infrabyx/crypto@1.10.0
  - @infrabyx/config@1.22.2

## 1.21.4

### Patch Changes

- Updated dependencies [98c9416]
  - @infrabyx/contracts@1.41.0
  - @infrabyx/config@1.22.1
  - @infrabyx/crypto@1.9.2

## 1.21.3

### Patch Changes

- Updated dependencies [053e16a]
- Updated dependencies [ce8ca22]
- Updated dependencies [b135555]
- Updated dependencies [48810fd]
- Updated dependencies [1ffb012]
  - @infrabyx/contracts@1.40.0
  - @infrabyx/config@1.22.0
  - @infrabyx/crypto@1.9.1

## 1.21.2

### Patch Changes

- Updated dependencies [5fd012a]
- Updated dependencies [3b57c29]
- Updated dependencies [4d509e6]
  - @infrabyx/contracts@1.39.0
  - @infrabyx/crypto@1.9.0
  - @infrabyx/config@1.21.0

## 1.21.1

### Patch Changes

- Updated dependencies [3c4b588]
  - @infrabyx/contracts@1.38.0
  - @infrabyx/crypto@1.8.0
  - @infrabyx/config@1.20.1

## 1.21.0

### Minor Changes

- 1cdbf0f: Reads joined to an ambient mutation (Udofin PR-UDF-037; R1-D-188). `PgKernel.ambient(ctx, fn, { joinReads: true })` (`AmbientOptions`) makes each `read` inside `fn` for the same tenant, principal, scope and grant run on the ambient transaction, so it sees that transaction's uncommitted writes: read-only, as the read role, with its own `app.*` settings, in a savepoint that is always rolled back, and one at a time with the joined mutations. Snapshot, support, external and platform service reads, and reads for another tenant or principal, keep their own transaction. Without `joinReads` nothing changes.
- 62dc1eb: The approvals a signed-in checker may check, paged (Udofin PR-UDF-047; R1-D-200). `ApprovalsEngine.listCheckable(ctx, { cursor?, limit? }) → { items: CheckableApproval[], nextCursor }` lists the tenant's pending, unexpired requests that the principal may decide now: never their own (maker ≠ checker), never one they have decided, and only where `decide`'s own rule lets them (the action's checker roles after the tenant's `mc.checker_roles` narrowing and its checker functions, and for a levelled request the open level's roles). An agent gets an empty list. `CheckableApproval` carries `id`, `action`, `summary`, `riskClass`, `makerId`, `createdAt`, `expiresAt`, `currentLevel`, `requiredCheckers` and `approvals`; never the payload, its digest or data class, or the diff. Oldest first, keyset pages on `(created_at, id)`, `limit` 1 to `CHECKABLE_MAX_LIMIT` (100, default `CHECKABLE_DEFAULT_LIMIT` 25), an opaque base64url `nextCursor`; a bad cursor or limit is refused with a `RangeError` before any read. Read through the kernel, so RLS keeps it to the tenant. `decide` now takes its checker rule from the same private function the list uses; who may check, the levels and every decision path are unchanged. Migration `tenancy/0025` adds a partial keyset index on pending, unexpired requests, built concurrently (run `infrabyx-migrate`; no column, policy or grant changes, export map unchanged).

### Patch Changes

- Updated dependencies [82dc7ef]
- Updated dependencies [1cdbf0f]
- Updated dependencies [2f9d3f8]
- Updated dependencies [b0e0b72]
- Updated dependencies [9e626ef]
- Updated dependencies [aac1c2c]
- Updated dependencies [d58d5f0]
- Updated dependencies [dbaecff]
- Updated dependencies [80a843a]
- Updated dependencies [1cdbf0f]
- Updated dependencies [ff2a74b]
- Updated dependencies [d35f7e9]
  - @infrabyx/contracts@1.37.0
  - @infrabyx/crypto@1.7.0
  - @infrabyx/config@1.20.0

## 1.20.7

### Patch Changes

- Updated dependencies [4af2688]
- Updated dependencies [955cc67]
  - @infrabyx/contracts@1.36.0
  - @infrabyx/config@1.19.0
  - @infrabyx/crypto@1.6.2

## 1.20.6

### Patch Changes

- Updated dependencies [a6929eb]
  - @infrabyx/contracts@1.35.0
  - @infrabyx/config@1.18.1
  - @infrabyx/crypto@1.6.1

## 1.20.5

### Patch Changes

- Updated dependencies [3e69471]
- Updated dependencies [3e69471]
- Updated dependencies [3e69471]
  - @infrabyx/config@1.18.0
  - @infrabyx/contracts@1.34.0
  - @infrabyx/crypto@1.6.0

## 1.20.4

### Patch Changes

- Updated dependencies [34f5e49]
- Updated dependencies [34f5e49]
  - @infrabyx/config@1.17.0
  - @infrabyx/contracts@1.33.0
  - @infrabyx/crypto@1.5.18

## 1.20.3

### Patch Changes

- Updated dependencies [6bb68c1]
- Updated dependencies [6bb68c1]
  - @infrabyx/config@1.16.0
  - @infrabyx/contracts@1.32.0
  - @infrabyx/crypto@1.5.17

## 1.20.2

### Patch Changes

- Updated dependencies [32097cb]
  - @infrabyx/contracts@1.31.0
  - @infrabyx/config@1.15.2
  - @infrabyx/crypto@1.5.16

## 1.20.1

### Patch Changes

- Updated dependencies [c79fef5]
  - @infrabyx/contracts@1.30.0
  - @infrabyx/config@1.15.1
  - @infrabyx/crypto@1.5.15

## 1.20.0

### Minor Changes

- 1089dc7: Ordered approval levels (#125, PR-LDC-38; migration `tenancy/0023`): decided in order, tighten-only, a different person at every level, any rejection ends the request, the delay from the last level. `ApprovalRecord` gains `levels`, `currentLevel` and `currentLevelApprovals`.
- 1089dc7: `ApprovalsEngine.cancelIn(tx, id, reason)`: cancel inside the caller's transaction with `cancel`'s rules, a required reason and never an agent; `cancel` takes an optional reason; `ApprovalRecord.cancelReason`. Migration `tenancy/0022` adds the nullable `cancel_reason` column (PR-LDC-37).
- 1089dc7: The shared rate limiter (PR-LDC-54; migration `tenancy/0024`): `RateLimiter.hit` and `consume` count per tenant, bucket, keyed-hashed key and fixed window in PostgreSQL (no ledger row per hit; the `svc_rate_limit` role may only count), `rateLimitError` (429 `IPB-SEC-019`) and `rateLimitHeaders`; `RateLimitSweep` deletes only fully expired windows with one ledger entry per run (owner answer #129).

### Patch Changes

- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
  - @infrabyx/contracts@1.29.0
  - @infrabyx/config@1.15.0
  - @infrabyx/crypto@1.5.14

## 1.19.0

### Minor Changes

- 15be78b: `ApprovalsEngine.cancelIn(tx, id, reason)`: cancel inside the caller's transaction with `cancel`'s rules, a required reason and never an agent; `cancel` takes an optional reason; `ApprovalRecord.cancelReason`. Migration `tenancy/0022` adds the nullable `cancel_reason` column (PR-LDC-37).

### Patch Changes

- Updated dependencies [15be78b]
- Updated dependencies [15be78b]
- Updated dependencies [15be78b]
- Updated dependencies [15be78b]
- Updated dependencies [15be78b]
  - @infrabyx/contracts@1.28.0
  - @infrabyx/config@1.14.0
  - @infrabyx/crypto@1.5.13

## 1.18.2

### Patch Changes

- Updated dependencies [043a348]
- Updated dependencies [043a348]
- Updated dependencies [043a348]
  - @infrabyx/contracts@1.27.0
  - @infrabyx/config@1.13.4
  - @infrabyx/crypto@1.5.12

## 1.18.1

### Patch Changes

- 0aa0f1d: Register `tenancy.outbox` for the outbox relay (`tenancy` migration `register_outbox`; LawDocsComply PR-LDC-35, R1-D-112). The outbox was never registered, so `OutboxRelay` neither found nor delivered its events; run `infrabyx-migrate` and the next relay pass delivers the backlog.
- Updated dependencies [0aa0f1d]
- Updated dependencies [0aa0f1d]
  - @infrabyx/config@1.13.3
  - @infrabyx/contracts@1.26.0
  - @infrabyx/crypto@1.5.11

## 1.18.0

### Minor Changes

- 496180e: Wave 11: module lifecycle and tenant entitlements (Finbyx PR-FBX-43; OWNER-QUESTIONS #123; R1-D-107; R1-plan M76).

  - **`tenancy`:** `tenancy/0020` and `TenantEntitlements`. A licence change is a request and an approval by two different people, both ledgered: requested by PLT_SUPER_ADMIN or PLT_FINANCE, approved by a different PLT_SUPER_ADMIN or PLT_SECURITY_OFFICER (never the requester, a tenant user, a support role or an impersonation); R3 outside production, R4 (60-minute delay) in production; applied once. Versions and notices are insert-only and written only on the platform's approved path. The tenant is told of every grant, revocation and lapse (`onNotice`, `forTenant`); a lapsed or revoked licence refuses writes (`assertWritableIn`, `tenancy.entitlement_status(sku)`) and keeps every record readable. `recordLapses` is the daily sweep.
  - **`contracts`:** the platform role `PLT_FINANCE`; `@infrabyx/contracts/module-lifecycle` (the Spec §11.1 lifecycle and edges, `AttachableModule`, `EntitlementChangeInput`, `entitlementStatusOn`, the guard codes); the `ModuleAttached`, `ModuleDetached` and `LegalHoldChanged` schemas (Spec §6.14, §6.16); id prefixes `lic` and `lcn`.

### Patch Changes

- Updated dependencies [496180e]
  - @infrabyx/contracts@1.25.0
  - @infrabyx/config@1.13.2
  - @infrabyx/crypto@1.5.10

## 1.17.0

### Minor Changes

- e86dedf: Wave 10 (R1-plan M72 to M74).

  - **`audit`: retire an empty capture table (OWNER-QUESTIONS #122, R1-D-102; Finbyx PR-FBX-39).** `audit/0008` adds `audit.retire_capture(regclass)`: for `app_migrate` only, only inside a migration applied by the platform runner, refused unless the registered table has no rows. It writes the retirement into the capture chain (`audit.capture_retirement`, itself captured, action `audit.capture.retire`), keeps every capture row, ends the registration, and lets the drop guard admit the drop of that one table in the same transaction only; the commit fails if the table is not dropped. Every other drop is still refused. Use: `select audit.retire_capture('<schema>.<table>'); drop table <schema>.<table>;` in one migration. Install `audit/0008` as the database owner, as `audit/0003`.
  - **`tenancy`: one tenant-id rule (Finbyx PR-FBX-40, R1-D-103).** `tenancy/0019` refuses a tenant id other than `tnt_` followed by 1 to 60 lower-case letters and digits, or a ULID; it first checks the existing tenants and stops, naming them, if one breaks the rule. The migration runner sets `ipb.migration` to the file it applies, for that file's transaction.
  - **`contracts`:** `TENANT_ID_REGEX`, `TENANT_ID_PATTERN`, `isTenantId`; every id they admit fits every port's storage prefix. Three new ports, interfaces only (R1-D-104): DISPATCH (`DispatchPort`, ADR-0008, Finbyx PR-FBX-41), COURT_DATA (`CourtDataPort`, ADR-0009, PR-FBX-42) and ODR (`OdrPort`, ADR-0010, PR-FBX-44; Ecosystem Spec 8.9), with catalogue rows.
  - **`testing`:** `FakeDispatch`, `FakeCourtData`, `FakeOdr`, `equatorOdrStub()` (with the group-company disclosure) and the three contract suites.
  - **`workflow`:** timer ids follow the tenant-id rule.

### Patch Changes

- Updated dependencies [e86dedf]
  - @infrabyx/contracts@1.24.0
  - @infrabyx/config@1.13.1
  - @infrabyx/crypto@1.5.9

## 1.16.1

### Patch Changes

- Updated dependencies [d3888de]
  - @infrabyx/config@1.13.0

## 1.16.0

### Minor Changes

- 67be297: Sandbox changes in production are R4 (OWNER-QUESTIONS #118, R1-D-96): `TenantSandbox` takes the deployment's `appEnv`; a change to a tenant of a production deployment (`prod`, `dr`, `pre-prod`), or when `appEnv` is not given, is raised at R4, so it can be applied only 60 minutes after its approval, in either direction; in any other environment it stays R3 (one approver, no delay). `sandboxChangeRisk(appEnv)` is exported.

### Patch Changes

- Updated dependencies [67be297]
- Updated dependencies [67be297]
- Updated dependencies [67be297]
  - @infrabyx/contracts@1.23.0
  - @infrabyx/config@1.12.1
  - @infrabyx/crypto@1.5.8

## 1.15.0

### Minor Changes

- 3c9bb25: Sandbox changes under maker-checker (OWNER-QUESTIONS #115, R1-D-95). Taking a tenant into or out of the sandbox is now `TenantSandbox.request(caller, tenantId, sandbox, reason)` by a PLT_SUPER_ADMIN (an R3 approval request in that tenant), `decide(...)` by a different platform approver (PLT_SUPER_ADMIN or PLT_SECURITY_OFFICER, in a platform context only), then `apply(caller, tenantId, requestId)` by a PLT_SUPER_ADMIN, which uses the approval once and sets the flag in one ledgered `tenancy.tenant.sandbox.set` transaction (the ledger keeps the reason and the request id). `TenantSandbox.set` is refused (`IPB-SEC-005`); `TenantSandbox` takes the `approvals` engine. `ApprovalsEngine.consumeIn(tx, id, action)` uses an approved request once inside the caller's own transaction. A sandbox flag set at tenant creation is unchanged.

### Patch Changes

- Updated dependencies [3c9bb25]
- Updated dependencies [3c9bb25]
- Updated dependencies [3c9bb25]
  - @infrabyx/config@1.12.0
  - @infrabyx/contracts@1.22.0
  - @infrabyx/crypto@1.5.7

## 1.14.1

### Patch Changes

- bc2c301: Security fix (R1-D-92): no statement can run on a kernel transaction's connection after the transaction has ended. A `tx` used after its `mutate` or `read` returned is refused with `KernelGuardError`; an ambient mutation waits for every joined call still running before it ends, fails when one was, and refuses a joined call that starts after it ended. Before this fix, a joined call left running when its ambient mutation ended (a sibling of a refused call, or one not awaited) could run its next statements on the pooled connection's next transaction, which may belong to another tenant.

## 1.14.0

### Minor Changes

- 1dda4b2: Approval expiry from a product setting (OWNER-QUESTIONS #106; LawDocsComply PR-LDC-19; R1-D-89): the new registered key `mc.expiry_hours.{action}` (TENANT tier, 1 to 168 hours, tighten-only, R4) is read by `settingsApprovalPolicy` as `TenantApprovalPolicy.expiryHours`, and `ApprovalsEngine` uses it only to shorten the action's platform expiry, clamped to [1 hour, the platform period]; it never lengthens it. `expiryHoursFor(risk, financial, tenantHours?)` and `APPROVAL_MIN_EXPIRY_HOURS` are exported.
- 1dda4b2: Sandbox tenants (LawDocsComply PR-LDC-29; R1-plan M60; R1-D-87), failing closed.

  - `contracts`: `KernelContext.sandbox`, set by the kernel only and never trusted from a caller, and
    `isSandboxed(ctx)`, true unless the kernel read the tenant's flag as false; the `sandboxed`
    delivery state.
  - `tenancy`: migration 0018 adds `tenancy.tenant.sandbox` (default false), `tenancy.tenant_sandbox()`
    for the kernel and a trigger that lets only a platform context carrying the action
    `tenancy.tenant.sandbox.set` change it. `PgKernel` reads the flag once per read and mutate
    transaction into `tx.ctx.sandbox`, overwriting whatever the caller passed (absent when there is
    no tenant row). `TenantBootstrap` takes `sandbox`; `TenantSandbox.set` (PLT_SUPER_ADMIN, platform
    context, a reason) changes it, ledgered in the tenant.
  - `notify`: migration 0005 widens the delivery state check. In a sandbox tenant every delivery
    that would leave the platform (email, SMS, WhatsApp, push) is recorded and ledgered as
    `sandboxed` and never handed to an adapter: immediate sends, `dispatchDue`, digests and one-time
    codes alike; in-app messages are still written. A tenant whose flag cannot be read sends nothing.
  - `ai`: in a sandbox tenant the chat and embedding gateways refuse a call whose data class
    (declared, or raised by the scrubber) is above INTERNAL with `IPB-PORT-003`, recorded on the run
    (`sandbox_refused`) and ledgered as the other refusals are; PUBLIC and INTERNAL calls proceed.

  Products: run the migrations (`tenancy` 0018, `notify` 0005). Every tenant that sends notifications
  or calls the AI gateway with data above INTERNAL needs its `tenancy.tenant` row, the platform tenant
  included: without one the kernel cannot read the flag and the ports fail closed.

### Patch Changes

- Updated dependencies [1dda4b2]
- Updated dependencies [1dda4b2]
- Updated dependencies [1dda4b2]
  - @infrabyx/config@1.11.0
  - @infrabyx/contracts@1.21.0
  - @infrabyx/crypto@1.5.6

## 1.13.0

### Minor Changes

- b8c1f2c: Approvals (R1-D-86): `ActionPolicy.platformCheckerRoles`, so an action can add product roles to its tenant checkers while a platform context keeps its own; `DEFAULT_TENANT_CHECKERS` and `DEFAULT_PLATFORM_CHECKERS` are exported.

### Patch Changes

- Updated dependencies [b8c1f2c]
  - @infrabyx/contracts@1.20.0
  - @infrabyx/config@1.10.1
  - @infrabyx/crypto@1.5.5

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
