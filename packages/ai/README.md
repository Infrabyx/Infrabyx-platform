# @infrabyx/ai

The AI Gateway: the only path from Infrabyx code to a language, embedding or image model (IPB-03 §03.1). It covers:

- the model registry and its lifecycle;
- data-class routing that fails closed;
- the prompt registry;
- the PII scrubber, the input and output guardrails and structured output;
- platform prompts, golden sets and the eval gate;
- tenant-scoped hybrid retrieval with citations;
- instruction/data separation and the tool allow-list;
- cost metering and caps;
- kill switches;
- AI run retention;
- GenAI spans without content.

**Specified by:** IPB-03 (§03.3.A–H, §03.4.2–§03.4.5) and IPB-01 LLM/EMBEDDING/IMAGE_GEN. Plan: `docs/phases/PL4-plan.md` §4. Migrations `ai/0001` to `ai/0003` are applied by `infrabyx-migrate` when the package is installed; `0003` needs PostgreSQL with the pgvector extension.

**Status:** PL4 session 4. IMAGE_GEN (session 5) is still to come. Provider adapters live in `@infrabyx/connectors/ai` (session 3).

## What it does

- **`ModelRegistry`** (`ai.model`, `ai.model_event`, `ai.default_model`). Rows are platform rows, written only in a platform context, and the lifecycle follows IPB-03 §03.4.4:
  - `requestPromotion` and `requestDefault` are R4 approvals checked by `PLT_SECURITY_OFFICER`;
  - promotion is refused (`IPB-AI-013`) without retention evidence, a documented training opt-out, and eval scores at or above the DEFAULT minus the tolerance;
  - `BLOCKED` is immediate and overrides pins;
  - a deprecation needs a sunset at least 30 days ahead;
  - prices stay null in this public repository and are set at promotion.
- **`LlmGateway.chat` / `tools`.** Each call goes through these steps:
  1. kill switches (`IPB-AI-001`), and the user's runs in the last hour (`ai.limits.user_runs_per_hour`, `IPB-SEC-019`);
  2. the data class, which is the maximum over the inputs, raised by the PII the scrubber finds, and never lowered (`IPB-AI-020`);
  3. the prompt `key@major` (`IPB-AI-050`), refused for data above its `data_class_max` (`IPB-AI-012`);
  4. the input classifier (injection and jailbreak; blocks at `ai.guard.input_threshold.<feature>` with `IPB-AI-042`);
  5. the input size (`ai.limits.max_input_tokens`; `IPB-SEC-013` with `truncated: false`; nothing is cut);
  6. the scrubber: above PUBLIC, every identifier becomes a `<PII:KIND:n>` token, reversed only in the response, in this process;
  7. caps (`IPB-AI-022`);
  8. routing by band (CONFIDENTIAL and REGULATED go only to IN/SELF, zero-retention models with a training opt-out; SECRET only to SELF; with `trust.privacy.cross_border_ai_allowed=false`, everything stays IN/SELF);
  9. failover inside the band on 429, 5xx and timeouts, and the breaker;
  10. the tool allow-list (`IPB-AI-040`);
  11. the output classifier: new PII, echoed hidden context, citations outside the data blocks and reserved advice are redacted, or the answer is withheld (`blocked: true`, `IPB-AI-042`) under `ai.guard.output_policy.<feature> = refuse`;
  12. one `ai.run` row with a ledger entry, plus `RunCompleted`, `RunMetered`, `RouteFailedClosed`, `GuardrailTriggered` and `CostCapReached` through the outbox.

  No eligible model means `IPB-AI-021`; the call never widens to another band. `batch` is refused with `IPB-AI-010`. Results carry `citations` (`[source:<id>]` markers matched to data blocks, with a quote hash), `ungrounded` and `blocked`.

- **`LlmGateway.structured`.** The answer must be JSON valid against the request's JSON Schema (native JSON mode where the model declares `structured`); one repair turn, then `IPB-AI-041`.
- **`Scrubber`.** Aadhaar (Verhoeff, the masked form, and any 12 digits after the word Aadhaar), PAN, mobile, e-mail, UPI, bank account (after an account keyword or next to an IFSC) and IFSC, card (Luhn), voter ID, passport, driving licence, GSTIN (checksum), date of birth, JWT, PEM keys and API keys; `ai.scrub.patterns` adds detectors, and an invalid setting fails closed.
- **Prompts and evals.** Platform prompts live in `prompts/<key>/<version>.md`, golden sets in `evals/<key>/` (≥ 30 cases, ≥ 100 for REGULATED) with a baseline and a result per version. `infrabyx-ai eval` runs them on a scripted fake model through the gateway's own text pipeline (CI `ai-eval-gate`); `infrabyx-ai prompt-lint` checks golden sets and refuses inline prompt text (CI `ai-prompt-lint`); `infrabyx-ai prompts sync --db <url> --actor <usr> --env <APP_ENV>` stores platform prompts and activates a version only with a current eval result (a live result in staging and above). `eval --live` refuses to start without `--approved-by`.
- **`EmbeddingGateway` and `RetrievalService`.** Indexes pin an embedding model and dimensions; chunks are embedded and lexically indexed from scrubbed text, with the original sealed by FieldCrypto. `search` runs pgvector HNSW and full-text search under the caller's RLS, fuses them with reciprocal rank fusion, drops chunks above the feature's data-class ceiling and anything the product's `authorize` callback refuses, and returns data blocks for the gateway. `reembedBatch` builds a new version in resumable batches; `activate` switches.
- **`RunRetention`.** Routine runs are deleted 180 days after they ran (`sweep()`, daily, one worker; one ledger entry per run). A run linked to an approval, a statutory output or a maker-checker request (`hold`) is kept until the hold is released; PostgreSQL enforces both rules.

- **Data blocks** (documents, retrieved chunks, tool results) reach the model only inside `<<<DATA … DATA>>>` blocks. A fixed system instruction says the content is data, and instruction-like phrases, forged markers and foreign links are removed.
- **`KillSwitches`.** `ai.enabled`, `ai.kill.all`, `ai.kill.tenant`, `ai.kill.feature.<f>` and `ai.kill.adapter.<a>` are cached for at most 30 seconds. A switch that cannot be read and was never read counts as on. In `@infrabyx/config`, switches turn on at once and turn off only with an R2 checker (`mc_deactivate`).
- **`PromptRegistry`.** Templates are logic-less (`{{name}}`, single pass) and immutable after DRAFT. A version is ACTIVE only after its eval set passed for that exact content hash; rollback means activating the previous version.
- **`aiTrace`.** It emits GenAI semantic-convention spans with only the attributes in `SEMCONV`. No prompt, completion or tool argument is ever traced, logged or stored (owner decision; `ai.obs.capture_content` is locked off).

## For products

1. Construct `ApprovalsEngine` (from `createWorkflow`), `ModelRegistry`, `PromptRegistry` and `LlmGateway` with your `SettingsService` and the adapters from `@infrabyx/connectors/ai`.
2. Call the gateway with `featureKey`, the data class of your inputs, `promptRef` and the data blocks. Show the non-AI path whenever the result is `IPB-AI-001`, `-021`, `-022` or `-023`, and show "part of this answer was withheld" when `blocked` is true.
3. For retrieval, build `EmbeddingGateway` and `RetrievalService` with FieldCrypto and an `authorize` callback that applies your AUTHZ check to each `resource_ref`; pass `search(...).blocks` to the gateway.
4. Schedule `RunRetention.sweep()` daily, and pass `hold` on runs linked to approvals, statutory outputs or maker-checker requests.
5. Never import a model SDK: the `vendor-import` lint fails CI (IPB-03-01).
