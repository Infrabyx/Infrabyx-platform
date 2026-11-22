# R1 plan: a scoped branch read inside a mutation (PR-FBX-54)

Finbyx PR-FBX-54 (Finbyx #290), owner-accepted 22 Nov 2026 06:20 IST (R1-D-271); built as R1-D-273. Spec of record: IPB-02-12 (tenant and branch isolation by RLS), IPB-02-13 (the context comes from verified claims only), IPB-02-51 and IPB-MOD-003 (every mutation writes the ledger in its own transaction), IPB-02-09 and IPB-02-10 (no writes while impersonating; agents are makers only), IPB-02 §02.4.2 (maker-checker). Existing decisions: R1-D-26 (the branch context and `tenancy.branch_allowed`), R1-D-41 (kernel units), R1-D-48, R1-D-188 and R1-D-237 (ambient mutations, joined reads and the turn machinery), R1-D-75 and R1-D-76 (kernel scope refusals ledgered after the transaction). Nothing under `docs/ipb/` or `docs/ecosystem/` is edited.

## A. What Finbyx asked for

A tenancy kernel call that, inside a mutation, runs a **read-only** unit under a derived context whose branch scope the caller narrows or widens to a named list of branch ids. (1) The caller must hold a grant on each named branch, closed branches included. (2) Ledgered with a stated reason; available only to an approval executor (or a named capability), never to an ordinary request. (3) Writes inside the unit are refused. (4) Contract tests: a named branch is read, an unnamed one is not, a write is refused, the ledger row exists. The kernel's refusal of product code setting `app.*` stays. Finbyx needs it for the month-lock approval's reconciliation of closed-branch loans; its interim shim (a separate `kernel.read`) can then go.

## B. Interface (additive minor of `@infrabyx/tenancy`; `contracts` unchanged)

```ts
// The approval executor (ActionPolicy.execute gains an optional 4th argument):
engine.register("fbx.month.lock", {
  execute: async (tx, payload, request, kernel) => {
    const loans = await kernel.scopedBranchRead(
      { branchIds: ["br_07", "br_12"], reason: "month-lock reconciliation 2026-10" },
      (rtx) => rtx.query("select ... from loans.account ..."),
    );
    // ... the executor's own writes, on tx, ledgered as before
  },
});

// A named capability, declared when the kernel is built and issued once:
const kernel = new PgKernel({
  pool,
  audit,
  branchGrants,
  scopedBranchReadCapabilities: ["fbx.reconcile"],
});
const cap = kernel.scopedBranchReadCapability("fbx.reconcile");
await kernel.mutate(ctx, (tx) => cap.scopedBranchRead(tx, { branchIds, reason }, fn), { action });

// Every branch the principal holds a grant on, open or closed (optional; product-supplied):
type BranchGrantSource = (tx: Tx) => Promise<ReadonlySet<string> | readonly string[] | "all">;
```

- **Executor path.** `runExecutor` builds the 4th argument for that one call: bound to the executor's transaction and the approval request (id and action), frozen, and refused (`KernelGuardError`) once `execute` has settled. The engine reaches the kernel's implementation through a package-internal registry keyed by the `PgKernel` instance (as `external-gate.ts` and `support-gate.ts` do), so nothing outside the package can call it, and a request body can supply nothing that reaches it.
- **Named capability path.** Names are declared in `PgKernelOptions.scopedBranchReadCapabilities` at construction (`^[a-z][a-z0-9_]{0,31}(\.[a-z][a-z0-9_]{0,31}){1,3}$`, not under `approvals.`); each is issued once (a second issue throws), so it is wired at start-up and an undeclared name never exists.
- **An ordinary request** has a `Tx` with no such method, and the kernel's implementation accepts only a mutation transaction it opened itself (a `PgTx` of this kernel, or a joined call's `JoinedTx` on one); a read's transaction, a forged object or another kernel's transaction is refused.

## C. Data flow

1. Checks, in order: the kernel has an audit sink; the transaction is a mutation of this kernel, open, with no scoped read open on it (nested calls are refused); the caller (`tx.ctx`) is a person or service of the tenant (agents, support principals, break-glass, service readers, external principals, impersonation and platform scope are refused); `branchIds` is 1 to 1000 distinct ids of the branch id pattern; `reason` is 1 to 500 characters with no control character and not only spaces.
2. Grant check: `branchGrants(view)` on the mutation's transaction, under the caller's context (a view that cannot mark the ledger or open units); without it the caller's own `allBranches` or `branchIds`, so a closed branch must then be in `branchIds`. Every named id must be granted. Anything else from the source than `"all"`, a set or an array of strings is refused (fail closed).
3. A refusal in 1 or 2 (other than a kernel guard) throws `IPB-SEC-005` with a fixed `meta.refusal` (`branch_ids`, `reason`, `principal`, `ungranted`) and is ledgered `security.branch_scope.read_refused` in the caller's tenant **after the transaction ends**, in its own transaction, as the kernel's other scope refusals are (R1-D-75), so it is on record although the mutation rolls back or the caller catches it.
4. The ledger row `security.branch_scope.read` is written in the mutation's own transaction, before the read's savepoint: it commits with the mutation and is gone if the mutation rolls back. It does not count as the mutation's own ledger entry (`audited` is unchanged), so the mutation must still ledger its business change. `after` (stored as a digest) carries the reason, the branch ids, and the approval request id and action or the capability name; the approval request id is the entry's business id, so `history(ctx, requestId)` finds it.
5. The read: `readUnit` (a savepoint, `set local role <readRole>`, `set local transaction_read_only = on`, the derived context's `app.*` set by the kernel, always rolled back). Derived context: the caller's tenant, principal, trace and sandbox flag; `branchIds` exactly the named list, `allBranches` false, `branchId` removed. A write is refused by PostgreSQL (`25006`); the error reaches the caller with the savepoint rolled back, so the mutation may carry on or fail as the caller decides. Inside, units are refused, nested scoped reads are refused, the kernel's statement guard (`app.*`, roles, transaction control) still applies, and the mutation's own transaction runs nothing else while the read is open (refused outside an ambient mutation; queued in one).
6. Ambient mutations: supported. The read takes its turn like a joined read (R1-D-237) and is tracked as in-flight, so `ambient` waits for it.

## D. Tests (`packages/tenancy/src/scoped-branch-read.int.test.ts`, `@IPB-02-12`)

Owner's four: a named branch's rows are read; an unnamed branch's rows are not; a write inside is refused; the ledger row exists (commits with the mutation, gone when it rolls back). Also: an ungranted id refused and ledgered after the transaction; a closed-but-granted branch readable through `branchGrants`; without `branchGrants`, the context's branches; malformed, duplicate, empty and over-long lists refused; reason required and bounded; an agent refused; an ordinary request's `Tx` has no way in (no method, a forged or read transaction refused); not callable after the executor returns; nested and unit calls refused; product code setting `app.*` still refused inside; the read's row does not satisfy the mutation's ledger check; inside an ambient mutation; the named capability (declared, once, undeclared refused). Existing `ambient*`, `branch`, `approvals*` and `mandate-approval` suites stay green.

## E. Decisions (R1-D-273, `[ASSUMED – owner review]`, owner question #198)

API shape (executor 4th argument plus declared named capabilities); grant source (`branchGrants`, falling back to the context); refusal code `IPB-SEC-005` with fixed labels, ledgered after the transaction; ledger actions `security.branch_scope.read` and `security.branch_scope.read_refused`; derived context without `branchId`; caller kinds refused; ambient supported. No migration, setting, environment variable, role, grant or algorithm.

## F. Exit gate

`pnpm turbo run build lint typecheck test --filter=@infrabyx/tenancy --filter=@infrabyx/contracts`; the new suite and the `ambient*`, `branch`, `approvals*` and `mandate-approval` integration suites; `node scripts/ipb-check.mjs`; `npx prettier --check .`. Changeset for `@infrabyx/tenancy` (minor). Threat model §3.184; guide §7er.
