---
"@infrabyx/contracts": minor
"@infrabyx/tenancy": minor
---

Wave 11: module lifecycle and tenant entitlements (Finbyx PR-FBX-43; OWNER-QUESTIONS #123; R1-D-107; R1-plan M76).

- **`tenancy`:** `tenancy/0020` and `TenantEntitlements`. A licence change is a request and an approval by two different people, both ledgered: requested by PLT_SUPER_ADMIN or PLT_FINANCE, approved by a different PLT_SUPER_ADMIN or PLT_SECURITY_OFFICER (never the requester, a tenant user, a support role or an impersonation); R3 outside production, R4 (60-minute delay) in production; applied once. Versions and notices are insert-only and written only on the platform's approved path. The tenant is told of every grant, revocation and lapse (`onNotice`, `forTenant`); a lapsed or revoked licence refuses writes (`assertWritableIn`, `tenancy.entitlement_status(sku)`) and keeps every record readable. `recordLapses` is the daily sweep.
- **`contracts`:** the platform role `PLT_FINANCE`; `@infrabyx/contracts/module-lifecycle` (the Spec §11.1 lifecycle and edges, `AttachableModule`, `EntitlementChangeInput`, `entitlementStatusOn`, the guard codes); the `ModuleAttached`, `ModuleDetached` and `LegalHoldChanged` schemas (Spec §6.14, §6.16); id prefixes `lic` and `lcn`.
