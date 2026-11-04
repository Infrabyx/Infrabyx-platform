---
"@infrabyx/connectors": minor
---

RULES engines (R1-plan M55; R1-D-88): rule parameters are constants bound at compile time (`compile(body, parameters?)`, defaults otherwise); a row compares an input with a parameter as with a literal on `zen`, `json-rules` and `memory`, and a parameter is never an input. ZEN warms each compiled decision once, so its first evaluation does not pay its lazy set-up inside the time budget (PR-LDC-25).
