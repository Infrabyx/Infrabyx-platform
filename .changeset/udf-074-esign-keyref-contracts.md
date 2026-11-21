---
"@infrabyx/contracts": minor
---

`EsignPort.downloadSigned(envelopeId, opts?)` and `downloadSignedDocuments?(envelopeId, opts?)` take `EsignDownloadOptions` (`{ keyRef? }`): the ESP's signed file is written to REGULATED under that named tenant STORAGE key (PR-UDF-058), failing closed: a reference STORAGE refuses, or a key that cannot be used (`IPB-KMS-001` `storage_key_unavailable`), fails the download and nothing is written under the class key instead (Udofin PR-UDF-074; R1-D-260). Additive: the option is optional, and an adapter that ignores the second argument still type-checks; such an adapter would write under the class key, so a product that names a key should use a platform adapter at this version or later.
