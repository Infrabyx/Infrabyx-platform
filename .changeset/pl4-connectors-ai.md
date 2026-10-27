---
"@infrabyx/connectors": minor
---

`@infrabyx/connectors/ai` (PL4 session 3, PL4-D-04): LLM and EMBEDDING adapters on stubs, all `unproven`:

- `bedrock_claude_in` (reference; Bedrock Converse and InvokeModel in ap-south-1 through `@aws-sdk/client-bedrock-runtime`; #63);
- `gemini_vertex_asia_south1` (alternative; Vertex REST with an injected access token, no Google SDK; #64);
- `self_hosted_vllm` (the SELF route for SECRET data; #65).

Each adapter checks its region at boot, refuses cross-region inference profiles, maps 429/5xx/timeouts to retryable errors for the gateway, never logs bodies, and emulates streaming.
