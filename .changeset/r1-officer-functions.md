---
"@infrabyx/tenancy": minor
---

Officer functions per legal entity (Finbyx PR-FBX-31; IPB-02-33; R1-D-46). Migrations `tenancy/0013` (`entity_ref`, `register_ref`, `single_holder` and `revoke_request_id` on `tenancy.function_assignment`) and `tenancy/0014` (a unique partial index built concurrently: one active single-holder row per tenant, function and entity). `TenantFunctions` takes `policies` per function (`FunctionPolicy`: `perEntity`, `singleHolder`, `checkedRevocation`, `registerRequired`; `OFFICER_POLICY` sets all four). `requestAssign` takes `entityRef` and `registerRef`; `requestRevoke` raises an R3 `tenancy.function.revoke` request, and `revoke` refuses a function with `checkedRevocation`; `withFunctions` counts a per-entity function only in `ctx.entityId`; `authzAttributes(ctx)` lists each function's entities for AUTHZ. Without a policy a function behaves as before. Run `infrabyx-migrate`.
