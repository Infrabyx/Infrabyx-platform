---
"@infrabyx/contracts": minor
---

Owner answers #34 and #37 (PL4-D-13). **Breaking for manifests:** `SkillTool.locked` is now required, so every tool in a skill manifest declares `locked: true` or `locked: false`; a manifest without it fails validation (`IPB-VID-001` in `SkillRegistry.load`). `false` never unlocks a tool the kernel list matches by name. New service reader role `SVC_AI_INDEX_SWEEP` (`ai.retrieval_index`: id, tenant, state and retirement time) for the retired-version sweep.
