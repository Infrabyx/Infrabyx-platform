---
"@infrabyx/tenancy": minor
---

External read access (Finbyx PR-FBX-10 item 5; R1-D-29). Migration `tenancy/0010` adds the SELECT-only, switch-only `app_external` role, the `tenancy.external_grant` table and `tenancy.external_allows()` for products' restrictive policies. `ExternalGrants` requests, approves (a second ORG_OWNER or ORG_ADMIN), revokes and lists grants; `ExternalReads` is the one way an external grantee reads, with a ledger entry per read; `externalContext` builds its context. rls-lint gains the `external-read` rule.
