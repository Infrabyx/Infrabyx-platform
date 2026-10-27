# PL4 — AI gateway and Vidhi kernel

**Phase:** PL4 (IPB-14 §14.3) · **Packages:** `ai` and `vidhi` (first releases), with additions to `contracts`, `config`, `testing`, `connectors`, `workflow` and `export`.
**Date:** 2026-10-27 · **Branch:** `claude/lucid-davinci-fqtf6b`
**Status:** written and self-reviewed under the continuous-build mode (PL2-D-41). Defaults for open points are logged as PL4-D-01 and in OWNER-QUESTIONS #26–#33. **Paid model calls are a stop condition** (owner, 27 Oct 2026): everything is built and tested against stubs and local fakes, and no run calls a paid AI provider without the owner's approval (§10).

**Self-review (27 Oct 2026).** Checked against IPB-03-01 to 03-87 and §03.4–§03.8 row by row:

- every M requirement is built, or deferred with a flag, a default and a question (§1, §13);
- the gaps against M rows (IPB-03-03 adapter set, 03-07 SPEECH adapters, 03-55 run retention, 03-77/78 connectors, 03-80 audio and PPTX) are named as owner questions, not dropped;
- nothing weakens an IPB-02 control: agents stay makers only, fail-closed holds, and nothing is deleted;
- no step calls a paid provider.

Two conflicts inside the spec are raised as platform requests: the adapter path (PR-021) and the image-publish error code (PR-022).

**Read for this plan:**

- IPB-03 in full (§03.1–§03.9, IPB-03-01 to 03-87, `@IPB-03-AT-01` to `-AT-13`);
- IPB-01 §01.4.4 (LLM, EMBEDDING, IMAGE_GEN, SPEECH rows), §01.4.5 routing YAML, §01.6 (`IPB-AI-021`);
- IPB-02 rows 02-10 (agents are makers only), 02-11, 02-19, 02-80, 02-83; §02.4.3.1 data classes; §02.4.6.1 risk classes;
- IPB-07 §07.5 settings tree; IPB-09 rows 09-20, 09-34/35 (export map); IPB-10 event naming; IPB-12 `fut.*` flags named in IPB-03;
- IPB-14 §14.2 package list and §14.3 phase table;
- `docs/DECISIONS.md`: IPB-D-03, IPB-D-06, OWN-10, PL2-D-06 (Bedrock + Gemini Vertex pair), PL3-C-01 (C-24), PL3-D-21 (service readers), PL3-D-25.

**Owner decisions built in** (27 Oct 2026 instruction; earlier rows where noted):

| #   | Decision                                                                                                                                                                                     | Where in this plan |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| O-1 | LLM pair: **Bedrock Claude in ap-south-1** (`bedrock_claude_in`, reference) and **Gemini on Vertex asia-south1** (`gemini_vertex_asia_south1`, alternative) (PL2-D-06)                       | §5                 |
| O-2 | IMAGE_GEN: **Gemini Imagen** on Vertex asia-south1 (`gemini_imagen`), with **human approval before publishing** and the label "AI-generated image" (OWN-10)                                  | §6                 |
| O-3 | Data-class routing: REGULATED and CONFIDENTIAL only to India-resident, zero-retention routes; **fail closed** (IPB-D-06)                                                                     | §4.3               |
| O-4 | AI agents are **makers only**: never approve, sign, disburse, delete or grant. Udofin ceilings **L1 for borrowers, L2 for staff**. No autonomous credit, pay, hiring or discipline decisions | §8.3, §8.4         |
| O-5 | Prompt and response **content capture is off** in telemetry                                                                                                                                  | §4.8               |
| O-6 | **Paid model calls cost money**: build and test against stubs and fakes; ask before any run that calls a paid provider. Provider accounts (AWS Bedrock, Google Vertex) are owner tasks       | §10, §13           |

---

## 1. Scope and what PL4 is not

| Package             | Delivers                                                                                                                                                                                                                                                                                                                                                                                                                              | Builds on                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `ai`                | The AI Gateway: `LlmGateway` (`chat`, `tools`, `structured`, `stream`; `batch` declared, refused until an adapter supports it), `EmbeddingGateway`, `ImageGateway`; model registry and lifecycle; data-class routing with fail-closed; prompt registry; scrubber; guardrails; evals and the CI regression gate; cost metering and caps; BYOK; kill switches; `aiTrace()`; tenant-scoped hybrid retrieval with citations               | `tenancy`, `audit`, `config`, `workflow` (approvals), ports |
| `vidhi`             | The Vidhi kernel: persona prompt; skill manifests (schema, loader, validator); tasks with the IPB-03 §03.4.7 state machine; missions with budgets; scheduled tasks (RRULE, event triggers, CEL conditions) with permission re-check; autonomy L0–L4 with product ceilings, promotion and auto-demotion; the immutable locked-action list; MCP server tool registry and client allow-list; notebooks; digest, feedback and QA sampling | `ai`, `workflow`, `rules` (CEL), `notify`, `tenancy`        |
| `connectors`        | `./ai` subpath: LLM and EMBEDDING adapters `bedrock_claude_in` and `gemini_vertex_asia_south1`, IMAGE_GEN adapters `gemini_imagen` and `flux_self_hosted`, and `self_hosted_vllm` (the only SECRET-eligible route), all on stubs and `unproven`                                                                                                                                                                                       | `connectors` core                                           |
| `contracts`         | Port interfaces LLM, EMBEDDING, IMAGE_GEN, SPEECH, RERANK; the skill-manifest schema; ids, events and error codes (§11)                                                                                                                                                                                                                                                                                                               |                                                             |
| `config`, `testing` | `ai.*` and `vidhi.*` settings (§12); LLM, EMBEDDING and IMAGE_GEN contract suites; Bedrock, Vertex and vLLM stubs; `FakeLlm`, `FakeEmbedding`, `FakeImageGen`                                                                                                                                                                                                                                                                         |                                                             |

Out of PL4 (each with a default in §13):

- **UI.** `<VidhiPanel>`, palette, inline help, chat, voice, `<VidhiApproval>`, `<AiLabel>` and `<Citations>` are PL5 (`ui`). PL4 ships the services, the provenance sidecar and the label text the components render (IPB-03-53, 03-60).
- **SPEECH and RERANK adapters.** Interfaces and fakes only; adapters wait for the voice surface or a product that needs them (#28).
- **The seven other IPB-03-03 LLM adapter keys** (`anthropic_direct`, `openai`, `azure_openai_in`, `xai_grok`, `sarvam`, `bhashini`): registry rows only, in `CANDIDATE`, with no adapter until a product needs one (#26).
- **Calendar and workspace connectors** (IPB-03-77/78; Microsoft Graph, Google Workspace, CalDAV), and the WhatsApp, email and voice surfaces: deferred to the product phase that first uses them (#31).
- **Notebook audio overviews and PPTX slide output** (IPB-03-80): behind flags, off; PPTX needs a docgen package that no IPB-14 package owns yet (#32).
- **AI run purge.** `ai.obs.run_retention_days` is registered but no job deletes runs: deletion and retention are on the locked list (#30).
- **C2PA signing** for images (IPB-OI-03-06): key custody is an open item; images carry the visible label and XMP metadata, and `ai.image.c2pa_sign` stays off.
- **A2A delegation** (`vidhi.a2a.enabled`, IPB-03-68, O tier): off, refused with `IPB-VID-030`.
- **Confidential-computing routing** (`ai.inference.confidential_only`, IPB-OI-03-03): the flag is read and, when on, refuses every route (no attested adapter exists), so it fails closed.

## 2. Package changes and dependency order

```
contracts  + ports LLM, EMBEDDING, IMAGE_GEN, SPEECH, RERANK; DataBlock, ToolSpec, provenance sidecar;
             skill manifest schema (03.4.6); locked-action list type; autonomy levels; ids; events;
             IPB-AI-* and IPB-VID-* error codes
config     + ai.* and vidhi.* settings keys; internal events in.<p>.ai.* and in.<p>.vidhi.*
testing    + LLM, EMBEDDING, IMAGE_GEN contract suites; Bedrock Converse, Vertex generateContent/predict,
             vLLM (OpenAI-compatible) and FLUX stubs; FakeLlm (scripted), FakeEmbedding (deterministic
             hash vectors), FakeImageGen; PII golden corpus; injection corpus
connectors + ./ai: bedrock_claude_in (LLM, EMBEDDING), gemini_vertex_asia_south1 (LLM, EMBEDDING),
             gemini_imagen (IMAGE_GEN), flux_self_hosted (IMAGE_GEN), self_hosted_vllm (LLM, EMBEDDING)
ai         (new) registry, routing, prompts, scrub, guard, evals, meter, obs, kill, retrieval, byok
vidhi      (new) persona, skills, runtime (tasks, missions), sched, autonomy, mcp, notebooks, digest,
             feedback
workflow   + `awaitApproval` for Vidhi tasks (the PL3 gate deferred it to PL4)
export     + REF map entities ai_run and vidhi_action (IPB-03-55, 03-83); map bump
```

Dependency order: `contracts` → `config` → `testing` → `connectors` (`./ai`) → `ai` → `vidhi`. `ai` depends on `tenancy`, `audit`, `config`, `workflow` (approvals for registry promotion and kill-switch deactivation) and the ports. `vidhi` depends on `ai`, `workflow`, `rules` (CEL conditions), `notify` (owner notices, digest) and `tenancy`. No cycles: `ai` never imports `vidhi`.

**IPB-03-01 placement.** IPB-03 names `packages/ai/adapters/**` as the only place for model SDKs, while IPB-01-14 and this repository's `vendor-import` lint allow vendor SDKs only in `packages/connectors/`. The adapters go in `packages/connectors/src/ai/<adapter_key>/` (the folder name is the IPB-03-03 config key), so one lint and one rule hold. `ipb/vendor-import` already covers `@aws-sdk/*`, `@google-cloud/*`, `@google/genai`, `@anthropic-ai/*` and `openai`; the IPB-03 rule name `@infrabyx/no-direct-llm-sdk` becomes an alias of it. A platform request (PR-021) asks to align the IPB-03-01 path with IPB-01-14.

**Releases at the exit gate:** `ai` and `vidhi` **0.1.0** (flipped to publishable in their first changesets, PL1-D-20); `contracts`, `config`, `testing`, `connectors`, `workflow` minor; `export` minor (map bump).

## 3. Cross-cutting design

### 3.1 One module, one schema

`ai` owns schema `ai`; `vidhi` owns schema `vidhi`. Every tenant table has `tenant_id`, RLS enabled and forced, and the tenant policy. Platform-owned rows (the model registry, prompt registry, platform notebooks) live in `tnt_platform` and are readable by every tenant and writable only in platform scope, as for platform rule sets (PL3-D-18). `infrabyx-migrate` applies them after `export`: … → export → ai → vidhi.

### 3.2 Every mutation through the kernel

Registry changes, prompt versions, runs, tasks, schedules, grants, notebook sources and feedback are written through `kernel.mutate` with a ledger entry in the same transaction. A run is one row per model call; its ledger entry carries the run id, route and data class, never content (§4.8).

### 3.3 Agents and the kernel

Vidhi acts as an agent principal (`type: "agent"`, role `AGT_VIDHI`, id `agt_…`) delegated by a human owner. The PL1 kernel already refuses the verbs `approve`, `sign`, `disburse`, `delete` and `grant` for agents (IPB-02-10, `IPB-SEC-004`), and the approvals engine refuses agent checkers. PL4 adds, in `vidhi`, the IPB-03-71 locked list and product additions (§8.3); both layers apply, so a product cannot unlock a verb by naming a tool differently.

### 3.4 Data in payloads

QUEUE and WORKFLOW payloads carry ids only (task id, schedule id, run id). Prompts, completions, tool arguments and retrieved text never enter a queue payload, a log line, a trace attribute or an event. Events carry ids, classes, counts, costs and flags (IPB-03 §03.6.1).

### 3.5 Kill switches (IPB-03-48)

`ai.kill.all`, `ai.kill.adapter.<key>`, `ai.kill.feature.<key>` (platform and tenant tiers) and `ai.kill.tenant` are settings keys, named as IPB-03 §03.5 names them.

- **Activation** is a direct setting write by an allowed role (no checker), ledgered.
- **Deactivation** goes through an R2 approval (`ai.kill.deactivate`) with the same checker roles.
- **Propagation:** the gateway reads them through `KillSwitches`, which caches for at most 30 seconds and is invalidated by the settings change event, so a switch takes effect within 60 seconds on every instance (`@IPB-03-AT-08`).
- If the settings store is unreachable, the last value read stays; if none was read, the gateway treats every switch as **on** (fail closed).

### 3.6 Fail closed everywhere

No eligible route, a breaker open on every candidate, a missing prompt version, a guardrail error, a budget overrun or a kill switch all end the call with the matching `IPB-AI-*` code and a `degraded` hint, never a wider route (IPB-03-20, O-3).

## 4. AI gateway (`@infrabyx/ai`)

### 4.1 Port interfaces (`contracts/ports/llm.ts` and siblings)

As IPB-03 §03.4.2, with three adjustments:

- **The gateway, not the port, owns the request envelope.** `LlmPort` (the adapter interface) takes a fully resolved, scrubbed request: `{ model, system, messages, dataBlocks, tools?, schema?, maxOutputTokens, temperature?, stop?, timeoutMs, idempotencyKey }`, and returns the text, tool calls, usage and the provider response id. `LlmGateway` (in `ai`) takes the IPB-03 `LlmRequestBase` (tenant, feature, data class, `promptRef`, variables, data blocks, pin, budget) and does the registry, routing, prompts, scrub, guard and metering around the port.
- **`batch`** is declared on the gateway and returns `IPB-AI-010` until an adapter declares the capability. Both PL4 LLM adapters leave it undeclared (#26).
- **`capabilities()`, `health()` and `estimateCost()`** are on every adapter (IPB-03-09), and the router honours `retry-after`.

`EmbeddingPort.embed(texts, { model, dims, taskType })`, `ImageGenPort.generate|edit|variations`, `SpeechPort.stt|tts` and `RerankPort.rerank` follow IPB-03 §03.4.2.

### 4.2 Model registry (`ai/0001_init.sql`, IPB-03-11 to 03-17)

Tables `ai.adapter` (key, ports, residency, declared region), `ai.model` (the IPB-03 §03.4.4 columns), `ai.model_event` (lifecycle history) and `ai.default_model` (one row per capability × band, the unique "one DEFAULT" rule as a primary key instead of an expression index).

Lifecycle `CANDIDATE → EVALUATING → APPROVED → DEFAULT → DEPRECATED → BLOCKED` as §03.4.4:

- **`APPROVED` and `DEFAULT` changes are R4 approvals** (`ai.model.promote`, `ai.model.set_default`), checked by `PLT_SECURITY_OFFICER`. `promote` is refused with `IPB-AI-013` without a retention evidence URL, `training_opt_out = true` with its evidence, and eval scores at or above the current DEFAULT minus `ai.registry.promotion_tolerance` (IPB-03-13, 03-52; `@IPB-03-AT-07`).
- **`BLOCKED` is immediate**, overrides pins and BYOK, and is refreshed by every gateway within 60 seconds (the settings-change channel, as for kill switches). There is no Redis pub/sub in PL4; the 60-second bound comes from the cache TTL.
- **`DEPRECATED`** needs `sunset_at` at least 30 days ahead. A daily job (`RegistryJobs.sunset`) moves pins to the DEFAULT and notifies pinning tenants (IPB-03-15).
- **Seed (dev and demo, IPB-03-17).** One `CANDIDATE` row per IPB-03-03 adapter key with residency and retention from provider documentation, `[VERIFY]` in `notes`, and **prices null**. Provider prices are filled by `PLT_SECURITY_OFFICER` at promotion (§13 A-09).

### 4.3 Routing (IPB-03-18 to 03-24, §03.4.5)

- **Data class** = the maximum over the request's declared class, the prompt version's `data_class_max` floor, every data block and every tool result. A caller-supplied class lower than any input is refused with `IPB-AI-020`. Scrubbing never lowers it (IPB-03-28).
- **Bands:** `PUBLIC`/`INTERNAL` → `open`; `CONFIDENTIAL`/`REGULATED` → `in_zero`; `SECRET` → `self`.
- **Eligibility:**
  - `in_zero` admits only `residency ∈ {IN, SELF}` and `retention_policy = ZERO` and `training_opt_out = true`;
  - `self` admits only `SELF`;
  - the tenant setting `trust.privacy.cross_border_ai_allowed = false` narrows every band to IN/SELF (IPB-03-24). It is registered in PL4 with default `false`, the conservative choice;
  - state `APPROVED`/`DEFAULT` only (a pin to anything else, or to an ineligible model, is `IPB-AI-012`, `@IPB-03-AT-02` scenario 2);
  - capabilities ⊇ required; no kill switch; breaker not open; caps not exceeded.
- **Policy** `ai.routing.policy.<feature>.<band>` (platform, maker-checker): ordered candidates with weights; failover on 429, 5xx and timeout to the next candidate **of the same band only**. Breaker: opens after `ai.routing.breaker_failures` failures in `ai.routing.breaker_window_s`, then half-opens. Breaker state is per process in PL4 (A-05).
- **No candidate** → `IPB-AI-021`, event `RouteFailedClosed`, `degraded: true` (`@IPB-03-AT-02` scenario 1, chaos test with every IN adapter killed: zero calls to any other adapter, proven by the stubs' request logs).
- **Residency check at boot** (IPB-03-23): each adapter reports its configured region and the region its endpoint resolves to (Bedrock: the client region; Vertex: the `{location}-aiplatform.googleapis.com` host and the `locations/{location}` path). A mismatch puts the adapter in `BLOCKED_CONFIG`, and the router never selects it.
- The run records `route_reason`, `candidates_considered` and `selected_model_id` (IPB-03-22).

### 4.4 Prompt registry (IPB-03-25, 03-26)

`ai.prompt` and `ai.prompt_version` (`prompt_key`, semver `version`, `owner_role`, `template`, `variables_schema`, `eval_set_ref`, `data_class_max`, `status`, `content_sha256`). Code passes `prompt_key@major`, and the gateway resolves the highest `ACTIVE` version of that major (`IPB-AI-050` if none).

- **Templates** are logic-less: `{{var}}` substitution only. Variables are validated against the schema and are never interpreted as template syntax.
- **Platform prompts** ship as files under `packages/ai/prompts/<key>/<version>.md` with front matter, and are loaded into `tnt_platform` by the seed and by `infrabyx-ai prompts sync`.
- **Activation** (`DRAFT → ACTIVE`) requires the eval gate (§4.7) to have passed for that version's digest; rollback is one state change back to the previous ACTIVE version.
- **Lint `ai-prompt-lint`:** no string literal longer than one sentence passed as a prompt to the gateway (IPB-03-25), and every prompt has a golden set (IPB-03-40).

### 4.5 Scrubber (IPB-03-27, 03-28)

Runs on every outbound request above `PUBLIC`:

- **Detectors:** Aadhaar (Verhoeff check), PAN, bank account (context-anchored), IFSC, card PAN (Luhn), Indian mobile, e-mail, DOB, passport, GSTIN (checksum), API-key shapes, JWTs and PEM private keys; extensible with `ai.scrub.patterns`.
- **Tokens:** each detection becomes `<PII:KIND:n>`. The reverse map lives only in the request's memory and is applied to the response inside the tenant process, never stored.
- **Golden corpus:** a synthetic PII corpus in `testing`; the test asserts zero leaks in the outbound stub request and a round-trip reversal.

### 4.6 Guardrails (IPB-03-33 to 03-39)

- **Input classifier** (rule-based in PL4): injection and jailbreak patterns, a data-class detector, thresholds `ai.guard.input_threshold.<feature>`. A model-based classifier can replace it behind the same interface once a provider is approved.
- **Instruction/data separation** (IPB-03-34, `@IPB-03-AT-01`): data blocks are wrapped in delimited sections with a fixed system instruction. Instruction-like phrases (`ignore previous`, `you are now`, role headers) and markdown links to hosts not in the allow-list are neutralised inside data blocks.
- **Tool allow-list** (IPB-03-35): a tool call not in the request's tool list (from the skill manifest) halts the run with `IPB-AI-040`, increments the incident counter and emits `GuardrailTriggered` (`tool_disallowed`).
- **Structured output** (IPB-03-36): validated with Zod from the JSON Schema; one bounded repair turn, then `IPB-AI-041`.
- **Output classifier** (IPB-03-37), rule-based in PL4:
  - PII not present in the inputs or the tenant context (scrubber detectors over the output, minus tokens reversed from the input);
  - reserved advice (§8.2);
  - citations not in the retrieved set.

  Each hit is redacted or refused per `ai.guard.output_policy.<feature>` and recorded on the run. Toxicity is a declared interface with no detector in PL4 (A-06).

- **Limits** (IPB-03-38): `ai.limits.*` per tenant, user and skill. Oversized input is refused with a `truncated: false` hint for the caller to chunk; nothing is truncated silently.
- **Hidden context** (IPB-03-39): system prompts, tool schemas and data blocks are never returned in the response. A red-team case in the adversarial suite asks for them and asserts no echo.

### 4.7 Evaluations (IPB-03-40 to 03-44)

- **Golden sets** live in `packages/ai/evals/<prompt_key>/` (`cases.jsonl` with inputs, expected properties and grader names; at least 30 cases, and at least 100 for REGULATED features).
- **Graders:** `exact`, `schema`, `contains`/`not_contains`, `citation`, and `rubric`. `rubric` uses a judge model; IPB-03-43 forbids the model under test as its own judge, and the judge's residency follows the eval data class.
- **CI gate `ai-eval-gate`:** a PR that changes a prompt, a routing policy or the DEFAULT map runs the affected golden sets. **In CI the model is `FakeLlm`**, scripted per case, so the gate proves the harness, the graders and the baseline comparison (a deliberately degraded fixture fails), not the quality of a real model.
- **Real-model evals** (promotion evidence, nightly adversarial runs, IPB-03-42) call paid providers. They run only with the owner's approval for each run (O-6), through `infrabyx-ai eval --live`, which refuses to start without `--approved-by <owner ticket>`.
- **Results** are versioned files linked from the model record and the prompt version (`eval_scores`).

### 4.8 Metering, caps, BYOK and observability (IPB-03-45 to 03-55)

- **Run record:** every run writes `tokens_in`, `tokens_out`, `cached_tokens`, `cost_minor_units` (from the registry price; null price → cost null and a `price_unknown` flag), currency, tenant, feature, skill, user or agent.
- **Events:** `RunCompleted` and `RunMetered`, published through the module outbox.
- **Caps:** tenant per day, feature per month and scheduled task per run. At 80 % `CostCapReached` (warning) is emitted; at 100 % the call is refused with `IPB-AI-022`. With a null price, caps count tokens against `ai.cost.*_token_cap` fallbacks (A-07).
- **BYOK** (IPB-03-47): `ai.byok.enabled` (plan, default false) and `ai.byok.adapter.<key>` (a SECRETS reference). A BYOK run uses the tenant's credentials for that adapter only, and every registry and class rule still applies.
- **`aiTrace()`** (IPB-03-50): the one emitter of GenAI semantic-convention spans. Attribute names live in one file (`obs/semconv.ts`).
- **Content capture is off** (O-5, IPB-03-10, 03-51):
  - `ai.obs.capture_content` is registered with default `false`;
  - PL4 has **no code path** that writes prompt or completion text to a span, a log or an event, whatever the setting says;
  - a CI log-scan test asserts that no span attribute or log field named like content (`gen_ai.prompt`, `gen_ai.completion`, `*.content`, `messages`) is emitted;
  - turning capture on later is a code change plus the setting (A-08).
- **Run retention:** runs, scrubbed prompts and routing decisions are stored; `ai.obs.run_retention_days` (180) is registered, but nothing deletes runs in PL4 (#30).
- **Tenant export:** includes `ai_runs.jsonl` (IPB-03-55): ids, model, data class, usage, cost, route and flags, and no content.

### 4.9 Retrieval (IPB-03-29 to 03-32)

- **Data model:** `ai.index` (embedding model, dims, chunker, version) and `ai.chunk` (`tenant_id`, `index_id`, `entity_id`, `resource_ref`, `acl_hash`, `data_class`, `text_sealed`, `tsv`, `embedding vector(n)`), with RLS forced.
- **Search:** hybrid pgvector HNSW (cosine) plus PostgreSQL FTS, fused with reciprocal rank fusion (k = 60), and the optional RERANK port. Results are filtered by RLS and an ACL callback (the product's AUTHZ check on `resource_ref`), so nothing the caller cannot read is returned (`@IPB-03-AT-05`).
- **Citations** `{source_id, resource_ref, locator, quote_hash}` on every grounded answer; an answer with retrieval and no citation is `ungrounded: true` (IPB-03-31).
- **Re-embedding** on a model change builds a new index version and dual-reads until the switch (IPB-03-32). In PL4 this runs as a resumable batch job; the Temporal workflow wrapper is A-10.
- **pgvector in CI:** the integration job moves from `postgres:18` to the pgvector image for PostgreSQL 18 (pinned by digest); `ai/0001` runs `create extension if not exists vector`.

## 5. LLM and EMBEDDING adapters (`connectors/ai`)

| Key                         | Ports          | Residency (to verify) | Implementation                                                                                                                                                                                       | State in PL4                                     |
| --------------------------- | -------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `bedrock_claude_in`         | LLM, EMBEDDING | IN (`ap-south-1`)     | `@aws-sdk/client-bedrock-runtime` (Converse and ConverseStream; InvokeModel for embeddings), the same SDK family and version line as the existing AWS adapters                                       | reference; `unproven`; issue opened              |
| `gemini_vertex_asia_south1` | LLM, EMBEDDING | IN (`asia-south1`)    | plain HTTPS to the Vertex REST API (`generateContent`, `streamGenerateContent`, `predict` for embeddings); no Google SDK. The access token comes from an injected `GoogleAccessToken` provider (#27) | alternative; `unproven`; issue opened            |
| `self_hosted_vllm`          | LLM, EMBEDDING | SELF                  | plain HTTPS to an OpenAI-compatible server inside our infrastructure                                                                                                                                 | the only SECRET route; `unproven` until deployed |

- **Request mapping.** Data blocks become user-turn content wrapped by the guard's delimiters, never system text. Tool specs map to Converse `toolConfig` / Vertex `functionDeclarations` / OpenAI `tools`. Structured output uses the native JSON mode where the model record declares `structured`, else the gateway's schema-validated retry.
- **Errors.** 429 and 5xx are retryable (with `retry-after`); 400 and 403 are not; timeouts cancel the request (`AbortSignal`).
- **Never log bodies** (IPB-03-10): adapters log status, latency, request id and token counts only.
- **Hermetic legs:** the stubs replay the providers' request and response shapes, taken from the official SDK sources and API references on GitHub (vendor documentation hosts are unreachable from the sandbox, PL2-D-64), and are marked `[VERIFY]` until a sandbox leg runs. `LLM`, `EMBEDDING` and `IMAGE_GEN` join `scripts/port-matrix.mjs`. The sandbox legs stay off until the accounts exist and the owner approves a paid run (O-6).

## 6. IMAGE_GEN (IPB-03-05, 03-06; OWN-10)

- **Adapters:**
  - `gemini_imagen` (reference, Vertex `predict` on an Imagen model in asia-south1, same token provider as §5);
  - `flux_self_hosted` (alternative, SELF, an HTTP inference server; no external account, #29).
- **Use cases:** `use` is an enum: `marketing`, `blog_hero`, `diagram`, `placeholder`. The input guard refuses prompts that ask for a real identifiable person, a customer, a regulator, a court or a document purporting to be genuine (`IPB-AI-030`).
- **Labelling:** every image is labelled before storage, through STORAGE `INTERNAL`. It carries:
  - the visible label "AI-generated image" (OWN-10), composited as a caption band;
  - XMP `Infrabyx-SGI: true; model=<id>; run=<run_id>`;
  - a record with `sgi_label = true`.

  C2PA waits for IPB-OI-03-06.

- **Human approval before publishing (OWN-10):** `ImageService.requestPublish(imageId)` raises an R2 approval `ai.image.publish`. Only a human checker (`PLT_CONTENT_EDITOR` or the product's content role) approves, never the requester and never an agent. `assertPublishable(imageId)` is the gate the CMS (PL5) calls: it fails with `IPB-AI-031` without the label and with `IPB-AI-032` (new, §11) without an approval. (The CMS-side code `IPB-CMS-021` is PL5's.)

## 7. SPEECH and RERANK

Interfaces in `contracts`, fakes in `testing`, no adapters (#28). `ai.speech.default_stt` and `ai.speech.default_tts` are registered; a call with no adapter configured fails with `IPB-AI-010`. Retrieval runs without a reranker (IPB-03-08 is S tier).

## 8. Vidhi kernel (`@infrabyx/vidhi`)

### 8.1 Skills (IPB-03-61, §03.4.6)

The manifest schema from §03.4.6, as Zod in `contracts/vidhi` and as JSON Schema in the package. `SkillRegistry.load(manifests)` validates at boot: an invalid manifest disables that skill and logs `IPB-VID-001`, and the others still load. A tool that is `locked: true` or matches the kernel locked list caps that tool's effective ceiling at L2. A manifest's `prompt_key` must exist in the registry and its `eval_set_ref` must exist on disk.

### 8.2 Persona and reserved advice (IPB-03-56, 03-57)

- **Persona:** `vidhi.persona@1` is a platform prompt in the registry with its own golden set (at least 100 cases, including reserved-advice probes; graded with `FakeLlm` in CI).
- **Reserved-advice detector:** rule-based. A recommendation of a specific legal, financial, tax or medical course of action for the user's own matter ("you should sign", "I recommend you invest", "file a suit") is rewritten as information plus a routing card. The routing card is a structured `handoff` block the UI renders.
- **Disclaimer wording** per product is `[COUNSEL]` (IPB-OI-03-05). The platform ships neutral default text keys, which products override (#33).

### 8.3 Locked actions (IPB-03-71, 03-72, 03-74; O-4)

The kernel list is a frozen constant in `vidhi/src/autonomy/locked.ts`, exported read-only and checked by `ipb:check` against the IPB-03-71 categories. Each entry is an action category with matching verbs and tool-name patterns:

| Category           | Covers                                                           | Owner floor (O-4)       |
| ------------------ | ---------------------------------------------------------------- | ----------------------- |
| `payments`         | payments, fund transfers, disbursement, refunds, payouts         | disburse                |
| `credit_decision`  | sanction, decline, limit change, pricing, restructuring          | credit                  |
| `collections`      | any contact with a borrower about dues                           |                         |
| `hr`               | pay, payroll, hiring, offers, termination, discipline, appraisal | pay, hiring, discipline |
| `legal_filing`     | filings with a court, tribunal or regulator; messages to them    |                         |
| `signature`        | signing and e-sign initiation for a person                       | sign                    |
| `deletion`         | delete, purge, erase                                             | delete                  |
| `external_sharing` | sharing data outside the tenant                                  |                         |
| `pricing`          | price and plan changes                                           |                         |
| `approval`         | approving, checking or deciding any approval request             | approve                 |
| `access_grant`     | granting roles, permissions, keys or access                      | grant                   |

- **Product additions** (§03.4.11) are additive per product (`productLockedActions('UDF')` and so on), loaded from the product's manifest bundle. They can only add.
- **Enforcement points:** before a tool call, before an approval is created and when a mission plans a step. A locked action at any level moves the task to `NEEDS_APPROVAL`, and only a human with the action's required role can confirm. An agent token approving gets `IPB-VID-012` (and `IPB-SEC-004` from the kernel).
- **Attempted bypass:** an attempt to execute a locked action without approval emits `LockedActionAttempted`, fails the task and demotes the skill (§8.4).
- **No unlock:** the list is not readable from settings, plan or BYOK, so nothing can unlock it.

### 8.4 Autonomy (IPB-03-69, 03-70, §03.4.8; O-4)

- **Effective level** = min(skill ceiling, product ceiling for the principal's audience, tenant operating level for the skill, the L2 cap for any locked tool, the L2 cap for scheduled tasks except as IPB-03-67 allows).
- **Product ceilings** are platform constants in `vidhi/src/autonomy/ceilings.ts`, keyed by product and audience:

  | Product | Ceiling                                                                             |
  | ------- | ----------------------------------------------------------------------------------- |
  | UDF     | **borrower L1** and **staff L2** (owner, O-4)                                       |
  | EQ      | L2 (L3 only for scheduling and reminder skills)                                     |
  | FBX     | L2, with L3 for data checks, classification and narratives                          |
  | LD      | L3 for internal drafting and reminders; L2 when a counter-party is touched          |
  | LDC     | L3 for internal tasks and reminders; L2 for status changes                          |
  | OH      | L3 for triage, drafts and internal reminders; L2 for anything that leaves the group |

  Products cannot raise them.

- **No autonomous credit, pay, hiring or discipline decisions** (O-4): `credit_decision` and `hr` are on the kernel list for every product, not only FBX and OH.
- **Grants:** `vidhi.autonomy_grant` holds promotion to L3/L4: sponsor, budget, scope, kill-switch owner, evidence. Promotion needs:
  - at least `vidhi.autonomy.promotion_min_runs` L2 runs in 90 days;
  - approval rate ≥ 95 %;
  - zero guardrail incidents;
  - outside the `repromotion_cooldown_days` cooldown (`IPB-AI-013` otherwise).

  It is an R4 approval (`vidhi.autonomy.promote`) whose checker is `ORG_OWNER`.

- **Auto-demotion** follows the IPB-03-70 targets (`@IPB-03-AT-13` scenario 3) and resets the evidence counters.

### 8.5 Tasks and missions (IPB-03-62, 03-63, §03.4.7)

- **Tasks:** `vidhi.task` with the state machine exactly as §03.4.7. Transitions use compare-and-set, so terminal states never change: `update … where id = $1 and state = $2`, zero rows → `IPB-VID-022`. Each tool call is a child ledger entry plus a `vidhi.task_step` row.
- **`NEEDS_APPROVAL`** creates an approval through the workflow `ApprovalsEngine` (`vidhi.action.<tool>`, at the risk class the product's tool declares; R3 at least for locked actions). The approval's executor resumes the task. This is the `awaitApproval` deferred from PL3.
- **Races:** two approvers race on the approval engine's row lock; the second gets `IPB-VID-022` (`@IPB-03-AT-13` scenario 2).
- **Kill switches** cancel every non-terminal task within 60 seconds: a sweep on the switch change, plus a check at each step. A late approval of a cancelled task is refused (`@IPB-03-AT-13` scenario 1).
- **Missions:** `vidhi.mission` with a budget (tokens, cost, wall-clock, tool calls) and a scope.
  - The planner proposes steps through a `structured` LLM call; each step is a task.
  - The mission's level is the lowest ceiling of its skills, and it halts at any locked action.
  - When the budget is exhausted it stops with `IPB-VID-070` (partial).
  - In PL4 missions run as a resumable state machine driven by the QUEUE (A-10). The Temporal wrapper is optional and uses the same activities and idempotency keys.

### 8.6 Scheduled tasks (IPB-03-64 to 03-67, §03.4.9)

- **RRULE:** RFC 5545 with `DTSTART`, TZID and `EXDATE`, expanded with a small in-house expander covering the subset IPB-03-66 needs: FREQ DAILY/WEEKLY/MONTHLY, INTERVAL, BYDAY, BYHOUR, BYMINUTE, BYMONTHDAY, COUNT, UNTIL. It works in the schedule's IANA zone, with tests across DST zones even though India has none. A library is used only if one passes the licence allow-list and the 7-day rule and covers TZID correctly (spike, §14). Unsupported parts are refused at save.
- **Event triggers:** a CloudEvents type match plus an optional CEL condition, evaluated with `rules.evaluateCel` (same engine and limits as PL3).
- **Due runs:** timers in `workflow` (PL3 `TemporalTimers` or the PostgreSQL poller). The poller reads across tenants as a new service reader, `SVC_VIDHI_SCHED` (PL3-D-21 pattern).
- **Permission re-check before every run** (IPB-03-65, `@IPB-03-AT-03`): the owner is active and still holds the roles; plan entitlement; skill enabled and valid; kill switches; connector tokens. A failure skips the run with `IPB-VID-020`, notifies the owner through NOTIFY (class `vidhi.schedule.skipped`) and increments `consecutive_skips`. At `vidhi.sched.max_skips` the schedule is `PAUSED` with `IPB-VID-021`.
- **Level caps:** scheduled runs never exceed L2 unless the owner is `ORG_OWNER` or `ORG_ADMIN` and the tenant operating level allows L3; never L4 (IPB-03-67).
- **Templates** (IPB-03-66) are seeded as data and off by default.

### 8.7 MCP (IPB-03-75, 03-76, §03.4.12)

- **Server:**
  - `McpToolRegistry` builds tools from manifests with `surfaces: ["mcp"]`;
  - `handleMcpRequest(ctx, jsonRpc)` is a transport-agnostic JSON-RPC handler for `initialize`, `tools/list` (filtered by the caller's permissions) and `tools/call`;
  - write tools return `{status: "needs_approval", approval_url, tsk_id}` and never execute without the product UI approval (`IPB-VID-040` if forced).

  Products mount it on `/mcp` in `apps/api` (Streamable HTTP, OAuth 2.1 through IDENTITY); `ai.mcp.server_enabled` is off per tenant. The protocol version string and the stateless profile are `[VERIFY]` against the MCP 2026-07-28 specification in the spike. No MCP SDK dependency unless it passes the licence and 7-day checks and supports that version.

- **Client:**
  - the allow-list `vidhi.mcp.client_allowlist` (platform, plus a tenant subset), each server with a data-class ceiling, tool allow-list and rate limit;
  - non-listed servers get `IPB-VID-041`;
  - every call is ledgered;
  - results enter prompts only as data blocks.

  The HTTP transport goes through the egress rules of `connectors`.

### 8.8 Notebooks (IPB-03-79 to 03-82, §03.4.10)

- **Tables:** `vidhi.notebook`, `notebook_source` and `notebook_output`.
- **Sources:** uploads (text and PDF text extraction only in PL4; OCR and audio wait for their ports), product records by reference (permission-checked at read) and URLs. URLs are fetched only through an injected egress fetcher; there is no fetcher in PL4 unless the product passes one.
- **Rules:**
  - the notebook's class is the maximum of its sources, and adding a lower-class web source to a REGULATED notebook needs explicit confirmation;
  - notebook skills run at L1 with no write tools;
  - outputs are Q&A, FAQ, briefing, timeline, mind map (Mermaid text) and flashcards, each with provenance;
  - platform notebooks live in `tnt_platform` and are read-only to tenants;
  - cross-tenant sharing is a locked action (`external_sharing`, `IPB-VID-060` without approval).

### 8.9 Digest, feedback, QA, disclosure (IPB-03-53, 03-58, 03-60, 03-83 to 03-87)

- **Disclosure:** `provenance(run)` builds the `ai_provenance` sidecar, and `aiLabel({displayName, date, modelFamily, reviewer})` the label text ("Drafted by Vidhi AI on 27 Oct 2026 using <family>; reviewed by: not yet reviewed"; with a display-name override, "<name>, an AI assistant"). Kernel ids stay `vidhi` in logs, events and ledger rows (`@IPB-03-AT-11`).
- **Digest:** "What Vidhi did today" is built per user and per tenant admin from tasks, approvals and costs, and sent through NOTIFY (class `vidhi.digest`, in-app; e-mail optional). The action log goes into the tenant export as `vidhi_actions.jsonl`.
- **Feedback:** `fbk_` rows (thumbs, reason, correction); "use this as reference" adds the correction to the tenant's eval set (never training).
- **QA sampling:** `vidhi.qa.sample_rate` (10 % for skills in their first 30 days) queues runs to the skill owner's Work Inbox. Precision and recall are tracked per skill, and a skill below threshold is demoted one level.
- **Accessibility and languages** (IPB-03-86, 03-87) are mostly PL5 UI. PL4 ships the plain-language rewrite as a prompt (`vidhi.plain_language@1`) and passes the user's language to every prompt.

## 9. Data model (migrations)

`ai/0001_init.sql`:

- `adapter`, `model`, `model_event`, `default_model`;
- `prompt`, `prompt_version`;
- `routing_policy`;
- `run` (no content columns except `scrubbed_prompt_sealed`, sealed with FieldCrypto and readable only by the tenant);
- `cost_counter`, `byok_binding`;
- `index`, `chunk` (`vector` extension), `image` (labelled image records), `kill_switch_event`;
- the outbox and inbox.

`vidhi/0001_init.sql`:

- `skill_state` (tenant enablement and level per skill), `autonomy_grant`, `autonomy_event`;
- `task`, `task_step`, `mission`;
- `schedule`, `schedule_run`;
- `notebook`, `notebook_source`, `notebook_output`;
- `feedback`, `qa_sample`, `digest`;
- the outbox and inbox;
- the `svc_vidhi_sched` reader role with column grants (PL3-D-21 pattern).

Every column carries a data class. RLS is forced on every table. Expand-only.

## 10. Paid calls and provider accounts (O-6)

- No CI job, test or script in this phase calls Bedrock, Vertex or any other paid model API. The adapters are exercised only against stubs, in process or on localhost.
- `infrabyx-ai eval --live` and any sandbox leg refuse to start without an explicit approval reference, and `sandbox-status.json` keeps every AI adapter `unproven`.
- Before the first paid run, the owner is asked in OWNER-QUESTIONS with the expected call count and model list. No such run is planned in PL4.
- **Owner tasks (accounts; each creates an external account or a recurring cost, so the owner does them):**
  1. **AWS Bedrock, ap-south-1:**
     - model access for the chosen Claude models and an embeddings model;
     - confirm the data-protection terms (no storage, no training) and the model list in Mumbai (IPB-OI-01-01, IPB-OI-03-01);
     - an IAM role for the platform's sandbox leg with `bedrock:InvokeModel*` only.
  2. **Google Cloud Vertex AI, asia-south1:**
     - a project with Gemini and Imagen enabled;
     - the zero-data-retention configuration for Gemini (IPB-OI-03-01);
     - a service account or workload-identity binding (see #27).
  3. **GitHub `sandbox` environment secrets** for both, when the owner approves a live run.
  4. **Later and optional:** an inference host for `self_hosted_vllm` and `flux_self_hosted` (GPU cost; PL6 infra).

## 11. Contracts additions

- **Ports:** LLM, EMBEDDING, IMAGE_GEN, SPEECH, RERANK (§4.1); `DataBlock`, `ToolSpec`, `ToolCall`, `LlmUsage`, `AiProvenance`; `SkillManifest` (Zod); `AutonomyLevel`; `LockedActionCategory`.
- **IDs:**
  - `run` now also covers AI runs (description updated; format unchanged);
  - new: `skl` skill, `tsk` task, `msn` mission, `sch` schedule, `agt` agent, `nbk` notebook, `src` notebook source, `out` notebook output, `fbk` feedback, `img` generated image, `idx` retrieval index, `chk` chunk, `grt` autonomy grant.
- **Errors:** every `IPB-AI-*` and `IPB-VID-*` code in IPB-03 §03.6.3, plus `IPB-AI-032` "image not approved for publishing" (owner floor OWN-10; raised as PR-022).
- **Events:** the fifteen internal events of §03.6.1 registered with `internalEvent`. The Ecosystem proposals of §03.6.2 are not emitted.
- **Roles:** `SVC_VIDHI_SCHED` and the agent role `AGT_VIDHI`.

## 12. Config additions

Every key in IPB-03 §03.5, with the tiers, defaults and maker-checker shown there, plus:

- `trust.privacy.cross_border_ai_allowed` (tenant, default **false**, A-03);
- `ai.cost.tenant_daily_token_cap` and `ai.cost.feature_monthly_token_cap.<feature>` (fallback caps while prices are null, A-07);
- `ai.inference.confidential_only` (platform, default false; when true every route is refused, §1);
- `ai.image.c2pa_sign` (default false);
- `vidhi.sched.allow_l4` (always false in PL4);
- `vidhi.notebooks.audio_overview` and `vidhi.notebooks.pptx` (false).

The `<feature>`, `<key>` and `<surface>` parts are registered as patterns, as `mc.*` were in PL3.

## 13. Assumptions and owner questions

Logged as PL4-D-01 `[ASSUMED – owner review]`; each question is in `docs/OWNER-QUESTIONS.md`.

| Ref  | Default taken                                                                                                                                                                                                                                                                                                                                                       | Question |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| A-01 | Adapters built in PL4: the owner's pair (`bedrock_claude_in`, `gemini_vertex_asia_south1`), `self_hosted_vllm` (the only SECRET route; no external account) and the image pair. The six other IPB-03-03 keys are registry rows in `CANDIDATE` without code, built when a product needs one. This is a gap against IPB-03-03 (M), recorded as IPB-DEV-08 `[ASSUMED]` | #26      |
| A-02 | Vertex authentication: an injected access-token provider (workload identity federation or a token the product mints). C-24 (RS256 service-account assertion) is **not** extended to Vertex without the owner's approval                                                                                                                                             | #27      |
| A-03 | `trust.privacy.cross_border_ai_allowed` defaults to false, so every class routes IN/SELF until a tenant's DPDP notice covers cross-border processing                                                                                                                                                                                                                | —        |
| A-04 | SPEECH and RERANK: interfaces and fakes only in PL4                                                                                                                                                                                                                                                                                                                 | #28      |
| A-05 | Breaker and cost counters are per process (breaker) and in PostgreSQL (caps); a shared breaker over Redis waits for a measured need                                                                                                                                                                                                                                 | —        |
| A-06 | Guardrail classifiers are rule-based in PL4; toxicity has an interface and no detector; the IPB-03-33 corpus pass rate is measured against the platform's synthetic corpus                                                                                                                                                                                          | —        |
| A-07 | Model prices are null in the public seed; caps fall back to token caps until a price is set at promotion                                                                                                                                                                                                                                                            | —        |
| A-08 | Content capture is off by construction (no code path), not only by setting (O-5)                                                                                                                                                                                                                                                                                    | —        |
| A-09 | Provider prices are entered by `PLT_SECURITY_OFFICER` in the registry at promotion, never committed to this public repository                                                                                                                                                                                                                                       | —        |
| A-10 | Missions and re-embedding run as resumable QUEUE-driven state machines; the Temporal wrapper is optional                                                                                                                                                                                                                                                            | —        |
| A-11 | IMAGE_GEN alternative is `flux_self_hosted` (SELF), not a GLOBAL vendor, so no new external account is needed                                                                                                                                                                                                                                                       | #29      |
| A-12 | AI runs are kept; nothing deletes them in PL4 (deletion is on the locked list), although IPB-03-55 names 180 days                                                                                                                                                                                                                                                   | #30      |
| A-13 | Calendar and workspace connectors and the WhatsApp, e-mail and voice surfaces wait for the product phase that first uses them                                                                                                                                                                                                                                       | #31      |
| A-14 | Notebook audio overviews and PPTX output are off (flags); PPTX needs a docgen package                                                                                                                                                                                                                                                                               | #32      |
| A-15 | Reserved-advice disclaimer wording: neutral platform text keys, overridden per product after counsel review (IPB-OI-03-05)                                                                                                                                                                                                                                          | #33      |
| A-16 | Adapters live in `packages/connectors/src/ai/<key>/` (IPB-01-14) instead of `packages/ai/adapters/**` (IPB-03-01); PR-021                                                                                                                                                                                                                                           | —        |
| A-17 | Kill switches are settings keys named as IPB-03 names them, with activation direct and deactivation through an R2 approval; a 30-second cache gives the 60-second bound                                                                                                                                                                                             | —        |
| A-18 | The RRULE expander is in-house for the IPB-03-66 subset unless a library passes the licence and 7-day checks                                                                                                                                                                                                                                                        | —        |

Platform requests: PR-021 (IPB-03-01 adapter path), PR-022 (`IPB-AI-032`, and the IPB-03 error table's `IPB-AI-031` vs IPB-03-06's `IPB-CMS-021`), PR-023 (`trust.privacy.cross_border_ai_allowed` is read by IPB-03-24 but missing from IPB-03 §03.5; register it in the settings tree).

## 14. Sessions

| Session | Content                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1       | **Spike** (no paid calls): Bedrock Converse and InvokeModel shapes and `@aws-sdk/client-bedrock-runtime` at the existing AWS SDK version; Vertex `generateContent`, `predict` (embeddings, Imagen) shapes from Google's API definitions on GitHub; vLLM's OpenAI-compatible shapes; pgvector image for PostgreSQL 18; an RRULE library check; MCP 2026-07-28 method set. Then `contracts` (§11) and `config` (§12) |
| 2       | `ai` core: `ai/0001` (registry, prompts, runs, caps, kill events), registry lifecycle with approvals, routing and fail-closed, kill switches, metering, `aiTrace`, `FakeLlm`; `@IPB-03-AT-02`, `-AT-07`, `-AT-08`                                                                                                                                                                                                  |
| 3       | `connectors/ai`: `bedrock_claude_in`, `gemini_vertex_asia_south1`, `self_hosted_vllm` on stubs; LLM and EMBEDDING contract suites; port matrix; issues for the unproven adapters; residency boot check                                                                                                                                                                                                             |
| 4       | Prompts, scrubber, guardrails, evals and `ai-eval-gate`, `ai-prompt-lint`; `@IPB-03-AT-01`; retrieval with pgvector and `@IPB-03-AT-05`                                                                                                                                                                                                                                                                            |
| 5       | IMAGE_GEN: `gemini_imagen`, `flux_self_hosted`, labelling, the publish approval and gate; `@IPB-03-AT-10` (platform side); SPEECH and RERANK interfaces and fakes                                                                                                                                                                                                                                                  |
| 6       | `vidhi` core: manifests, locked list, autonomy and ceilings, tasks with `awaitApproval`, persona and reserved advice; `@IPB-03-AT-04`, `-AT-09`, `-AT-11`, `-AT-13`                                                                                                                                                                                                                                                |
| 7       | Missions, schedules (RRULE, triggers, re-check, `SVC_VIDHI_SCHED`), MCP server and client, notebooks; `@IPB-03-AT-03`                                                                                                                                                                                                                                                                                              |
| 8       | Digest, feedback, QA sampling, provenance and labels (`@IPB-03-AT-06` platform side), export map entities and bump, threat model, gate report and release                                                                                                                                                                                                                                                          |

## 15. Acceptance tests and exit gate

| Test            | Covered by                                                                                                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@IPB-03-AT-01` | Injection fixture through `FakeLlm` returning a forged tool call: data block wrapping, `IPB-AI-040`, `GuardrailTriggered(injection)`, no external send                                                        |
| `@IPB-03-AT-02` | Routing table test for every class × residency × retention; chaos test with every IN/SELF route killed (zero calls to the US stub, `IPB-AI-021`, `RouteFailedClosed`); US pin for CONFIDENTIAL → `IPB-AI-012` |
| `@IPB-03-AT-03` | Schedule owner demoted before the due run → skip, notice, counter; three skips → PAUSED                                                                                                                       |
| `@IPB-03-AT-04` | L4-declared skill reaching `payments.release` → NEEDS_APPROVAL, agent approval refused, demotion to L2                                                                                                        |
| `@IPB-03-AT-05` | Two tenants with 100 chunks each; zero cross-tenant results                                                                                                                                                   |
| `@IPB-03-AT-06` | Platform side: provenance sidecar and label text on every run output; DOCX/PDF placement is docgen's (deferred)                                                                                               |
| `@IPB-03-AT-07` | Promotion without retention evidence → `IPB-AI-013`                                                                                                                                                           |
| `@IPB-03-AT-08` | Adapter kill switch observed by several gateway instances within the cache bound; deactivation needs a checker                                                                                                |
| `@IPB-03-AT-09` | Reserved-advice probe on a UDF borrower question → information plus a routing card, no recommendation                                                                                                         |
| `@IPB-03-AT-10` | Image record labelled, XMP present; `assertPublishable` refuses an unlabelled or unapproved image (the CMS side is PL5)                                                                                       |
| `@IPB-03-AT-11` | Display-name override in labels; ledger, events and runs still say `vidhi`                                                                                                                                    |
| `@IPB-03-AT-12` | Deferred with audio overviews (#32)                                                                                                                                                                           |
| `@IPB-03-AT-13` | Approval after kill switch, two approvers racing, locked-action demotion to L2 and the promotion cooldown                                                                                                     |

Also: the contract suites for LLM, EMBEDDING and IMAGE_GEN (`@IPB-01-15`) on every built adapter; `@NN-01`, `@NN-02` and `@NN-45` with the `ai` and `vidhi` schemas; the content-capture log scan; and the PII golden corpus.

**Exit gate:**

1. All IPB-09 required checks green, including `ai-eval-gate` and `ai-prompt-lint` (new) and the pgvector integration job.
2. LLM, EMBEDDING and IMAGE_GEN hermetic legs green. Every adapter `unproven` with a port-contract issue; no sandbox leg runs (O-6).
3. The tests above present by tag, passing, and listed by `at-report`.
4. `ai/0001` and `vidhi/0001` pass migration-lint and rls-lint; `infrabyx-migrate` applies them on a fresh pgvector PostgreSQL 18.
5. Threat model updated: the gateway, every AI adapter, retrieval, MCP, the scheduler reader, the image flow and the egress of content to providers.
6. Changesets: `ai` and `vidhi` 0.1.0; minors for the packages in §2; an `export_map` line for the map bump.
7. STATUS, DECISIONS, OWNER-QUESTIONS and platform-requests updated; a gate report `docs/phases/PL4-gate.md`.
8. Published through the version PR and `release.yml`.

## 16. Risks

| ID    | Risk                                                                                                   | Mitigation                                                                                                                                                               |
| ----- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R4-01 | Stub shapes drift from the real Bedrock and Vertex APIs, so the adapters fail on the first sandbox run | Shapes from official SDK sources and API definitions, marked `[VERIFY]`; adapters stay `unproven`; the first approved sandbox run is a smoke test with a tiny call count |
| R4-02 | Rule-based guardrails miss injections a model-based classifier would catch                             | Instruction/data separation and the tool allow-list are the hard controls; classifiers are defence in depth; the corpus grows with each incident                         |
| R4-03 | A product calls a model SDK directly                                                                   | `vendor-import` lint in every product's CI (the shared ESLint config)                                                                                                    |
| R4-04 | Residency metadata in the registry is wrong (a model marked IN-ZERO that is not)                       | `APPROVED` needs evidence URLs and a `PLT_SECURITY_OFFICER` checker; the boot residency check catches region misconfiguration                                            |
| R4-05 | The kernel locked list misses a product's verb                                                         | Category patterns plus product additions; the kernel's agent-forbidden verbs stay as a second layer; a locked-action fuzz test over tool names                           |
| R4-06 | Scope: IPB-03 is large for 8 sessions                                                                  | Deferred items in §1 each have a flag, a question and a later phase; the gate checks only what this plan builds                                                          |
