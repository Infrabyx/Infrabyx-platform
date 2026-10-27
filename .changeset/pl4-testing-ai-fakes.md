---
"@infrabyx/testing": minor
---

`FakeLlm` (scripted, records every request), `FakeEmbedding` (deterministic vectors) and `providerError` for AI tests. No test calls a paid provider (PL4-D-03).

`startPostgres().end()` tolerates the server's expected "terminating connection due to administrator command" (57P01) from `drop database … with (force)` on a client that is still closing. This removes an intermittent unhandled error after the tests have passed. Any other error still surfaces.

Bedrock Runtime, Vertex AI and vLLM stubs (`startBedrockStub`, `startVertexStub`, `startVllmStub`) and the LLM and EMBEDDING contract cases (`llmContractCases`, `embeddingContractCases`).
