---
"@infrabyx/connectors": minor
---

`OperationsHubProvisioning` (`@infrabyx/connectors/provisioning`; PR-LDC-11, R1-D-68): verifies the signed `TenantProvisioned`, stores it in the product's Ecosystem inbox and creates the tenant once per provisioning request through `TenantBootstrap.provision`, with the product's hook in the creation transaction.
