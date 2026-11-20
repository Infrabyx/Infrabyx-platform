# @infrabyx/rules

## 1.6.4

### Patch Changes

- Updated dependencies [053e16a]
- Updated dependencies [ce8ca22]
- Updated dependencies [b135555]
- Updated dependencies [48810fd]
- Updated dependencies [1ffb012]
  - @infrabyx/contracts@1.40.0
  - @infrabyx/config@1.22.0
  - @infrabyx/connectors@1.24.0
  - @infrabyx/crypto@1.9.1
  - @infrabyx/tenancy@1.21.3

## 1.6.3

### Patch Changes

- Updated dependencies [5fd012a]
- Updated dependencies [3b57c29]
- Updated dependencies [4d509e6]
  - @infrabyx/contracts@1.39.0
  - @infrabyx/crypto@1.9.0
  - @infrabyx/config@1.21.0
  - @infrabyx/connectors@1.23.0
  - @infrabyx/tenancy@1.21.2

## 1.6.2

### Patch Changes

- Updated dependencies [3c4b588]
  - @infrabyx/contracts@1.38.0
  - @infrabyx/crypto@1.8.0
  - @infrabyx/config@1.20.1
  - @infrabyx/connectors@1.22.1
  - @infrabyx/tenancy@1.21.1

## 1.6.1

### Patch Changes

- Updated dependencies [82dc7ef]
- Updated dependencies [1cdbf0f]
- Updated dependencies [2f9d3f8]
- Updated dependencies [b0e0b72]
- Updated dependencies [1cdbf0f]
- Updated dependencies [9e626ef]
- Updated dependencies [aac1c2c]
- Updated dependencies [62dc1eb]
- Updated dependencies [d58d5f0]
- Updated dependencies [7d70042]
- Updated dependencies [dbaecff]
- Updated dependencies [80a843a]
- Updated dependencies [1cdbf0f]
- Updated dependencies [ff2a74b]
- Updated dependencies [d35f7e9]
  - @infrabyx/contracts@1.37.0
  - @infrabyx/connectors@1.22.0
  - @infrabyx/tenancy@1.21.0
  - @infrabyx/crypto@1.7.0
  - @infrabyx/config@1.20.0

## 1.6.0

### Minor Changes

- 4af2688: Owner answer #132 (4) and (5) (R1-D-187). A reveal names a purpose code (`RevealRequest.purposeCode`; `RevealRule.purposeCodes`, default `REVEAL_PURPOSE_CODES`; refused `purpose_code_invalid`), recorded as the business id `purpose:<code>`. Refused reveals are kept as security audit events in `audit.security_event` (migration `audit/0012`; `PgSecurityEvents`, `SecurityEventSink`), outside the business ledger, never with the value; the threshold-th refusal of one principal within the window raises `RevealRefusalsRepeated` (settings `rules.reveal.refusal_alert_threshold`, `rules.reveal.refusal_alert_window_minutes`). A `revealRule` now requires `securityEvents`, `refusalCounter` and `outbox`. `defineRulesRevealContract` sends a purpose code and checks its refusal.

### Patch Changes

- Updated dependencies [4af2688]
- Updated dependencies [955cc67]
  - @infrabyx/contracts@1.36.0
  - @infrabyx/config@1.19.0
  - @infrabyx/connectors@1.21.0
  - @infrabyx/crypto@1.6.2
  - @infrabyx/tenancy@1.20.7

## 1.5.4

### Patch Changes

- Updated dependencies [3a33260]
- Updated dependencies [a6929eb]
  - @infrabyx/connectors@1.20.0
  - @infrabyx/contracts@1.35.0
  - @infrabyx/config@1.18.1
  - @infrabyx/crypto@1.6.1
  - @infrabyx/tenancy@1.20.6

## 1.5.3

### Patch Changes

- Updated dependencies [3e69471]
- Updated dependencies [3e69471]
- Updated dependencies [3e69471]
- Updated dependencies [3e69471]
  - @infrabyx/config@1.18.0
  - @infrabyx/connectors@1.19.0
  - @infrabyx/contracts@1.34.0
  - @infrabyx/crypto@1.6.0
  - @infrabyx/tenancy@1.20.5

## 1.5.2

### Patch Changes

- Updated dependencies [34f5e49]
- Updated dependencies [34f5e49]
- Updated dependencies [34f5e49]
  - @infrabyx/config@1.17.0
  - @infrabyx/connectors@1.18.0
  - @infrabyx/contracts@1.33.0
  - @infrabyx/tenancy@1.20.4
  - @infrabyx/crypto@1.5.18

## 1.5.1

### Patch Changes

- Updated dependencies [6bb68c1]
- Updated dependencies [6bb68c1]
- Updated dependencies [6bb68c1]
  - @infrabyx/config@1.16.0
  - @infrabyx/connectors@1.17.0
  - @infrabyx/contracts@1.32.0
  - @infrabyx/tenancy@1.20.3
  - @infrabyx/crypto@1.5.17

## 1.5.0

### Minor Changes

- 32097cb: Dated, cited and locked rule parameters (LawDocsComply PR-LDC-57, R1-D-146, R1-D-175; product guide §7ch). A rule set's parameter may name a platform parameter schedule instead of a setting: its value is the schedule entry in force at the decision's instant (`asOf`, or now), compared by calendar day in Asia/Kolkata (`SCHEDULE_ZONE`), and it is locked (no setting is read, no default). With no entry in force the decision is UNDETERMINED with reason `parameter_not_in_force`. The decision log and `explain` cite the schedule key, version, entry date and citation (`source: "schedule"`); `explain` now lists parameters in their declared order. Schedules are written in a platform context only (`createSchedule`, `saveScheduleDraft`, `publishSchedule`, `reopenSchedule`), published through `rules.ruleset.publish` (R4, payload `kind: "schedule"`; requests without `kind` stay rule-set publications) with the scheduled cut-over, immutable once published, and read by every tenant (`listSchedules`, `getSchedule`). A rule set naming an unknown or unpublished schedule, one of another type, or one with an entry outside the parameter's bounds is refused (`IPB-RULE-001`). New migration `rules/0005_parameter_schedule.sql` (expand-only: `rules.parameter_schedule`, `rules.parameter_schedule_version`, forced RLS, an immutability trigger): run `infrabyx-migrate`.

### Patch Changes

- Updated dependencies [32097cb]
- Updated dependencies [32097cb]
  - @infrabyx/connectors@1.16.4
  - @infrabyx/contracts@1.31.0
  - @infrabyx/config@1.15.2
  - @infrabyx/crypto@1.5.16
  - @infrabyx/tenancy@1.20.2

## 1.4.0

### Minor Changes

- c79fef5: `RulesService` can show one CONFIDENTIAL input of one decision to a caller the product's own rule allows (PR-LDC-59, owner answer #130, R1-D-173; product guide §7cg). Register `revealRule: { id, allows(ctx, req) }`, ask `entitleReveal(ctx, { decisionId, input, purpose })` for a single-use grant valid for 60 seconds, and pass it as `explain(ctx, decisionId, { reveal })`. REGULATED inputs, agents, platform contexts and `PLT_*` roles, break-glass, impersonation and external principals are refused before the product's rule runs (`IPB-RULE-004`). Each reveal is ledgered as `rules.decision.input_revealed` in the same transaction, without the value; nothing is written back. Without a `revealRule`, or without a grant, `explain` is unchanged. No migration.

### Patch Changes

- Updated dependencies [c79fef5]
  - @infrabyx/contracts@1.30.0
  - @infrabyx/config@1.15.1
  - @infrabyx/connectors@1.16.3
  - @infrabyx/crypto@1.5.15
  - @infrabyx/tenancy@1.20.1

## 1.3.2

### Patch Changes

- Updated dependencies [bb9f524]
  - @infrabyx/connectors@1.16.2

## 1.3.1

### Patch Changes

- Updated dependencies [07cdac1]
  - @infrabyx/connectors@1.16.1

## 1.3.0

### Minor Changes

- 1089dc7: `RulesService.project` for rule sets created with `purpose: "projection"` (PR-LDC-49; migration `rules/0004`): outcomes for up to 1,000 inputs, with no decision record, ledger entry or decision id. `evaluate` refuses projection sets and `project` refuses decision-grade sets.

### Patch Changes

- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
  - @infrabyx/contracts@1.29.0
  - @infrabyx/tenancy@1.20.0
  - @infrabyx/config@1.15.0
  - @infrabyx/connectors@1.16.0
  - @infrabyx/crypto@1.5.14

## 1.2.3

### Patch Changes

- Updated dependencies [15be78b]
- Updated dependencies [15be78b]
- Updated dependencies [15be78b]
- Updated dependencies [15be78b]
- Updated dependencies [15be78b]
- Updated dependencies [15be78b]
- Updated dependencies [15be78b]
  - @infrabyx/contracts@1.28.0
  - @infrabyx/tenancy@1.19.0
  - @infrabyx/config@1.14.0
  - @infrabyx/connectors@1.15.0
  - @infrabyx/crypto@1.5.13

## 1.2.2

### Patch Changes

- Updated dependencies [043a348]
- Updated dependencies [043a348]
- Updated dependencies [043a348]
  - @infrabyx/contracts@1.27.0
  - @infrabyx/config@1.13.4
  - @infrabyx/connectors@1.14.5
  - @infrabyx/crypto@1.5.12
  - @infrabyx/tenancy@1.18.2

## 1.2.1

### Patch Changes

- Updated dependencies [26c3035]
  - @infrabyx/connectors@1.14.4

## 1.2.0

### Minor Changes

- 0aa0f1d: Register `rules.outbox` for the outbox relay (`rules/0003`; LawDocsComply PR-LDC-35, R1-D-112), so `RuleSetPublished` is delivered. And a scheduled cut-over (PR-LDC-34, R1-D-113): `publish(ctx, ruleSetId, version, { effectiveFrom })` takes a cut-over instant (now to 366 days ahead) that the R4 request shows; the previous version stays in force until it, `RuleSetPublished.effective_from` carries it, one cut-over may be pending per rule set, and `RuleSetSummary` gains `scheduledVersion` and `scheduledFrom`.

### Patch Changes

- Updated dependencies [0aa0f1d]
- Updated dependencies [0aa0f1d]
- Updated dependencies [0aa0f1d]
  - @infrabyx/config@1.13.3
  - @infrabyx/tenancy@1.18.1
  - @infrabyx/contracts@1.26.0
  - @infrabyx/connectors@1.14.3
  - @infrabyx/crypto@1.5.11

## 1.1.7

### Patch Changes

- Updated dependencies [496180e]
  - @infrabyx/contracts@1.25.0
  - @infrabyx/tenancy@1.18.0
  - @infrabyx/config@1.13.2
  - @infrabyx/connectors@1.14.2
  - @infrabyx/crypto@1.5.10

## 1.1.6

### Patch Changes

- Updated dependencies [e86dedf]
  - @infrabyx/tenancy@1.17.0
  - @infrabyx/contracts@1.24.0
  - @infrabyx/connectors@1.14.1
  - @infrabyx/config@1.13.1
  - @infrabyx/crypto@1.5.9

## 1.1.5

### Patch Changes

- Updated dependencies [d3888de]
  - @infrabyx/connectors@1.14.0
  - @infrabyx/config@1.13.0
  - @infrabyx/tenancy@1.16.1

## 1.1.4

### Patch Changes

- Updated dependencies [67be297]
- Updated dependencies [67be297]
- Updated dependencies [67be297]
- Updated dependencies [67be297]
  - @infrabyx/contracts@1.23.0
  - @infrabyx/connectors@1.13.0
  - @infrabyx/tenancy@1.16.0
  - @infrabyx/config@1.12.1
  - @infrabyx/crypto@1.5.8

## 1.1.3

### Patch Changes

- Updated dependencies [3c9bb25]
- Updated dependencies [3c9bb25]
- Updated dependencies [3c9bb25]
- Updated dependencies [3c9bb25]
  - @infrabyx/config@1.12.0
  - @infrabyx/tenancy@1.15.0
  - @infrabyx/contracts@1.22.0
  - @infrabyx/connectors@1.12.2
  - @infrabyx/crypto@1.5.7

## 1.1.2

### Patch Changes

- Updated dependencies [bc2c301]
  - @infrabyx/tenancy@1.14.1
  - @infrabyx/connectors@1.12.1

## 1.1.1

### Patch Changes

- Updated dependencies [1dda4b2]
- Updated dependencies [1dda4b2]
- Updated dependencies [1dda4b2]
- Updated dependencies [1dda4b2]
  - @infrabyx/tenancy@1.14.0
  - @infrabyx/config@1.11.0
  - @infrabyx/connectors@1.12.0
  - @infrabyx/contracts@1.21.0
  - @infrabyx/crypto@1.5.6

## 1.1.0

### Minor Changes

- b8c1f2c: `RulesService` (R1-plan M55; R1-D-86, R1-D-88): rule parameters from the product's settings (`settings` option; drafts refuse unregistered keys; an invalid tenant value is UNDETERMINED `parameter_invalid`; values and their source in the decision log and `explain`); `evaluate(ctx, { ruleSetId, asOf }, input)` against the version in force then; `publishCheckerRoles` adds a product's tenant roles to the publish checkers (#109); `prepare(ctx, ruleSetIds?)` compiles the in-force versions ahead of traffic, and an executed publish compiles its version. Migration `rules/0002` adds `decision_log.parameters` and `as_of` (expand-only).

### Patch Changes

- Updated dependencies [b8c1f2c]
- Updated dependencies [b8c1f2c]
- Updated dependencies [b8c1f2c]
  - @infrabyx/connectors@1.11.0
  - @infrabyx/contracts@1.20.0
  - @infrabyx/tenancy@1.13.0
  - @infrabyx/config@1.10.1
  - @infrabyx/crypto@1.5.5

## 1.0.28

### Patch Changes

- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
  - @infrabyx/tenancy@1.12.0
  - @infrabyx/connectors@1.10.0
  - @infrabyx/contracts@1.19.0
  - @infrabyx/config@1.10.0
  - @infrabyx/crypto@1.5.4

## 1.0.27

### Patch Changes

- Updated dependencies [9c368c7]
- Updated dependencies [9c368c7]
- Updated dependencies [9c368c7]
- Updated dependencies [9c368c7]
- Updated dependencies [9c368c7]
- Updated dependencies [9c368c7]
  - @infrabyx/connectors@1.9.0
  - @infrabyx/tenancy@1.11.0
  - @infrabyx/contracts@1.18.0
  - @infrabyx/config@1.9.2
  - @infrabyx/crypto@1.5.3

## 1.0.26

### Patch Changes

- Updated dependencies [714ad01]
  - @infrabyx/contracts@1.17.0
  - @infrabyx/config@1.9.1
  - @infrabyx/connectors@1.8.1
  - @infrabyx/crypto@1.5.2
  - @infrabyx/tenancy@1.10.1

## 1.0.25

### Patch Changes

- Updated dependencies [b3edda2]
- Updated dependencies [b3edda2]
- Updated dependencies [b3edda2]
- Updated dependencies [b3edda2]
- Updated dependencies [b3edda2]
- Updated dependencies [b3edda2]
- Updated dependencies [b3edda2]
  - @infrabyx/config@1.9.0
  - @infrabyx/tenancy@1.10.0
  - @infrabyx/connectors@1.8.0
  - @infrabyx/contracts@1.16.0
  - @infrabyx/crypto@1.5.1

## 1.0.24

### Patch Changes

- Updated dependencies [fdd1f1a]
- Updated dependencies [fdd1f1a]
- Updated dependencies [ed143e3]
- Updated dependencies [ed143e3]
  - @infrabyx/config@1.8.0
  - @infrabyx/connectors@1.7.0
  - @infrabyx/tenancy@1.9.2

## 1.0.23

### Patch Changes

- Updated dependencies [2a95100]
- Updated dependencies [2a95100]
- Updated dependencies [3073ca6]
  - @infrabyx/connectors@1.6.0
  - @infrabyx/config@1.7.0
  - @infrabyx/crypto@1.5.0
  - @infrabyx/tenancy@1.9.1

## 1.0.22

### Patch Changes

- Updated dependencies [7910610]
- Updated dependencies [1b99d7a]
- Updated dependencies [c83e9e0]
- Updated dependencies [af2ae98]
- Updated dependencies [c4117e4]
- Updated dependencies [1e721cd]
- Updated dependencies [1e721cd]
- Updated dependencies [854e309]
- Updated dependencies [854e309]
- Updated dependencies [0da0398]
- Updated dependencies [05c3122]
- Updated dependencies [3d8dfd6]
- Updated dependencies [0a33a67]
  - @infrabyx/tenancy@1.9.0
  - @infrabyx/contracts@1.15.0
  - @infrabyx/connectors@1.5.0
  - @infrabyx/config@1.6.0
  - @infrabyx/crypto@1.4.0

## 1.0.21

### Patch Changes

- Updated dependencies [97e8524]
- Updated dependencies [e41c3bd]
- Updated dependencies [92706c4]
- Updated dependencies [92706c4]
- Updated dependencies [4a87754]
- Updated dependencies [d66ffad]
  - @infrabyx/contracts@1.14.0
  - @infrabyx/tenancy@1.8.0
  - @infrabyx/connectors@1.4.0
  - @infrabyx/config@1.5.2
  - @infrabyx/crypto@1.3.1

## 1.0.20

### Patch Changes

- Updated dependencies [32b53ee]
- Updated dependencies [cff2a02]
  - @infrabyx/crypto@1.3.0
  - @infrabyx/contracts@1.13.0
  - @infrabyx/config@1.5.1
  - @infrabyx/connectors@1.3.6
  - @infrabyx/tenancy@1.7.2

## 1.0.19

### Patch Changes

- Updated dependencies [63c5ad2]
- Updated dependencies [63c5ad2]
  - @infrabyx/config@1.5.0
  - @infrabyx/contracts@1.12.0
  - @infrabyx/connectors@1.3.5
  - @infrabyx/tenancy@1.7.1
  - @infrabyx/crypto@1.2.7

## 1.0.18

### Patch Changes

- Updated dependencies [2e3a2d3]
- Updated dependencies [2e3a2d3]
- Updated dependencies [3f20011]
- Updated dependencies [3f20011]
  - @infrabyx/contracts@1.11.0
  - @infrabyx/tenancy@1.7.0
  - @infrabyx/config@1.4.1
  - @infrabyx/connectors@1.3.4
  - @infrabyx/crypto@1.2.6

## 1.0.17

### Patch Changes

- Updated dependencies [138ae44]
- Updated dependencies [138ae44]
- Updated dependencies [138ae44]
  - @infrabyx/config@1.4.0
  - @infrabyx/contracts@1.10.0
  - @infrabyx/tenancy@1.6.0
  - @infrabyx/connectors@1.3.3
  - @infrabyx/crypto@1.2.5

## 1.0.16

### Patch Changes

- Updated dependencies [2b307e0]
- Updated dependencies [2b307e0]
  - @infrabyx/contracts@1.9.0
  - @infrabyx/tenancy@1.5.0
  - @infrabyx/connectors@1.3.2
  - @infrabyx/config@1.3.2
  - @infrabyx/crypto@1.2.4

## 1.0.15

### Patch Changes

- Updated dependencies [cd25633]
- Updated dependencies [cd25633]
  - @infrabyx/contracts@1.8.0
  - @infrabyx/tenancy@1.4.0
  - @infrabyx/connectors@1.3.1
  - @infrabyx/config@1.3.1
  - @infrabyx/crypto@1.2.3

## 1.0.14

### Patch Changes

- Updated dependencies [94b706e]
- Updated dependencies [94b706e]
  - @infrabyx/config@1.3.0
  - @infrabyx/connectors@1.3.0
  - @infrabyx/tenancy@1.3.5

## 1.0.13

### Patch Changes

- Updated dependencies [f5622c9]
- Updated dependencies [f5622c9]
- Updated dependencies [f5622c9]
  - @infrabyx/config@1.2.0
  - @infrabyx/connectors@1.2.0
  - @infrabyx/contracts@1.7.0
  - @infrabyx/tenancy@1.3.4
  - @infrabyx/crypto@1.2.2

## 1.0.12

### Patch Changes

- Updated dependencies [ceabe3b]
  - @infrabyx/contracts@1.6.0
  - @infrabyx/config@1.1.1
  - @infrabyx/connectors@1.1.1
  - @infrabyx/crypto@1.2.1
  - @infrabyx/tenancy@1.3.3

## 1.0.11

### Patch Changes

- Updated dependencies [849b8f9]
- Updated dependencies [849b8f9]
- Updated dependencies [849b8f9]
- Updated dependencies [849b8f9]
  - @infrabyx/config@1.1.0
  - @infrabyx/connectors@1.1.0
  - @infrabyx/contracts@1.5.0
  - @infrabyx/crypto@1.2.0
  - @infrabyx/tenancy@1.3.2

## 1.0.10

### Patch Changes

- Updated dependencies [7e38652]
- Updated dependencies [7e38652]
  - @infrabyx/contracts@1.4.0
  - @infrabyx/crypto@1.1.0
  - @infrabyx/config@1.0.6
  - @infrabyx/connectors@1.0.10
  - @infrabyx/tenancy@1.3.1

## 1.0.9

### Patch Changes

- Updated dependencies [3a58947]
  - @infrabyx/connectors@1.0.9

## 1.0.8

### Patch Changes

- Updated dependencies [b6058d3]
- Updated dependencies [b6058d3]
  - @infrabyx/contracts@1.3.0
  - @infrabyx/tenancy@1.3.0
  - @infrabyx/config@1.0.5
  - @infrabyx/connectors@1.0.8
  - @infrabyx/crypto@1.0.3

## 1.0.7

### Patch Changes

- Updated dependencies [1c869a8]
  - @infrabyx/config@1.0.4
  - @infrabyx/connectors@1.0.7
  - @infrabyx/tenancy@1.2.1

## 1.0.6

### Patch Changes

- Updated dependencies [75e9ea4]
- Updated dependencies [75e9ea4]
  - @infrabyx/contracts@1.2.0
  - @infrabyx/tenancy@1.2.0
  - @infrabyx/connectors@1.0.6
  - @infrabyx/config@1.0.3
  - @infrabyx/crypto@1.0.2

## 1.0.5

### Patch Changes

- Updated dependencies [c0ce8ff]
- Updated dependencies [2724cd6]
  - @infrabyx/tenancy@1.1.3
  - @infrabyx/connectors@1.0.5

## 1.0.4

### Patch Changes

- Updated dependencies [900b070]
  - @infrabyx/connectors@1.0.4

## 1.0.3

### Patch Changes

- Updated dependencies [8a2587e]
- Updated dependencies [8a2587e]
  - @infrabyx/config@1.0.2
  - @infrabyx/tenancy@1.1.2
  - @infrabyx/connectors@1.0.3

## 1.0.2

### Patch Changes

- Updated dependencies [53a973c]
- Updated dependencies [53a973c]
  - @infrabyx/connectors@1.0.2
  - @infrabyx/tenancy@1.1.1

## 1.0.1

### Patch Changes

- Updated dependencies [588b509]
- Updated dependencies [588b509]
  - @infrabyx/contracts@1.1.0
  - @infrabyx/tenancy@1.1.0
  - @infrabyx/connectors@1.0.1
  - @infrabyx/config@1.0.1
  - @infrabyx/crypto@1.0.1

## 1.0.0

### Major Changes

- 9ec9a2c: 1.0.0, the platform baseline release (IPB-14 §14.5 item 1; owner answer #67(4), PL6-D-16). Every `@infrabyx/*` package moves to 1.0.0 together; the public API is unchanged from the 0.x set of the PL6 gate (`docs/phases/PL6-gate.md` §6), so a product upgrades by moving every dependency to 1.0.0 at once. From 1.0.0 on, semantic versioning holds: a breaking change to an export, a migration or a setting is a major release with an ADR (IPB-09-34/35).

### Patch Changes

- Updated dependencies [9ec9a2c]
  - @infrabyx/config@1.0.0
  - @infrabyx/connectors@1.0.0
  - @infrabyx/contracts@1.0.0
  - @infrabyx/crypto@1.0.0
  - @infrabyx/tenancy@1.0.0

## 0.1.3

### Patch Changes

- Updated dependencies [60db887]
- Updated dependencies [cb669ac]
- Updated dependencies [9d8cd8c]
- Updated dependencies [cb669ac]
- Updated dependencies [b3934f9]
  - @infrabyx/connectors@0.5.0
  - @infrabyx/tenancy@0.6.0
  - @infrabyx/config@0.5.1

## 0.1.2

### Patch Changes

- Updated dependencies [de53086]
- Updated dependencies [de53086]
- Updated dependencies [f1a36a1]
- Updated dependencies [1fecf45]
- Updated dependencies [1fecf45]
- Updated dependencies [1fecf45]
- Updated dependencies [b0dc390]
- Updated dependencies [b0dc390]
- Updated dependencies [b0dc390]
- Updated dependencies [275d4ba]
- Updated dependencies [934355c]
- Updated dependencies [686d24b]
- Updated dependencies [686d24b]
- Updated dependencies [e8e83cb]
- Updated dependencies [275d4ba]
- Updated dependencies [36338c3]
- Updated dependencies [934355c]
- Updated dependencies [b7de3c6]
- Updated dependencies [e8e83cb]
- Updated dependencies [275d4ba]
  - @infrabyx/config@0.5.0
  - @infrabyx/contracts@0.5.0
  - @infrabyx/connectors@0.4.0
  - @infrabyx/tenancy@0.5.0
  - @infrabyx/crypto@0.4.1

## 0.1.1

### Patch Changes

- Updated dependencies [2b07109]
- Updated dependencies [200b25a]
- Updated dependencies [f6e9a88]
- Updated dependencies [ca72d67]
- Updated dependencies [f6e9a88]
- Updated dependencies [bfa324d]
- Updated dependencies [f6e9a88]
- Updated dependencies [200b25a]
- Updated dependencies [9af583a]
- Updated dependencies [288ae44]
- Updated dependencies [b205b1d]
- Updated dependencies [183c532]
- Updated dependencies [f6e9a88]
- Updated dependencies [183c532]
- Updated dependencies [200b25a]
- Updated dependencies [b205b1d]
  - @infrabyx/contracts@0.4.0
  - @infrabyx/config@0.4.0
  - @infrabyx/connectors@0.3.0
  - @infrabyx/crypto@0.4.0
  - @infrabyx/tenancy@0.4.0

## 0.1.0

### Minor Changes

- 3951517: Owner answer #21 (PL3-D-21): an UNDETERMINED decision's review task goes to ORG_CHECKER, or to
  ORG_ADMIN when the tenant has no checker (`hasRoleHolder`); the principal whose request produced
  it is excluded; it escalates to ORG_ADMIN after 48 hours. One `rules.decision.record` ledger entry
  per decision stays.
- 53697f5: First release (publishable, PL1-D-20): `RulesService` implements RULES_PORT — rule sets as
  versioned `ipb.decision_table.v1` tables, drafts validated on every engine, publish through an R4
  maker-checker request (`rules.ruleset.publish`), evaluation with a decision log and sealed inputs,
  `UNDETERMINED` to the Work Inbox, `simulate`, `explain` and platform rule sets in `tnt_platform`.
  Migration `rules/0001_init.sql` (PL3-D-18).

### Patch Changes

- Updated dependencies [50093e9]
- Updated dependencies [2725b6c]
- Updated dependencies [dd7a98b]
- Updated dependencies [50093e9]
- Updated dependencies [1ed0659]
- Updated dependencies [53697f5]
- Updated dependencies [dd7a98b]
- Updated dependencies [50093e9]
- Updated dependencies [e268b60]
- Updated dependencies [1ed0659]
- Updated dependencies [2725b6c]
- Updated dependencies [1ed0659]
- Updated dependencies [53697f5]
- Updated dependencies [dd7a98b]
- Updated dependencies [e268b60]
- Updated dependencies [1ed0659]
- Updated dependencies [50093e9]
- Updated dependencies [53697f5]
- Updated dependencies [3951517]
- Updated dependencies [3951517]
- Updated dependencies [dd7a98b]
- Updated dependencies [e268b60]
- Updated dependencies [1ed0659]
- Updated dependencies [53697f5]
- Updated dependencies [dd7a98b]
  - @infrabyx/config@0.3.0
  - @infrabyx/connectors@0.2.0
  - @infrabyx/contracts@0.3.0
  - @infrabyx/crypto@0.3.0
  - @infrabyx/tenancy@0.3.0
