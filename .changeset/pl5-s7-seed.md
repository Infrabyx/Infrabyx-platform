---
"@infrabyx/seed": minor
---

PL5 session 7: a seed module's context carries `services` (the run's kernel, audit sink and outbox, with `seedAllowed: true`), so modules can seed through a package's own services, as the public-site seed in `apps/public` does through the Studio maker-checker flow.
