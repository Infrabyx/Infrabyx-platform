---
"@infrabyx/audit": minor
---

Every refused retrieval host is recordable: `retrievalHostRecord(url)` never returns null or throws (the DNS name or IPv6 literal in clear; any other host as `sha256:` + the SHA-256 of `URL.hostname` without one trailing dot, with `host_length`; `RETRIEVAL_HOST_UNPARSABLE` (`unparsable.invalid`) when there is no host to read), and `retrievalHostRefusedEventOf({ partner_tenant_id, document_id, version, url })` builds the checked `connector.retrieval.host_refused` event from it. PR-UDF-082; R1-D-279.
