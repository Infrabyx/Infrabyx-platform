---
"@infrabyx/rules": minor
"@infrabyx/contracts": minor
---

Register `rules.outbox` for the outbox relay (`rules/0003`; LawDocsComply PR-LDC-35, R1-D-112), so `RuleSetPublished` is delivered. And a scheduled cut-over (PR-LDC-34, R1-D-113): `publish(ctx, ruleSetId, version, { effectiveFrom })` takes a cut-over instant (now to 366 days ahead) that the R4 request shows; the previous version stays in force until it, `RuleSetPublished.effective_from` carries it, one cut-over may be pending per rule set, and `RuleSetSummary` gains `scheduledVersion` and `scheduledFrom`.
