---
"@infrabyx/contracts": minor
---

Udofin PR-UDF-072 (R1-D-262): the security event kind `connector.retrieval.host_refused` (`RETRIEVAL_HOST_REFUSED_EVENT`) with its strict detail `RetrievalHostRefusedDetail` `{ partner_tenant_id, document_id, version, host }`, where `host` is a bare lower-case DNS name (`RETRIEVAL_HOST_PATTERN`; no scheme, credentials, port, path or query, at most 128 characters). `SECURITY_EVENT_SHAPES` and `securityEventShapeProblem` check a kind's typed detail and resource; `retrievalHostRefusedEvent(detail)` builds the checked event and `retrievalHostOf(url)` takes the host from a refused URL. Additive: `rules.reveal.refused` is unchanged.
