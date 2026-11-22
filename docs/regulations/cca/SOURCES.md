# CCA India root certificates — sources (owner upload, 21 Nov 2026)

For `CCA_INDIA_TRUST` in `packages/crypto/src/cca-india-trust.ts` (owner question #178 (1), PR-UDF-059; the same files are on UdofinCl branch owner/cca-india-roots). Downloaded on 21 Nov 2026 from the Controller of Certifying Authorities' page "Root Certificate" (https://cca.gov.in/root_certificate.html), unchanged. Subject, validity and SHA-256 below were read from each file; the validity dates match the CCA page's table.

| File                                           | Subject                                                          | Valid from | Valid to   | Status on the CCA page | SHA-256 of the DER certificate                                     | Official source                                                      |
| ---------------------------------------------- | ---------------------------------------------------------------- | ---------- | ---------- | ---------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `CCAIndia2022.cer` (PEM)                       | CN=CCA India 2022, O=India PKI, C=IN (RSA 4096, self-signed)     | 2022-02-02 | 2042-02-02 | Existing               | `9a3fd3176798e842ddcb12c262f11cfacca70a8b84c6ea6fda30842a95a94cd8` | https://cca.gov.in/cca/sites/default/files/files/CCAIndia2022.cer    |
| `CCAIndia2022SPL.cer` (PEM, CRLF)              | CN=CCA India 2022 SPL, O=India PKI, C=IN (RSA 4096, self-signed) | 2022-09-20 | 2042-09-20 | Existing               | `b724689b79b2ef9421ef8f5cc733eb093851b170ee715177005a09f226d8c91a` | https://cca.gov.in/cca/sites/default/files/files/CCAIndia2022SPL.cer |
| `CCAIndia2015.cer` (base64 DER, no PEM header) | CN=CCA India 2015 SPL, O=India PKI, C=IN (RSA 2048, self-signed) | 2015-01-29 | 2025-01-29 | Expired                | `c34c5df53080078ffe45b21a7f600469917204f4f0293f1d7209393e5265c04f` | https://cca.gov.in/cca/sites/default/files/files/CCAIndia2015.cer    |
| `CCAIndia2014.cer` (base64 DER, no PEM header) | CN=CCA India 2014, O=India PKI, C=IN (RSA 2048, self-signed)     | 2014-03-05 | 2024-03-05 | Expired                | `60109bc6c38328598a112c7a25e38b0f23e5a7511cb815fb64e0c4ff05db7df7` | https://cca.gov.in/cca/sites/default/files/files/CCAIndia2014.cer    |

Owner instructions:

- Pin the two **existing** roots (2022 and 2022 SPL) by SHA-256 in the trust store; normalise the files to PEM in the code, never trust a file whose hash differs.
- The two **expired** roots are kept for the record only, for a later decision on validating signatures made while they were valid; they are not pinned now.
- Out-of-band confirmation of the thumbprints is available from the CCA by e-mail to verifyroot AT cca.gov.in (CCA's Root CA FAQ); the owner may record that confirmation later.
- Root CRLs are published on the same page (`/rw/resources/CCAIndia2022Latest.crl`, `CCAIndia2022SPLLatest.crl`); revocation checking stays `not_checked` until the platform fetches CRLs or OCSP.
