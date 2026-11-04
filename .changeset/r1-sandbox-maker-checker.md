---
"@infrabyx/tenancy": minor
---

Sandbox changes under maker-checker (OWNER-QUESTIONS #115, R1-D-95). Taking a tenant into or out of the sandbox is now `TenantSandbox.request(caller, tenantId, sandbox, reason)` by a PLT_SUPER_ADMIN (an R3 approval request in that tenant), `decide(...)` by a different platform approver (PLT_SUPER_ADMIN or PLT_SECURITY_OFFICER, in a platform context only), then `apply(caller, tenantId, requestId)` by a PLT_SUPER_ADMIN, which uses the approval once and sets the flag in one ledgered `tenancy.tenant.sandbox.set` transaction (the ledger keeps the reason and the request id). `TenantSandbox.set` is refused (`IPB-SEC-005`); `TenantSandbox` takes the `approvals` engine. `ApprovalsEngine.consumeIn(tx, id, action)` uses an approved request once inside the caller's own transaction. A sandbox flag set at tenant creation is unchanged.
