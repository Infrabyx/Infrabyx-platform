---
"@infrabyx/testing": minor
---

ESIGN contract support for PR-UDF-070 (R1-D-251). The Leegality and Digio stubs return a real PAdES file signed once per signer in signing order by a throwaway CA (`esignStubAuthority()`), with `signerCertificate(documentId, n)` and `pdfMode` (`"pades"` or `"plain"`) hooks; the stub HTTP server sends byte bodies unchanged. `esignFakeCases()` gains signer-certificate and multi-document cases, and `esignFakeStorageCases(storage)` checks `FakeEsign({ storage })`: the signed PDF and chains in STORAGE, the document's hash check, the failure and certificate hooks, and multi-document writes. Re-exports the `FakeEsignOptions` and `FakeEsignSignedObject` types.
