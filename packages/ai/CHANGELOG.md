# @infrabyx/ai

## 0.1.0

### Minor Changes

- 200b25a: First release of the AI Gateway (PL4 session 2, PL4-D-03): migration `ai/0001_init.sql`, with:

  - `ModelRegistry`: lifecycle, with R4 promotion and default changes checked by `PLT_SECURITY_OFFICER`, and BLOCKED at once;
  - `PromptRegistry`;
  - `LlmGateway` `chat` and `tools`: data-class routing that fails closed, failover in the band, breaker, caps, kill switches, the tool allow-list, data-block separation, and one run row per call with events;
  - `aiTrace`, with no content.

- c0b6d38: PL4 session 4: scrubber, guardrails, structured output, prompts and evals.

  - `Scrubber`: reversible `<PII:KIND:n>` tokens for every outbound request above PUBLIC (Aadhaar with Verhoeff and the masked form, PAN, mobile, e-mail, UPI, bank account with IFSC, card with Luhn, voter ID, passport, driving licence, GSTIN with its checksum, DOB, JWT, PEM, API keys), extended by `ai.scrub.patterns`; what it finds raises the request's data class, never lowers it.
  - Guardrails in `LlmGateway`: the input classifier (blocks at `ai.guard.input_threshold.<feature>`, `IPB-AI-042`), the output classifier (new PII, echoed hidden context, unknown citations, reserved advice; redact or withhold per `ai.guard.output_policy.<feature>`), `GuardrailTriggered` events, per-user hourly runs (`IPB-SEC-019`) and input size (`IPB-SEC-013` with `truncated: false`).
  - `LlmGateway.structured`: JSON Schema validation with one repair turn, then `IPB-AI-041`. Results now carry `blocked`, `citations` and `ungrounded`.
  - Platform prompts `ai.grounded_answer@1`, `ai.summarise@1` and `ai.extract_fields@1` with golden sets, baselines and versioned results; the `infrabyx-ai` CLI (`prompt-lint`, `eval`, `prompts sync`). `eval --live` refuses to start without `--approved-by`.

- bfa324d: IMAGE_GEN (PL4 session 5, PL4-D-07; OWN-10): migration `ai/0004_image.sql` and `ImageService`. Images are generated only for the permitted uses, never of real people, customers, regulators, courts or documents passing as genuine (`IPB-AI-030`); each is labelled ("AI-generated image" band, XMP, `Infrabyx-SGI` statement) before it is stored, or refused (`IPB-AI-031`). Publishing needs an R2 approval by a content role (`requestPublish`); the CMS calls `assertPublishable` (`IPB-AI-031`, `IPB-AI-032`). `SpeechGateway` answers `IPB-AI-010` until a SPEECH adapter exists.
- b205b1d: `infrabyx-ai` takes several prompt sets (`--set <prompts dir>:<evals dir>`, repeatable) for `prompt-lint`, `eval` and `prompts sync`, so `@infrabyx/vidhi` keeps its persona prompts in its own package. The output classifier now recognises a bulleted system rule echoed without its bullet, and "you should cancel / take / exit / decline" as reserved advice.
- c0b6d38: Tenant-scoped hybrid retrieval (PL4 session 4): migration `ai/0003_retrieval.sql` (needs PostgreSQL with pgvector), `EmbeddingGateway` (routing, scrubbing, caps and run rows for EMBEDDING) and `RetrievalService` (`createIndex`, `addChunks`, `activate`, `search` with pgvector HNSW plus full-text search fused by reciprocal rank fusion, the product's `authorize` callback and a data-class ceiling, and resumable `reembedBatch`). Chunk text is sealed with FieldCrypto; vectors and the lexical index come from scrubbed text.
- f6e9a88: AI run retention (owner approval OWNER-QUESTIONS #30, PL4-D-05): migration `ai/0002_run_retention.sql` and `RunRetention`. Run `sweep()` daily from one worker: it deletes routine runs older than `ai.obs.run_retention_days` (180, never lower) with one ledger entry per run. Runs linked to an approval, a statutory output or a maker-checker request are held (`hold` on a gateway request, or `RunRetention.hold`) and never deleted while held; call `release` when the linked record is deleted. PostgreSQL refuses any delete of a run younger than 180 days or held.
- 9af583a: `usageSummary(kernel, ctx, { from, to, principalId? })`: run count, tokens, cost by currency, unpriced and blocked runs for a period, read inside the `ai` module (PL4-D-11).

### Patch Changes

- Updated dependencies [2b07109]
- Updated dependencies [200b25a]
- Updated dependencies [f6e9a88]
- Updated dependencies [f6e9a88]
- Updated dependencies [200b25a]
- Updated dependencies [9af583a]
- Updated dependencies [288ae44]
- Updated dependencies [b205b1d]
- Updated dependencies [183c532]
- Updated dependencies [f6e9a88]
- Updated dependencies [183c532]
- Updated dependencies [200b25a]
- Updated dependencies [b205b1d]
  - @infrabyx/contracts@0.4.0
  - @infrabyx/config@0.4.0
  - @infrabyx/crypto@0.4.0
  - @infrabyx/tenancy@0.4.0
  - @infrabyx/audit@0.1.3
