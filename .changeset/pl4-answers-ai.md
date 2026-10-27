---
"@infrabyx/ai": minor
---

Owner answers #34 and #35 (PL4-D-13).

- Migration `ai/0005_retrieval_erasure.sql` (run `infrabyx-migrate`; it creates the `svc_ai_index_sweep` reader role).
- `RetrievalService.deleteResource(ctx, resourceRef)`: call it when the product deletes a resource. It deletes every chunk of the resource in every index version and ledgers `ai.retrieval.erase` in the same transaction. A re-embedding batch read before the erasure cannot copy the resource back. Agents may not erase (`IPB-SEC-004`).
- `RetrievalRetention.sweep()`: run it daily from one worker. It deletes retired index versions 30 days after retirement, chunks first, each step ledgered. PostgreSQL refuses any other delete of chunks or versions.
- `infrabyx-ai prompts sync` now accepts the scripted CI eval result in staging (synthetic data). Pre-production, production and DR still need a live result from an owner-approved paid run.
