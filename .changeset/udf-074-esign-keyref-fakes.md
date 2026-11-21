---
"@infrabyx/fakes": minor
---

`FakeEsign` `downloadSigned(id, { keyRef })` and `downloadSignedDocuments(id, { keyRef })` write the signed PDF and the chains under the named STORAGE key (Udofin PR-UDF-074; R1-D-260); `signedObjects()` entries carry `keyRef`. A reference the STORAGE fake does not know fails the download with its refusal and writes nothing; a malformed one is refused `IPB-PORT-003` `key_ref_invalid`. The files are written once: a later download naming another reference (or none, after one) is refused `IPB-PORT-003` `key_ref_changed`. Without `storage` the reference is only checked for format.
