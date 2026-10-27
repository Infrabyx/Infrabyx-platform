---
"@infrabyx/cms": patch
---

PL5 gate: an `embed` block's URL must be an https address on its provider's own hosts (`EMBED_HOSTS`; no IP literal, private name, port, credentials or look-alike host), so it is refused on save and never fetched (`@IPB-04-AT-94`).
