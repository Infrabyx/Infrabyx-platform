---
"@infrabyx/connectors": minor
---

CEL string functions in every RULES engine: `s.startsWith(x)`, `s.endsWith(x)`, `s.contains(x)` (a string literal or another string input) and `s.matches("re")`, an unanchored search whose pattern is a literal in a linear-time subset checked when the draft is compiled (`cel_pattern`; at most 256 characters; no back-references, look-around, possessive or nested quantifiers); `zen` and `json-rules` search with `re2js` 2.8.8. String inputs must be well-formed UTF-16 and at most 4 096 characters; `evaluateCel` refuses a `matches` outside the subset (PR-LDC-13; R1-D-71).
