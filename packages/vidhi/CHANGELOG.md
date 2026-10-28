# @infrabyx/vidhi

## 0.2.1

### Patch Changes

- Updated dependencies [9d8cd8c]
- Updated dependencies [b3934f9]
  - @infrabyx/tenancy@0.6.0
  - @infrabyx/config@0.5.1
  - @infrabyx/ai@0.2.1

## 0.2.0

### Minor Changes

- de53086: Owner answers #37 and #40 (PL4-D-13).

  - New CLI `infrabyx-vidhi manifest-lint <dir or file>...`: add it to product CI over the skill manifests. It fails on a tool without an explicit `locked: true` or `locked: false`, and notes a `false` that the kernel locked list overrides (word matching stays the safety net). `lintManifest` is exported too.
  - `QaSampler` reads the governed, tighten-only settings `vidhi.qa.min_reviews`, `vidhi.qa.precision_floor` and `vidhi.qa.recall_floor` per tenant, never below the platform floor of 20 reviews and 0.8 (`QaSampler.floor(ctx)`). **Breaking:** the `floor` constructor option and `QA_DEFAULT_FLOOR` are removed; use `QA_PLATFORM_FLOOR`.

### Patch Changes

- Updated dependencies [de53086]
- Updated dependencies [de53086]
- Updated dependencies [de53086]
- Updated dependencies [f1a36a1]
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
  - @infrabyx/ai@0.2.0
  - @infrabyx/config@0.5.0
  - @infrabyx/contracts@0.5.0
  - @infrabyx/tenancy@0.5.0
  - @infrabyx/crypto@0.4.1

## 0.1.0

### Minor Changes

- b205b1d: First release of the Vidhi kernel core (PL4 session 6, PL4-D-08): migration `vidhi/0001_init.sql`; `SkillRegistry`; the frozen locked-action list with product additions; product ceilings; `Autonomy` (effective level, R4 promotion with evidence, automatic demotion); `TaskRuntime` (the IPB-03 task state machine, approvals for locked actions and L2 writes, kill-switch sweep); `Vidhi.answer` with the persona prompts and reserved-advice hand-off; `aiLabel` and `assistantName`.
- 9af583a: Feedback, QA sampling, the daily digest and AI disclosure (PL4 session 8a, PL4-D-11): migration `vidhi/0004_feedback_qa_digest.sql`; `Feedback` with sealed corrections and the tenant reference set; `QaSampler` with deterministic sampling, owner reviews, precision and recall and demotion below the floor; `Digest` with the daily digest and the action log; `disclosure` and `Vidhi.disclose` for the AI label and the `ai_provenance` sidecar. The promotion evidence window is now compared in SQL, so rows written in a demotion's own transaction no longer count in the new window.
- 288ae44: MCP and knowledge notebooks (PL4 session 7b, PL4-D-10): `McpServer`, `McpToolRegistry` and `checkMcpHeaders` (MCP 2026-07-28, stateless; write and locked tools always wait for the product UI's approval, `IPB-VID-040`); `McpClient` with the narrowing allow-list, class ceilings and rates (`IPB-VID-041`); `Notebooks` with migration `vidhi/0003_notebooks.sql`, sealed sources, class aggregation, grounded outputs through `vidhi.notebook@1` with provenance and staleness, read-only platform notebooks and cross-tenant sharing as a locked action (`IPB-VID-060`); `TaskRuntime.callTool` takes `forceApproval`, and `TaskRuntime.status`.
- 183c532: Scheduled tasks and missions (PL4 session 7a, PL4-D-09): migration `vidhi/0002_missions_schedules.sql`; the in-house RRULE subset (`parseRecurrence`, `nextOccurrence`, DST-correct); `Scheduler` with recurring and event-triggered schedules, the cross-tenant due-run poller (`SVC_VIDHI_SCHED`), the permission re-check before every run, skip (`IPB-VID-020`) and pause (`IPB-VID-021`); `Missions` with the `vidhi.mission_plan@1` planner, budgets (`IPB-VID-070`), the mission level as a cap on its tasks and a lease for resumable runs; `TaskRuntime.create` takes `maxLevel`.

### Patch Changes

- Updated dependencies [2b07109]
- Updated dependencies [200b25a]
- Updated dependencies [c0b6d38]
- Updated dependencies [bfa324d]
- Updated dependencies [b205b1d]
- Updated dependencies [c0b6d38]
- Updated dependencies [f6e9a88]
- Updated dependencies [9af583a]
- Updated dependencies [200b25a]
- Updated dependencies [f6e9a88]
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
  - @infrabyx/ai@0.1.0
  - @infrabyx/config@0.4.0
  - @infrabyx/crypto@0.4.0
  - @infrabyx/tenancy@0.4.0
