---
"@infrabyx/config": minor
---

Registers the retention of customer sign-in state (owner answer #86, R1-D-23): `int.identity.customer.retention.challenge_hours` (default 24), `guard_grace_seconds` (default 0) and `device_unused_days` (default 365). Each is PLATFORM tier, set by PLT_SECURITY_OFFICER under maker-checker R4.
