---
"@infrabyx/tenancy": minor
---

Sandbox changes in production are R4 (OWNER-QUESTIONS #118, R1-D-96): `TenantSandbox` takes the deployment's `appEnv`; a change to a tenant of a production deployment (`prod`, `dr`, `pre-prod`), or when `appEnv` is not given, is raised at R4, so it can be applied only 60 minutes after its approval, in either direction; in any other environment it stays R3 (one approver, no delay). `sandboxChangeRisk(appEnv)` is exported.
