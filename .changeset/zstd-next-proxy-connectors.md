---
"@infrabyx/connectors": minor
---

`refuseZstdInNextProxy(request, options?)` in `@infrabyx/connectors/content-coding` (PR-UDF-089; R1-D-320): for a Next.js 16 proxy (formerly middleware) or any Fetch-style handler, the 415 RFC 9457 problem `Response` (`IPB-SEC-010`, or your prefix's, `reason: content_encoding`) when the request's `Content-Encoding` names zstd, or `undefined` to carry on. Call it first, on every path your proxy matches, health probes included; it never reads the body. Next 16 strips `Accept-Encoding` from proxy responses, so behind Next the 415 arrives without it (guide §7fk).
