---
"@infrabyx/crypto": minor
---

Signer certificate summaries for ESIGN records (Udofin PR-UDF-070; R1-D-251). `signerCertificateSummary(derOrPem)` reads a certificate's serial (as Node prints it), issuer, validity, SHA-256 of the DER and the subject's most specific common name (`TypeError("not an X.509 certificate")` otherwise). `padesSignerCertificates(pdf, { maxBytes? })` names the signer certificate of each signature embedded in a PDF, in file order, only where that signature is bound to it (ByteRange, CMS digest and the CMS signature over the signed attributes, as C-28 checks them), else `null`; it does not judge trust, which stays with `verifyPadesSignatures`. Field reading and SHA-256 only: no new algorithm or registry entry. Tests only: `pades-test`'s `newSigner` takes an optional `subject`.
