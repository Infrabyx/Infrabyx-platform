---
"@infrabyx/contracts": minor
"@infrabyx/testing": minor
"@infrabyx/fakes": minor
"@infrabyx/connectors": patch
---

Aadhaar offline verification names its form (Udofin PR-UDF-039; R1-D-190). `AadhaarOfflineCheck.kind` (`AADHAAR_OFFLINE_KINDS`: `xml_zip`, the default, or `secure_qr`): the ZIP needs its share code, a Secure QR is refused with one; `AadhaarOfflineResult.kind` echoes it. The contract states the stored-object SHA-256 check before any parse or vendor call (`hash_mismatch`) and that no field carries more than the last four digits. Digio refuses `secure_qr` as `unsupported` until its path is checked against UIDAI's Secure QR specification; the fake verifies both forms. `kycContractCases` gains the case.
