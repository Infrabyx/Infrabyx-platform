---
"@infrabyx/contracts": minor
---

PL4 session 1 (PL4-D-02):

- AI port interfaces LLM, EMBEDDING, IMAGE_GEN, SPEECH and RERANK (`ports/ai.ts`): data blocks, tools, usage, residency and retention, routing bands, the provenance sidecar and `AiProviderError`;
- `@infrabyx/contracts/vidhi`: the skill-manifest schema, autonomy levels, task states and locked-action categories;
- the IPB-03 §03.6.3 error codes (`IPB-AI-001` takes the IPB-03 meaning; PR-024), plus `IPB-AI-032`;
- new ids, the `AGT_VIDHI` role and the `in.<p>.ai.*` and `in.<p>.vidhi.*` event names and payloads.
