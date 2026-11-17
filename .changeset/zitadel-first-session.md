---
"@infrabyx/connectors": patch
---

The Zitadel customer adapter no longer fails a new account's first code under load (R1-D-171, R1-D-172). Zitadel's session API checks the user against its user projection without bringing it up to date (`GetUserByID(ctx, false, ...)`, zitadel v4.19.5), so `POST /v2/sessions` could answer 404 for an account created a moment earlier. The adapter now reads a new account by id before its first session, which updates the projection. On a 404 it reads the account once more and retries once. A second refusal is still `IPB-PORT-002`. No API, setting or migration change.
