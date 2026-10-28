---
"@infrabyx/tenancy": patch
---

Security (PR-UDF-016): migration `0004` makes every `svc_*` service role switch-only for `app_rw` and `app_ro` (INHERIT FALSE, SET TRUE), makes both NOINHERIT, and revokes `svc_outbox_relay` from `app_ro`, so the read-only role can no longer append to the audit ledger or update outbox tables. Run `infrabyx-migrate`.
