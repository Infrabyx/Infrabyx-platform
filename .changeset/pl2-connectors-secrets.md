---
"@infrabyx/connectors": minor
---

SECRETS adapters `aws-sm` (AWS Secrets Manager with the platform CMK, CloudTrail audit) and `vault`
(Vault/OpenBao KV v2, dynamic database leases), plus `CachedSecrets` (15-minute cache, not-ready on
a failed refresh, never older than 24 h). AWS SDK clients 3.1152.0, loaded on demand.
