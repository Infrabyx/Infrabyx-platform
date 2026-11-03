---
"@infrabyx/tenancy": minor
---

External grants opened from a product's own approvals (Finbyx PR-FBX-22; IPB-08-19; R1-D-40). Migration `tenancy/0012` adds `source`, `source_approval_id`, `pii_level` (none, masked, full) and `export_allowed` to `tenancy.external_grant` (existing grants read as masked, no export), `tenancy.external_grant_source` (one grant per product approval in a tenant), and `tenancy.external_pii_level()` and `tenancy.external_export_allowed()` for a product's policies and export gate. `ExternalGrants.fromApproved(tx, …)` opens an active grant in the transaction of the product's executor with its approval id, maker and checker (different people), the mapped grantee kind and at most 90 days; `revokeFromApproved` revokes it at once. Run `infrabyx-migrate`.
