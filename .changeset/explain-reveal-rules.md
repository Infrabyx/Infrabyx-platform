---
"@infrabyx/rules": minor
---

`RulesService` can show one CONFIDENTIAL input of one decision to a caller the product's own rule allows (PR-LDC-59, owner answer #130, R1-D-173; product guide §7cg). Register `revealRule: { id, allows(ctx, req) }`, ask `entitleReveal(ctx, { decisionId, input, purpose })` for a single-use grant valid for 60 seconds, and pass it as `explain(ctx, decisionId, { reveal })`. REGULATED inputs, agents, platform contexts and `PLT_*` roles, break-glass, impersonation and external principals are refused before the product's rule runs (`IPB-RULE-004`). Each reveal is ledgered as `rules.decision.input_revealed` in the same transaction, without the value; nothing is written back. Without a `revealRule`, or without a grant, `explain` is unchanged. No migration.
