---
"@infrabyx/config": patch
---

PL5 session 7: `validateEnv` and `loadAndValidate` give an absent optional variable its schema default (`envVar(z.enum([...]).default("a"), …)`), as its type already promised; before, the value was left out.
