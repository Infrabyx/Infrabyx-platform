---
"@infrabyx/tenancy": minor
---

`TenantBootstrap` (PR-LDC-12, R1-D-67): creates a tenant for a provisional id with its initial settings, the product's first rows and its first ledger entry in one transaction; idempotent per id; `bootstrap` refused in prod, dr and pre-prod, `provision` for the Operations Hub adapter in every environment.
