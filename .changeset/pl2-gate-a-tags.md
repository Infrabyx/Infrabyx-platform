---
"@infrabyx/connectors": patch
---

Ship `sandbox-status.json` in the package, so products can run `infrabyx-routing check --sandbox-status node_modules/@infrabyx/connectors/sandbox-status.json` and keep unproven adapters out of staging and above (IPB-DEV-04 gate B). Each unproven adapter now names its open `port-contract` issue (PL2-D-67).
