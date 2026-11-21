---
"@infrabyx/connectors": minor
---

`leegality` and `digio` `downloadSigned(envelopeId, { keyRef })` write the signed PDF to REGULATED under the tenant's named STORAGE key (Udofin PR-UDF-074; R1-D-260). A malformed reference is refused `IPB-PORT-003` `key_ref_invalid` before the ESP is called; STORAGE's refusals (`key_ref_unknown`, `key_ref_prefix_conflict`, `IPB-KMS-001` `storage_key_unavailable`, …) fail the download unchanged, with nothing written and no retry under the class key. Without `keyRef` nothing changes (a `tenantKeyRefPrefixes` entry for `tenant/<tenant>/esign/` still applies). `nsdl-esign` still refuses `downloadSigned` `unsupported`.
