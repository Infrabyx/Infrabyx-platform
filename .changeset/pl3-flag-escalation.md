---
"@infrabyx/config": minor
---

`FlagService`: the `ops.flags.provider_unreachable` alert escalates when a provider outage passes
1 hour and again at 12 hours (`ALERT_ESCALATIONS`; alert fields `outageS` and `escalation`), once
each per outage, dated from the last provider contact so a restart does not reset it. The IPB-01
24-hour snapshot limit is unchanged (OWNER-QUESTIONS #20, PL3-D-17).
