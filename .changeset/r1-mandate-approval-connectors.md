---
"@infrabyx/connectors": minor
---

`DigioMandates` takes the approvals engine's verifier (`approvals`) and the tenant (`tenantId`), both required, and has the engine consume each call's approval before Digio is called to register or cancel a mandate (R1-D-66). A retry that reads the first mandate back consumes nothing.
