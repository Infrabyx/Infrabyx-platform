---
"@infrabyx/testing": minor
---

`nextProxyZstdContractCases(fixtures?)` (PR-UDF-089; R1-D-320): run them against your own Next.js 16 `proxy` function to prove the zstd refusal is wired first, health probes included: zstd in any case, in a list or as `x-zstd` gets the 415 problem with the body unread and the path-only `instance`; gzip, deflate, br, identity and no coding are never refused (guide §7fk).
