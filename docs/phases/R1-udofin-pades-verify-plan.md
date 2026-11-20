# R1 plan: Udofin PR-UDF-059, a verify-only PAdES/CMS signature verifier (not built until the owner approves)

Owner's addendum, 20 Nov 2026: "a cryptography item: plan it and raise it as an owner question before building (C-list)". Decision R1-D-218 (7); owner question #162. Related: PR-020 (ESIGN `verifySignature` planning, PL3-D-25).

## A. What Udofin asked for

A local PAdES/CMS signature verifier in `@infrabyx/crypto`: verify only, against the CCA India root and its published intermediates; no signing, no new primitive beyond X.509/CMS verification; so a product checks a PDF's embedded signature without a paid ESP call.

## B. Proposed scope (for approval)

- **Input:** the PDF bytes (from STORAGE, by key and SHA-256). Find each signature dictionary (`/Type /Sig`, `/SubFilter` `ETSI.CAdES.detached` or `adbe.pkcs7.detached`), its `/ByteRange` and `/Contents`.
- **Checks:** the `ByteRange` covers the whole file except `/Contents` (else `incremental_update_after_signature` is reported); the CMS SignedData (RFC 5652) parses; `messageDigest` equals the hash of the covered bytes; the signed attributes verify with the signer certificate's key; the chain builds to a pinned CCA India root through published intermediates; each certificate is valid at the signing time (`signingTime` or a timestamp token's time, B-T); key usage allows digital signature or non-repudiation.
- **Algorithms (verification only, already used elsewhere for verification):** RSA PKCS#1 v1.5 and PSS with SHA-256/384/512; ECDSA P-256/P-384 with SHA-256/384. SHA-1 and MD5 refused (`weak_algorithm`).
- **Trust store:** the CCA root(s) and intermediates as DER files in the repository with their SHA-256 fingerprints in a manifest, changed only by PR; no trust taken from the PDF beyond its chain.
- **Revocation:** CRL/OCSP need egress to the CAs. Default: reported `not_checked` unless the caller passes CRLs or OCSP responses it fetched; an online mode is a separate owner question.
- **Output:** `{ signatures: [{ signer: { subject, serial, issuer, certSha256 }, signedAt, coversWholeDocument, chain: "trusted" | "untrusted", revocation: "good" | "revoked" | "not_checked", algorithm, valid }], valid }`; no personal data is logged.
- **Library:** `node:crypto` (`X509Certificate`, `verify`) with a minimal ASN.1/CMS reader, or `pkijs`/`asn1js` after a licence and supply-chain review; no native code.

## C. Tests (when approved)

Fixture PDFs signed by a test CA (generated in the test, never a real certificate), plus a published sample chain: valid, tampered byte, appended incremental update, wrong root, expired at signing time, SHA-1 signature, missing `ByteRange` coverage; `@IPB-02` crypto registry entry (verify-only); CBOM updated.

## D. Owner decision needed

#162: approve the verify-only scope (with revocation as caller-supplied evidence) as a C-item. Nothing is built until then.
