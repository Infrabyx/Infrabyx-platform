---
"@infrabyx/tenancy": minor
---

`fieldCryptoForTenant(kms, tenantId, opts?)` returns a `TenantFieldCrypto`, a FieldCrypto bound to one validated tenant id (`tnt_` and a ULID) with the tenant key-id convention of the KMS adapter (`tenantFieldKeyId`: LocalKms `local:tenant:<id>`, AWS KMS `alias/ipb/tenant/<id>`, Vault Transit `tenant-<id>`); calls for another tenant and unknown adapters are refused (PR-LDC-16; R1-D-73).
