---
"@infrabyx/contracts": minor
---

`CustomerIdentityPort.forgetDevices(tenantId, userId)`: when the customer closes the account, every device is signed out and deleted at once. `revokeDevice` (unbinding) now deletes the device as well as signing it out (owner answer #86, R1-D-23).
