---
"@infrabyx/connectors": minor
"@infrabyx/consent": patch
"@infrabyx/vidhi": patch
---

Refuse zstd content codings while the runtime's bundled zstd 1.5.7 is affected by CVE-2026-124851 (LDC-68; R1-D-294; guide §7fb). New `@infrabyx/connectors/content-coding`: `refuseZstdBodies` (and `refuseZstdBodiesWith`) answers a `Content-Encoding: zstd` request 415 `IPB-SEC-010` before any body parser or guard, while gzip, deflate and br pass; `refuseZstdFetch` never offers zstd and refuses a zstd response unread. `createEgress`, the OpenFGA and Cerbos adapters, the OH consent ledger and Vidhi's MCP client no longer offer zstd, and `createEgress` refuses a zstd answer with `IPB-SEC-010` without retrying. Whole-object assertions on the headers an injected fetch receives gain `accept-encoding: gzip, deflate, br`.
