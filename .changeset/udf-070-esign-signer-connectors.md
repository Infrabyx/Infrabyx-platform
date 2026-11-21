---
"@infrabyx/connectors": minor
---

ESIGN signer certificates (Udofin PR-UDF-070; R1-D-251). `leegality` and `digio` fill each signature record's `signerCertificate` from the signed PDF's own signatures (`signerCertificatesFromPdf`): the k-th bound signature is the k-th signer to sign (envelope order when sequential, the ESP's signing times when parallel), and only when that mapping is certain (one bound signature per signer, distinct times); otherwise it stays unset. `nsdl-esign` has no records yet (#177). All three refuse `createMultiDocumentEnvelope` and `downloadSignedDocuments` with `unsupported` (their descriptor capabilities say so) until a vendor's multi-document support is verified. New helpers `withSignerCertificate` and `NO_MULTI_DOCUMENT`.
