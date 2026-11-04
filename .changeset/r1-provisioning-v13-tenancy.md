---
"@infrabyx/tenancy": minor
---

`EcosystemInbox.receive` takes `exclusiveWith`: event types sharing a business key of which only the first stored is processed, as Ecosystem Spec v1.3 requires for one provisioning request (R1-D-70).
