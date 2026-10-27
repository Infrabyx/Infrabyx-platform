---
"@infrabyx/ai": minor
---

First release of the AI Gateway (PL4 session 2, PL4-D-03): migration `ai/0001_init.sql`, with:

- `ModelRegistry`: lifecycle, with R4 promotion and default changes checked by `PLT_SECURITY_OFFICER`, and BLOCKED at once;
- `PromptRegistry`;
- `LlmGateway` `chat` and `tools`: data-class routing that fails closed, failover in the band, breaker, caps, kill switches, the tool allow-list, data-block separation, and one run row per call with events;
- `aiTrace`, with no content.
