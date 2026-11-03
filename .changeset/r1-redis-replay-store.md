---
"@infrabyx/connectors": minor
---

`RedisReplayStore.fromUrl(url, { prefix, password, timeoutMs })` opens the platform's own Redis or Valkey connection for the DPoP replay store, so a product needs no Redis client of its own (Udofin PR-UDF-032; IPB-01-14; R1-D-47). `redis://` or `rediss://` (TLS) only; commands are not queued while disconnected and time out (2 s), so a claim during an outage throws and sign-in fails closed. `close()` ends the connection.
