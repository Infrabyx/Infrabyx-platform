# PR-043: draft amendment to the Ecosystem Specification, v1.4

**Status:** draft for the owner's sign-off (OWNER-QUESTIONS #116); the JWS encoding is already confirmed (C-22, R1-D-94). The header name, `X-Infrabyx-JWS`, is the owner's (4 Nov 2026, R1-D-91). Nothing under `docs/ecosystem/` changes until the owner signs this text off; then it is applied as v1.4 in its own owner-authorised docs-only PR, as v1.3 was (#210). **Raised by:** LawDocsComply PR-LDC-23, through the platform (R1-D-87).

## 1. What changes and why

§3.6 says every regulated message carries "RFC 9421 in transit plus a detached JWS over the CloudEvent, stored with it", but not how the JWS travels with the HTTP delivery. Two products could pick different headers, and a consumer could not tell a missing proof from one sent somewhere it does not look. v1.4 names the transport and makes no other change:

- **`X-Infrabyx-JWS`**: the HTTP request header that carries a regulated message's detached JWS, on every delivery of the message (first delivery and every retry);
- the JWS profile it carries is the one the platform already applies (C-22; RFC 7515 Appendix F, ES256);
- the consumer verifies it before its `2xx` and stores the same value beside the event.

The events, their payloads, RFC 9421 and its covered components are unchanged. LawDocsComply already sends `X-Infrabyx-JWS`, so the name costs no product a change.

## 2. Text for §3.6 (paste after the bullet "Regulated messages added in v1.3")

- **Transport of the detached JWS** _(v1.4)_: a regulated message delivered by HTTP push (§3.1, §3.4) carries its detached JWS in the request header **`X-Infrabyx-JWS`** (lower case `x-infrabyx-jws` in HTTP/2 and HTTP/3; header names are case-insensitive), on the first delivery and on every retry. The header value is exactly one compact detached JWS, `BASE64URL(protected header) || ".." || BASE64URL(signature)` (RFC 7515 Appendix F), at most 1,024 octets, with no whitespace, no comma-joined list and no second `X-Infrabyx-JWS` header.
- **What the JWS signs** _(v1.4)_: the JCS form (RFC 8785) of the CloudEvent in the request body, without a `signature` attribute if one is present, so a proof stays valid when the event is stored or re-serialised. The payload is base64url-encoded in the signing input as RFC 7515 specifies; the protected header holds `alg` (`ES256` only), `kid`, `typ` (`ipb-regulated-message+jws`), `iat` and `jti`, and nothing else (no `b64`, `crit`, `jku`, `jwk`, `x5u` or `x5c`).
- **Consumer** _(v1.4)_: before its `2xx` (§3.4), a consumer of a regulated message verifies the JWS against the key set it pins for the producer (`kid`, an `iat` within 5 minutes back and 1 minute ahead, `jti` not seen before for that producer), and stores the header value byte for byte beside the event. A regulated message with no `X-Infrabyx-JWS`, with more than one, or with one that does not verify is refused with `signature-invalid` and never processed. A consumer ignores the header on a message that is not regulated, and stores nothing for it.
- **Producer** _(v1.4)_: the producer signs each delivery when it sends it (the JWS lives 5 minutes, so a retry carries a fresh JWS with a new `jti`); the stored copy at the consumer is the JWS of the delivery it accepted. `X-Infrabyx-JWS` is not added to the RFC 9421 covered components: the JWS is itself a signature over the event, and RFC 9421's `content-digest` already binds the body it signs.
- **Batches and files** _(v1.4)_: unchanged. A CloudEvents batch, NDJSON file or registered layout (§3.11, §12) keeps its manifest JWS; a regulated message that is replayed is re-delivered on its own by HTTP push, with its header.

## 3. Versioning

- **Minor version** (Part 14.1): one header and its rules; no event, field, schema, code table or covered component changes meaning, and a consumer that already reads `X-Infrabyx-JWS` is unaffected. No parallel run is required. No new canonical name, so no new tag.
- **§3.4:** at the end of the Standard Webhooks bullet, add "Regulated messages also carry `X-Infrabyx-JWS` (3.6) _(v1.4)_."
- **Specification history:** "v1.4: the transport of a regulated message's detached JWS, the `X-Infrabyx-JWS` header (§3.6). Raised as platform request PR-043 from LawDocsComply PR-LDC-23."
- **What changed in v1.4** (front matter) and **16.0 v1.4 change log** (the present 16.0 becomes 16.1, and so on): "Part 3: 3.6 transport of the detached JWS, `X-Infrabyx-JWS` (all products); Part 14: 14.3 certification test 'Detached JWS header (v1.4)' (all products)". Propagation: every repository adopts v1.4 within 10 working days of publication (Part 14.2) [REC].

## 4. Acceptance tests (paste into §14.3's test table)

| Area                       | Test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Detached JWS header (v1.4) | A regulated message without `X-Infrabyx-JWS`, with two of them, with a comma-joined value, with an attached payload, with `b64` or `crit` in the protected header, signed with another key or with an `iat` older than 5 minutes is refused with `signature-invalid` and not processed; a valid one is accepted and the stored copy equals the header value byte for byte; a retry carries a new `jti` and is accepted; the same `jti` replayed is refused; the header on a message that is not regulated is ignored |

## 5. Owner points for sign-off

1. **JWS form (answered).** The owner confirmed on 4 Nov 2026 that the JWS follows the approved C-22 profile (RFC 7515 Appendix F, base64url payload in the signing input; `b64` and `crit` refused), not RFC 7797 `b64: false`; there is no cryptography change (R1-D-94). §2 above already says so. A product that sends `b64: false` today changes its signer to C-22 (the platform's `signRegulatedMessage` already does).
2. **Replay.** §2's last bullet keeps batches and files as they are and re-delivers a replayed regulated message singly. The alternative, a per-event JWS inside a batch, would change the batch format and is not proposed.

## 6. What the platform builds once this is signed off

R1-plan M61, a `connectors` patch: the Operations Hub provisioning adapter returns the outgoing header (`X-Infrabyx-JWS`) from `signForDelivery`, and `receive` takes the incoming request headers, refusing a missing, repeated or comma-joined header with `signature-invalid` before the JWS is verified and stored (the verification itself is unchanged). A product that already sends and reads `X-Infrabyx-JWS` has no shim to remove.
