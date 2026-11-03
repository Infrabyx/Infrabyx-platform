---
"@infrabyx/tenancy": minor
"@infrabyx/contracts": minor
"@infrabyx/workflow": minor
---

Named tenant functions under maker-checker (Finbyx PR-FBX-20; IPB-02-33; R1-D-39). Migration `tenancy/0011` adds `tenancy.function_assignment`. `TenantFunctions` assigns `FN:CRO`, `FN:CCO`, `FN:COMPLIANCE_OFFICER` and a product's own functions through an approved R3 `tenancy.function.assign` request (an ORG_OWNER or ORG_ADMIN asks, a different one approves, never the assignee), revokes at once with a reason, and `withFunctions(ctx)` adds the person's active functions to the session's roles (dropping any a token claimed). `ApprovalsEngine` honours an action's `checkerFunctions` and the tenant's `FN:` entries in `mc.checker_roles.<action>` (tighten-only; `checkerFunctionsFor`), and `ApprovalWorkflow` sends inbox items to the function holders. `contracts`: `FUNCTION_ROLE_REGEX`, `PLATFORM_FUNCTIONS`, `isFunctionRole`, and `FN:` roles in `RoleSchema`. Run `infrabyx-migrate`.
