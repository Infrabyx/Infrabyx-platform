---
"@infrabyx/crypto": minor
---

Blind-index keys outside test environments (Finbyx PR-FBX-25; PL1-C-05; R1-D-37). `loadBlindIndexRoot(secrets, { appEnv, product })` reads the product's root HMAC-SHA-256 key from the SECRETS port at `secrets/<env>/kms/blind-index/<product>` (at least 32 bytes, hex or base64url; the public local key is refused) with its version. `tenantBlindIndexKey` derives the tenant- and scope-specific key by HKDF-SHA-256 with the label `<product>/<scope>/v<n>/<tenant>`, which equals the `deriveSubKey(localDevKey(LOCAL_KMS_KEYS.blindIndex), "<product>/<scope>/v1/<tenant>")` a product uses locally today, so local indexes do not change. `BlindIndexer` writes under the current version, looks up under the current and previous versions during a rotation and tells a re-index job which rows to rewrite. `localBlindIndexRoot()` is the local, dev and test root.
