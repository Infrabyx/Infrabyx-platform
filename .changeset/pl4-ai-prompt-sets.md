---
"@infrabyx/ai": minor
---

`infrabyx-ai` takes several prompt sets (`--set <prompts dir>:<evals dir>`, repeatable) for `prompt-lint`, `eval` and `prompts sync`, so `@infrabyx/vidhi` keeps its persona prompts in its own package. The output classifier now recognises a bulleted system rule echoed without its bullet, and "you should cancel / take / exit / decline" as reserved advice.
