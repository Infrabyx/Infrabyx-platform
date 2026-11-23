---
"@infrabyx/contracts": minor
---

`connector.retrieval.host_refused`: the detail's `host` now takes three forms, a DNS name (`RETRIEVAL_HOST_PATTERN`, unchanged), an IPv6 literal exactly as the WHATWG URL parser writes it (`isRetrievalHostIpv6Literal`, `RETRIEVAL_HOST_IPV6_PATTERN`; bracketed, compressed, lower case), or a SHA-256 digest (`RETRIEVAL_HOST_DIGEST_PATTERN`, `sha256:` and 64 hex digits) with the new detail field `host_length` (1 to `RETRIEVAL_HOST_LENGTH_MAX`), required with a digest and refused otherwise. `retrievalHostOf` also answers an IPv6 literal. New `RETRIEVAL_URL_MAX_LENGTH` (8192). PR-UDF-082; R1-D-279.
