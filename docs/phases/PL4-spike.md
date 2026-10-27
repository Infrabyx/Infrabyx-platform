# PL4 spike — provider shapes, pgvector and libraries (session 1)

**Date:** 2026-10-27 · **Plan:** `docs/phases/PL4-plan.md` §14 session 1 · **Decision:** PL4-D-02

No provider was called and no account was used (owner decision O-6). Shapes come from the official SDK type definitions and Google's published API definitions on GitHub. Vendor documentation hosts are unreachable from the sandbox (PL2-D-64), so every shape below is `[VERIFY]` until a sandbox leg runs with the owner's approval.

## 1. Bedrock (`bedrock_claude_in`)

Source: `@aws-sdk/client-bedrock-runtime` 3.1152.0 (Apache-2.0, published 14 Oct 2026, so it passes the 7-day rule). It is the same version line as the five AWS clients already in `connectors`.

- **Commands:** `ConverseCommand`, `ConverseStreamCommand`, `InvokeModelCommand` (embeddings, as a model-specific JSON body) and `CountTokensCommand`.
- **`ConverseRequest`:**
  - `modelId` and `messages[]` (`{ role, content: ContentBlock[] }`);
  - `system[]` (`{ text }`);
  - `inferenceConfig` (`maxTokens`, `temperature`, `topP`, `stopSequences`);
  - `toolConfig` (`tools[]` of `{ toolSpec: { name, description, inputSchema: { json } } }`, `toolChoice` auto/any/tool);
  - `outputConfig` (structured output through a JSON Schema definition `{ schema: string, name, description }`);
  - `requestMetadata`.
- **`ConverseResponse`:** `output.message.content[]` (`text`, or `toolUse: { toolUseId, name, input }`), `stopReason` (`end_turn`, `tool_use`, `max_tokens`, `stop_sequence`, `content_filtered`, `guardrail_intervened`, `malformed_*`, `model_context_window_exceeded`), `usage` (`inputTokens`, `outputTokens`, `totalTokens`, `cacheReadInputTokens`, `cacheWriteInputTokens`) and `metrics`. The request id is in `$metadata.requestId`.
- **Stream events:** `messageStart`, `contentBlockStart`, `contentBlockDelta` (text or toolUse input fragments), `contentBlockStop`, `messageStop` (stopReason) and `metadata` (usage).
- **Residency check:** the client's resolved region must equal the configured `ap-south-1`. A cross-region inference profile id (`apac.`/`global.` prefixes) is refused for the `in_zero` band [VERIFY: profile naming], because it may process outside India.
- **Mapping:** `end_turn`→`end`, `tool_use`→`tool_use`, `max_tokens` and `model_context_window_exceeded`→`max_tokens`, `stop_sequence`→`stop_sequence`, `content_filtered` and `guardrail_intervened`→`refused`, anything else→`other`. Throttling and 5xx are retryable; validation and access errors are not.

## 2. Vertex AI (`gemini_vertex_asia_south1`, `gemini_imagen`)

Source: `googleapis/googleapis` `google/cloud/aiplatform/v1/{prediction_service,content,tool}.proto` (master on 27 Oct 2026). The REST JSON uses the proto3 camelCase mapping.

- **Endpoints:** `POST https://{location}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/publishers/google/models/{model}:generateContent`, `:streamGenerateContent` (with `?alt=sse` for server-sent events [VERIFY]) and `:predict` (embeddings and Imagen).
- **`GenerateContentRequest`:**
  - `contents[]` (`{ role: "user"|"model", parts[] }`) and `systemInstruction`;
  - `tools[]` (`functionDeclarations[]` with `parametersJsonSchema`) and `toolConfig.functionCallingConfig.mode` (`AUTO`, `ANY`, `NONE`, `VALIDATED`);
  - `generationConfig` (`temperature`, `topP`, `stopSequences`, `maxOutputTokens`, `responseMimeType`, `responseJsonSchema`, `seed`);
  - `labels`.
- **Response:** `candidates[].content.parts[]` (`text` or `functionCall: { name, args }`), `candidates[].finishReason` (`STOP`, `MAX_TOKENS`, `SAFETY`, `RECITATION`, `BLOCKLIST`, `PROHIBITED_CONTENT`, `SPII`, `MALFORMED_FUNCTION_CALL`, `MODEL_ARMOR`, `OTHER`), `usageMetadata` (`promptTokenCount`, `candidatesTokenCount`, `cachedContentTokenCount`, `totalTokenCount`), `modelVersion` and `responseId`.
- **Mapping:** `STOP`→`end` (or `tool_use` when a part is a function call), `MAX_TOKENS`→`max_tokens`, the safety-family reasons→`refused`, anything else→`other`.
- **Embeddings** (`:predict`): `instances[{ content, task_type }]` and `parameters.outputDimensionality`; the response is `predictions[].embeddings.values` [VERIFY: model-specific].
- **Imagen** (`:predict`): `instances[{ prompt }]` and `parameters { sampleCount, aspectRatio }`; the response is `predictions[{ bytesBase64Encoded, mimeType }]` [VERIFY].
- **Authentication:** a bearer token from the injected `GoogleAccessToken` provider (OWNER-QUESTIONS #27). No Google SDK is added.
- **Residency check:** the host prefix and the `locations/` path segment must both be `asia-south1`.

## 3. Self-hosted (`self_hosted_vllm`, `flux_self_hosted`)

- **vLLM** serves the OpenAI-compatible API: `POST /v1/chat/completions` (`messages`, `tools`, `tool_choice`, `max_tokens`, `temperature`, `stop`, `response_format: { type: "json_schema" }`, `stream`), `POST /v1/embeddings` and `GET /v1/models`. The response has `choices[0].message.{content,tool_calls}`, `finish_reason` and `usage.{prompt_tokens,completion_tokens}`.
- **FLUX self-hosted:** no standard API. The adapter speaks a minimal contract (`POST /generate { prompt, width, height, n }` → `{ images: [{ b64, mime }] }`) that the PL6 inference image must implement.

## 4. pgvector

`pgvector/pgvector:0.8.1-pg18` (digest `sha256:508c5290cda481d4f5f846446a26e9c1b804766828a394a5861de1b348a18b4c`, built 13 Feb 2026). It is PostgreSQL 18 with the `vector` extension. Session 4 moves the CI integration job to it and pins the digest; the local test database uses the same image.

## 5. Libraries

- **RRULE.** `rrule` 2.8.1 (BSD-3-Clause, last published November 2023) handles TZID only through an optional Luxon dependency and has known DST issues. The in-house expander for the IPB-03-66 subset is kept (A-18).
- **MCP.** `@modelcontextprotocol/sdk` 1.32.2 (MIT). Whether it supports the 2026-07-28 stateless profile is `[VERIFY]`. Session 7 builds a transport-agnostic JSON-RPC handler (`initialize`, `tools/list`, `tools/call`) without the SDK, and adds the SDK only if it supports that version and passes the licence and 7-day checks.
- **No Google SDK** and no OpenAI SDK are needed: Vertex and vLLM are plain HTTPS with `fetch`.
