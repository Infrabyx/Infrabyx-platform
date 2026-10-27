---
"@infrabyx/connectors": minor
---

RULES engine adapters (new subpath `@infrabyx/connectors/rules`): `zen` (reference,
`@gorules/zen-engine` 2.1.7), `json-rules` (alternative, `json-rules-engine` 7.3.1) and the memory
CEL row walk, all compiling the platform decision table through one CEL subset parsed and checked
by `@marcbachmann/cel-js` 8.0.0; strict input checks, `UNDETERMINED` on any engine error or timeout,
canary health, and `evaluateCel` (PL3-D-18).
