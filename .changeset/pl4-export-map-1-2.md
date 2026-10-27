---
"@infrabyx/export": minor
---

Reference export map `REF-EXPORT-1.2` (PL4-D-12): adds the AI run log `ai_runs` (from `ai.run`: model, route, class, usage, cost, guard flags and duration; no content) and the Vidhi action log `vidhi_actions` (from `vidhi.task_step`: task, tool, outcome, approval and actor), as `01 Data/ai_runs.{csv,jsonl}` and `01 Data/vidhi_actions.{csv,jsonl}` (IPB-03-55, 03-83). A minor bump: entities are only added. `REF-EXPORT-1.1` stays registered as `REF_EXPORT_MAP_1_1` for the dual run. The golden archive is regenerated as `golden/REF-EXPORT-1.2`.

export_map: REF-EXPORT-1.2
