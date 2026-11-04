---
"@infrabyx/contracts": minor
"@infrabyx/tenancy": minor
"@infrabyx/notify": minor
"@infrabyx/ai": minor
---

Sandbox tenants (LawDocsComply PR-LDC-29; R1-plan M60; R1-D-87), failing closed.

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
