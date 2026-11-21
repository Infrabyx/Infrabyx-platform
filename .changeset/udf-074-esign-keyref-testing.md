---
"@infrabyx/testing": minor
---

`esignFakeStorageCases(storage, { keyRef, unknownKeyRef? })`: with `keyRef` (a reference `storage` resolves in tenant `tnt_contract`), three PR-UDF-074 cases run: the signed PDF and chains under the named key, an unknown or malformed reference failing the download with nothing written, and a multi-document download under one key (R1-D-260). Without the option the cases are as before.
