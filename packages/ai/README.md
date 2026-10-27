# @infrabyx/ai

The AI Gateway: the only path from Infrabyx code to a language, embedding or image model (IPB-03 §03.1). It covers:

- the model registry and its lifecycle;
- data-class routing that fails closed;
- the prompt registry;
- instruction/data separation and the tool allow-list;
- cost metering and caps;
- kill switches;
- GenAI spans without content.

**Specified by:** IPB-03 (§03.3.A–H, §03.4.2–§03.4.5) and IPB-01 LLM/EMBEDDING/IMAGE_GEN. Plan: `docs/phases/PL4-plan.md` §4. Migration `ai/0001_init.sql` is applied by `infrabyx-migrate` when the package is installed.

**Status:** PL4 session 2. The guardrails, evals and retrieval (session 4) and IMAGE_GEN (session 5) are still to come. Provider adapters live in `@infrabyx/connectors/ai` (session 3).

## What it does

- **`ModelRegistry`** (`ai.model`, `ai.model_event`, `ai.default_model`). Rows are platform rows, written only in a platform context, and the lifecycle follows IPB-03 §03.4.4:
  - `requestPromotion` and `requestDefault` are R4 approvals checked by `PLT_SECURITY_OFFICER`;
  - promotion is refused (`IPB-AI-013`) without retention evidence, a documented training opt-out, and eval scores at or above the DEFAULT minus the tolerance;
  - `BLOCKED` is immediate and overrides pins;
  - a deprecation needs a sunset at least 30 days ahead;
  - prices stay null in this public repository and are set at promotion.
- **`LlmGateway.chat` / `tools`.** Each call goes through these steps:
  1. kill switches (`IPB-AI-001`);
  2. the data class, which is the maximum over the inputs and can never be lowered (`IPB-AI-020`);
  3. the prompt `key@major` (`IPB-AI-050`);
  4. caps (`IPB-AI-022`);
  5. routing by band (CONFIDENTIAL and REGULATED go only to IN/SELF, zero-retention models with a training opt-out; SECRET only to SELF; with `trust.privacy.cross_border_ai_allowed=false`, everything stays IN/SELF);
  6. failover inside the band on 429, 5xx and timeouts, and the breaker;
  7. the tool allow-list (`IPB-AI-040`);
  8. one `ai.run` row with a ledger entry, plus `RunCompleted`, `RunMetered`, `RouteFailedClosed`, `GuardrailTriggered` and `CostCapReached` through the outbox.

  No eligible model means `IPB-AI-021`; the call never widens to another band. `batch` is refused with `IPB-AI-010`.

- **Data blocks** (documents, retrieved chunks, tool results) reach the model only inside `<<<DATA … DATA>>>` blocks. A fixed system instruction says the content is data, and instruction-like phrases, forged markers and foreign links are removed.
- **`KillSwitches`.** `ai.enabled`, `ai.kill.all`, `ai.kill.tenant`, `ai.kill.feature.<f>` and `ai.kill.adapter.<a>` are cached for at most 30 seconds. A switch that cannot be read and was never read counts as on. In `@infrabyx/config`, switches turn on at once and turn off only with an R2 checker (`mc_deactivate`).
- **`PromptRegistry`.** Templates are logic-less (`{{name}}`, single pass) and immutable after DRAFT. A version is ACTIVE only after its eval set passed for that exact content hash; rollback means activating the previous version.
- **`aiTrace`.** It emits GenAI semantic-convention spans with only the attributes in `SEMCONV`. No prompt, completion or tool argument is ever traced, logged or stored (owner decision; `ai.obs.capture_content` is locked off).

## For products

1. Construct `ApprovalsEngine` (from `createWorkflow`), `ModelRegistry`, `PromptRegistry` and `LlmGateway` with your `SettingsService` and the adapters from `@infrabyx/connectors/ai`.
2. Call the gateway with `featureKey`, the data class of your inputs, `promptRef` and the data blocks. Show the non-AI path whenever the result is `IPB-AI-001`, `-021`, `-022` or `-023`.
3. Never import a model SDK: the `vendor-import` lint fails CI (IPB-03-01).
