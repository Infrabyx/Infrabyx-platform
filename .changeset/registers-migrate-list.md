---
"@infrabyx/tenancy": patch
---

`PLATFORM_MIGRATION_PACKAGES` now ends with `@infrabyx/registers` (ADR-0016, R1-D-323), so `infrabyx-migrate` applies the register row store's schema once a product installs it; while it is not installed it is skipped as before.
