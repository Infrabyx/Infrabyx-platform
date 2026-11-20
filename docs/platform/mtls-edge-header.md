# Partner mTLS: the edge header contract

**Status:** in force from the `@infrabyx/crypto` minor after 1.9.2 (PR-UDF-064; R1-D-238). **Specified by:** IPB-10-16 and IPB-10-17 (mTLS for `/v1/partner/*`, RFC 8705 sender-constrained tokens), IPB-02-21 (TLS in transit), Ecosystem Spec §3 (mTLS for machines). **Threat model:** `docs/security/threat-model.md` §3.162.

A partner (a lender's system) calls a product's partner API with a TLS client certificate. Either the product's own Node listener terminates TLS, or an edge in front of it (a load balancer, an ingress or a mesh gateway) terminates TLS and forwards the certificate to the product in an HTTP header. This page is the contract for that header. The product reads it with `readClientCertificate` from `@infrabyx/crypto`, which answers either the certificate's binding value and dates, or a fixed refusal label.

## 1. What the product reads

| Path                                   | Call                                                                                        | Who verified the chain                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| The product terminates TLS             | `readClientCertificate({ socket })`                                                         | Node's TLS layer, against the listener's `ca`; `tlsAuthorized` says whether it authorised it |
| An edge terminates TLS (this contract) | `readClientCertificate({ header: req.headers["x-ipb-client-cert"] })`                       | The edge (§3), and optionally the product too, with `trust: PinnedCaSet.fromPem(…)`          |
| An Envoy edge                          | `readClientCertificate({ header: req.headers["x-forwarded-client-cert"], format: "xfcc" })` | As above                                                                                     |

The answer, when `ok`, is:

| Field                     | Meaning                                                                                                                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `x5tS256`                 | **The binding value.** RFC 8705 §3.1 `x5t#S256`: base64url, without padding, of the SHA-256 of the certificate's DER. Partners are registered by it, and an RFC 8705 access token's `cnf["x5t#S256"]` must equal it |
| `fingerprintSha256`       | The same digest as lowercase hex, to compare with `openssl x509 -noout -fingerprint -sha256` when onboarding a partner                                                                                              |
| `notBefore`, `notAfter`   | ISO 8601 UTC                                                                                                                                                                                                        |
| `subject`, `issuer`       | Distinguished names as Node prints them. For display and records only: never authorise on a name                                                                                                                    |
| `serialNumber`            | Uppercase hex                                                                                                                                                                                                       |
| `source`, `tlsAuthorized` | `tls` with `true` or `false`, or `edge` with `null` (the app cannot see the edge's handshake)                                                                                                                       |
| `chain`                   | `pinned` when a `PinnedCaSet` was given and the leaf chains to it, otherwise `not_checked`                                                                                                                          |

A refusal is one of `no_certificate`, `too_large`, `multiple_certificates`, `unparsable`, `tls_unauthorized`, `not_yet_valid`, `expired`, `not_client_certificate`, `untrusted_issuer`, `issuer_algorithm`. The product answers `IPB-API-009` (401) with the label in its log line and never the header value. Nothing in `@infrabyx/crypto` logs the certificate.

## 2. The header

- **Name:** `X-IPB-Client-Cert` (HTTP header names are case-insensitive; Node gives `x-ipb-client-cert`). For an Envoy edge that forwards `x-forwarded-client-cert` (XFCC), the product reads that header with `format: "xfcc"` instead.
- **Value:** exactly one certificate, the client's **leaf**, in PEM (`-----BEGIN CERTIFICATE-----` … `-----END CERTIFICATE-----`), **percent-encoded** (RFC 3986). The product decodes it with percent-decoding only: a `+` is a literal `+` (a base64 character), never a space, so an edge may leave `+`, `=` and `/` unescaped. Nothing else may be in the value: no private key, no text, no second certificate.
- **XFCC:** exactly one element (one hop), with exactly one `Cert=` key whose value (quoted or not) is the percent-encoded PEM of the leaf. Other keys (`By`, `Hash`, `Subject`, `URI`, `DNS`) are ignored, and so is `Chain`. Two elements (an appended hop) are refused `multiple_certificates`.
- **Exactly one certificate.** A chain in the header is refused `multiple_certificates`; so are two values of the header. Intermediates are never taken from the request: a product that checks the chain itself configures them with the partner's pinned CAs (`PinnedCaSet.fromPem(cas, { intermediates })`).
- **Size:** at most 16 KiB (`CLIENT_CERT_MAX_HEADER_BYTES`); longer values are refused `too_large` before decoding. A leaf is usually 1 to 4 KiB of PEM. The edge's own header buffers must allow at least this.

## 3. What the edge must do

1. **Verify the client certificate** against the partner's CA in a mode that ends the handshake when verification fails, and forward only a verified leaf. A mode that forwards an unverified certificate (an optional or pass-through mode) is allowed only if the product checks the chain itself with `PinnedCaSet`.
2. **Strip any copy of `X-IPB-Client-Cert` (and `X-Forwarded-Client-Cert`) that the client sent**, on every request and every listener, before setting its own. Otherwise a caller without a certificate could send one in a header.
3. **Set the header only on the partner mTLS host and routes** (IPB-10-16's `api-mtls.<host>`; `/v1/partner/*` under the FAPI 2.0 profile), and never forward it from a route without client-certificate verification.
4. **Be the only way in.** The product trusts the header because of network position only: its listener for partner routes accepts connections from the edge alone (security groups, network policy or a mesh policy), so no other client can reach it and set the header. A product that cannot guarantee this terminates TLS itself and uses the socket path.
5. **Forward over TLS** to the product, or over the cluster's own encrypted network (IPB-02-21).

## 4. Edge configurations (examples)

These are the documented forms the reader accepts. Each line was taken from the vendor's documentation as known on 20 Nov 2026 and is marked **[VERIFY]** until it is checked against the pinned edge version before a partner goes live; the platform build environment could not reach the vendors' documentation sites.

| Edge                          | Setting                                                                                                                                                                                                                                                                                                                                            | Format    |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| nginx                         | `ssl_verify_client on;` and `proxy_set_header X-IPB-Client-Cert $ssl_client_escaped_cert;` (`$ssl_client_escaped_cert` is the urlencoded PEM, nginx 1.13.5 and later) **[VERIFY]**. `proxy_set_header` replaces a client's copy of the header                                                                                                      | `pem-url` |
| AWS Application Load Balancer | mTLS **verify** mode with a trust store; the leaf arrives in `X-Amzn-Mtls-Clientcert-Leaf` (URL-encoded PEM, `+`, `=` and `/` left unescaped) **[VERIFY]**. Read that header with the default format. Pass-through mode sends the whole chain in `X-Amzn-Mtls-Clientcert` **[VERIFY]**, which the reader refuses `multiple_certificates` by design | `pem-url` |
| Envoy                         | `require_client_certificate: true` with a validation context, `forward_client_cert_details: SANITIZE_SET` and `set_current_client_cert_details: { cert: true }` **[VERIFY]**. `SANITIZE_SET` drops a client's XFCC and sets one element; `APPEND_FORWARD` would add elements and is refused                                                        | `xfcc`    |

When the edge cannot use the name `X-IPB-Client-Cert` (as the ALB, whose header name is fixed), the product reads the edge's header instead; the rules of §2 and §3 are the same, and the product's partner-API module records which header it reads.

RFC 9440 (`Client-Cert`, a structured-field byte sequence of the DER) is a different encoding and is not read yet; it can be added in a minor when an edge needs it.

## 5. What the product does with it

- **Bind, then authorise.** Look the partner up by `x5tS256` in the product's partner registry (configuration or a table, never the subject name), and for an RFC 8705 token compare `cnf["x5t#S256"]` with it.
- **Rotation.** Register the partner's next certificate's `x5tS256` before it is used; both are accepted until the old one is removed. `notAfter` tells operators when to chase the partner.
- **Pinned-CA check (optional).** `PinnedCaSet.fromPem([partnerCaPem], { intermediates })`, parsed once at start-up, checks that the leaf is issued by and verifies against a pinned CA, directly or through at most two configured intermediates, each valid now and a CA. Only ECDSA P-256 / SHA-256 issuer signatures are accepted today; any other algorithm is refused `issuer_algorithm` until the owner widens it (owner question #170). The check does **not** read CRLs or OCSP, name constraints, policies or path-length limits: revocation is by removing the `x5tS256` from the registry (and from the edge's trust store).
- **Never log** the header or the PEM. Record `x5tS256`, `serialNumber`, `notAfter` and the refusal label only.

## 6. Tests

`@infrabyx/crypto/mtls-test` makes a throwaway CA, intermediates and client certificates in memory (no key is committed), and `edgeHeaderValueForTest(pem)` makes the header value. `packages/crypto/src/client-cert.test.ts` shows the header path, the XFCC path, the pinned-CA check and a real TLS handshake on the loopback interface.
