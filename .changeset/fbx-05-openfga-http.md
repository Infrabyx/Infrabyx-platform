---
"@infrabyx/connectors": patch
---

The `openfga` AUTHZ adapter calls OpenFGA's HTTP API directly and no longer depends on `@openfga/sdk`, whose 0.9.7 pinned `axios` 1.19.0 with seven high advisories; products can drop their `axios` override (PR-FBX-05). Behaviour is unchanged: the same check, contextual tuples, model id, 3-second timeout and deny-on-failure.
