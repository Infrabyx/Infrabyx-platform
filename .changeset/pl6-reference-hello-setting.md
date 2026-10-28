---
"@infrabyx/config": patch
---

PL6 session 4a: registers `hello.greeting.max_length` (TENANT, default 280, ceiling 2000), the setting of the reference app's `hello` module (`apps/reference/api`), so the template reads it through `SettingsService` like every product setting. Products that do not keep the hello module ignore it.
