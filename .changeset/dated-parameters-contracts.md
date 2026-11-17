---
"@infrabyx/contracts": minor
---

Dated rule parameters (PR-LDC-57, R1-D-175; product guide §7ch). `RuleParameter` is now the union of `SettingRuleParameter` (unchanged: `setting` and `default`) and `ScheduleRuleParameter` (`schedule`, no default), with `isScheduleParameter`. New `ParameterScheduleBody` (`ipb.parameter_schedule.v1`: one `type`, 1 to 500 entries in strictly ascending `effectiveFrom` order, each with `citation: { instrumentRef, section, url? }`, and a `reason` for a correction), `ParameterCitation`, `ParameterScheduleEntry`, `ParameterScheduleSummary`, `ScheduleCitationTrace` and `ParameterBounds`. `Explanation.parameters[i].source` may be `"schedule"`, with `schedule: { key, version, effectiveFrom, citation }`; a decision's `reason` may be `parameter_not_in_force`. Additive: existing bodies parse as before.
