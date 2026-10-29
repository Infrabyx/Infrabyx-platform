---
"@infrabyx/connectors": minor
---

Retention of customer sign-in state (owner answer #86, R1-D-23). `CustomerSignInRetention` is a scheduled per-tenant job (`sweep(tenantSweep)`). It deletes a challenge 24 hours after it expired, a guard row once its lockout window has ended, and a device 12 months after its last use, each period a setting and each deletion ledgered. Unbinding a device (`revokeDevice`) or closing the account (`forgetDevices`) now deletes devices at once. Migration `connectors/0005` grants `app_rw` delete on the three tables, with restrictive policies that keep floors below the settings.
