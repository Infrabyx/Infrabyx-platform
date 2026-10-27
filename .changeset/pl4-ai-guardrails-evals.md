---
"@infrabyx/ai": minor
---

PL4 session 4: scrubber, guardrails, structured output, prompts and evals.

- `Scrubber`: reversible `<PII:KIND:n>` tokens for every outbound request above PUBLIC (Aadhaar with Verhoeff and the masked form, PAN, mobile, e-mail, UPI, bank account with IFSC, card with Luhn, voter ID, passport, driving licence, GSTIN with its checksum, DOB, JWT, PEM, API keys), extended by `ai.scrub.patterns`; what it finds raises the request's data class, never lowers it.
- Guardrails in `LlmGateway`: the input classifier (blocks at `ai.guard.input_threshold.<feature>`, `IPB-AI-042`), the output classifier (new PII, echoed hidden context, unknown citations, reserved advice; redact or withhold per `ai.guard.output_policy.<feature>`), `GuardrailTriggered` events, per-user hourly runs (`IPB-SEC-019`) and input size (`IPB-SEC-013` with `truncated: false`).
- `LlmGateway.structured`: JSON Schema validation with one repair turn, then `IPB-AI-041`. Results now carry `blocked`, `citations` and `ungrounded`.
- Platform prompts `ai.grounded_answer@1`, `ai.summarise@1` and `ai.extract_fields@1` with golden sets, baselines and versioned results; the `infrabyx-ai` CLI (`prompt-lint`, `eval`, `prompts sync`). `eval --live` refuses to start without `--approved-by`.
