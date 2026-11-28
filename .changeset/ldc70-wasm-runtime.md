---
"@infrabyx/connectors": patch
---

A clean pnpm install reports no `@emnapi` peer issue (LDC-70; R1-D-327): `@napi-rs/wasm-runtime` is pinned at 1.2.5, the version whose peer range accepts the `@emnapi/*` 2.0.0-alpha.6 that `@gorules/zen-engine-wasm32-wasip1` pins, so the rules engine's copy resolves to it as well. Guide §7fq.
