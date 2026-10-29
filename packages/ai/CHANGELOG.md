# @infrabyx/ai

## 1.0.11

### Patch Changes

- Updated dependencies [f5622c9]
- Updated dependencies [f5622c9]
  - @infrabyx/config@1.2.0
  - @infrabyx/contracts@1.7.0
  - @infrabyx/audit@1.2.6
  - @infrabyx/tenancy@1.3.4
  - @infrabyx/crypto@1.2.2

## 1.0.10

### Patch Changes

- Updated dependencies [ceabe3b]
  - @infrabyx/contracts@1.6.0
  - @infrabyx/audit@1.2.5
  - @infrabyx/config@1.1.1
  - @infrabyx/crypto@1.2.1
  - @infrabyx/tenancy@1.3.3

## 1.0.9

### Patch Changes

- Updated dependencies [849b8f9]
- Updated dependencies [849b8f9]
- Updated dependencies [849b8f9]
  - @infrabyx/config@1.1.0
  - @infrabyx/contracts@1.5.0
  - @infrabyx/crypto@1.2.0
  - @infrabyx/audit@1.2.4
  - @infrabyx/tenancy@1.3.2

## 1.0.8

### Patch Changes

- Updated dependencies [7e38652]
- Updated dependencies [7e38652]
  - @infrabyx/contracts@1.4.0
  - @infrabyx/crypto@1.1.0
  - @infrabyx/audit@1.2.3
  - @infrabyx/config@1.0.6
  - @infrabyx/tenancy@1.3.1

## 1.0.7

### Patch Changes

- Updated dependencies [b6058d3]
- Updated dependencies [b6058d3]
  - @infrabyx/contracts@1.3.0
  - @infrabyx/tenancy@1.3.0
  - @infrabyx/audit@1.2.2
  - @infrabyx/config@1.0.5
  - @infrabyx/crypto@1.0.3

## 1.0.6

### Patch Changes

- Updated dependencies [1c869a8]
  - @infrabyx/config@1.0.4
  - @infrabyx/audit@1.2.1
  - @infrabyx/tenancy@1.2.1

## 1.0.5

### Patch Changes

- Updated dependencies [75e9ea4]
- Updated dependencies [75e9ea4]
- Updated dependencies [75e9ea4]
  - @infrabyx/audit@1.2.0
  - @infrabyx/contracts@1.2.0
  - @infrabyx/tenancy@1.2.0
  - @infrabyx/config@1.0.3
  - @infrabyx/crypto@1.0.2

## 1.0.4

### Patch Changes

- Updated dependencies [c0ce8ff]
- Updated dependencies [2724cd6]
  - @infrabyx/tenancy@1.1.3
  - @infrabyx/audit@1.1.1

## 1.0.3

### Patch Changes

- 8a2587e: The `infrabyx-*` CLI entry points run when started through a `node_modules` symlink (`pnpm exec`, npm `.bin`, `node node_modules/@infrabyx/ai/…`); before, they exited 0 without running (PR-UDF-005).
- Updated dependencies [8a2587e]
- Updated dependencies [8a2587e]
  - @infrabyx/config@1.0.2
  - @infrabyx/tenancy@1.1.2
  - @infrabyx/audit@1.1.1

## 1.0.2

### Patch Changes

- Updated dependencies [53a973c]
  - @infrabyx/tenancy@1.1.1
  - @infrabyx/audit@1.1.0

## 1.0.1

### Patch Changes

- Updated dependencies [588b509]
- Updated dependencies [588b509]
- Updated dependencies [588b509]
  - @infrabyx/audit@1.1.0
  - @infrabyx/contracts@1.1.0
  - @infrabyx/tenancy@1.1.0
  - @infrabyx/config@1.0.1
  - @infrabyx/crypto@1.0.1

## 1.0.0

### Major Changes

- 9ec9a2c: 1.0.0, the platform baseline release (IPB-14 §14.5 item 1; owner answer #67(4), PL6-D-16). Every `@infrabyx/*` package moves to 1.0.0 together; the public API is unchanged from the 0.x set of the PL6 gate (`docs/phases/PL6-gate.md` §6), so a product upgrades by moving every dependency to 1.0.0 at once. From 1.0.0 on, semantic versioning holds: a breaking change to an export, a migration or a setting is a major release with an ADR (IPB-09-34/35).

### Patch Changes

- Updated dependencies [9ec9a2c]
  - @infrabyx/audit@1.0.0
  - @infrabyx/config@1.0.0
  - @infrabyx/contracts@1.0.0
  - @infrabyx/crypto@1.0.0
  - @infrabyx/tenancy@1.0.0

## 0.2.1

### Patch Changes

- Updated dependencies [9d8cd8c]
- Updated dependencies [b3934f9]
  - @infrabyx/tenancy@0.6.0
  - @infrabyx/config@0.5.1
  - @infrabyx/audit@0.1.5

## 0.2.0

### Minor Changes

- de53086: Owner answers #34 and #35 (PL4-D-13).

  - Migration `ai/0005_retrieval_erasure.sql` (run `infrabyx-migrate`; it creates the `svc_ai_index_sweep` reader role).
  - `RetrievalService.deleteResource(ctx, resourceRef)`: call it when the product deletes a resource. It deletes every chunk of the resource in every index version and ledgers `ai.retrieval.erase` in the same transaction. A re-embedding batch read before the erasure cannot copy the resource back. Agents may not erase (`IPB-SEC-004`).
  - `RetrievalRetention.sweep()`: run it daily from one worker. It deletes retired index versions 30 days after retirement, chunks first, each step ledgered. PostgreSQL refuses any other delete of chunks or versions.
  - `infrabyx-ai prompts sync` now accepts the scripted CI eval result in staging (synthetic data). Pre-production, production and DR still need a live result from an owner-approved paid run.

### Patch Changes

- Updated dependencies [de53086]
- Updated dependencies [de53086]
- Updated dependencies [f1a36a1]
- Updated dependencies [1fecf45]
- Updated dependencies [1fecf45]
- Updated dependencies [b0dc390]
- Updated dependencies [b0dc390]
- Updated dependencies [b0dc390]
- Updated dependencies [275d4ba]
- Updated dependencies [934355c]
- Updated dependencies [686d24b]
- Updated dependencies [686d24b]
- Updated dependencies [e8e83cb]
- Updated dependencies [275d4ba]
- Updated dependencies [36338c3]
- Updated dependencies [934355c]
- Updated dependencies [b7de3c6]
- Updated dependencies [e8e83cb]
- Updated dependencies [275d4ba]
  - @infrabyx/config@0.5.0
  - @infrabyx/contracts@0.5.0
  - @infrabyx/tenancy@0.5.0
  - @infrabyx/audit@0.1.4
  - @infrabyx/crypto@0.4.1

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
