---
"@infrabyx/contracts": minor
"@infrabyx/connectors": minor
"@infrabyx/notify": minor
"@infrabyx/hlp": patch
---

TallyPrime agent key notices (owner answer #139 (1); R1-D-186). `TallyAgentService.sendKeyNotices(ctx)` tells the tenant's administrators on day 80 and again on day 85 of an agent's key, once each, through the new platform notification class `accounting.agent_key_expiring` (mandatory, in-app and email); `TallyAgentView.keyNoticeDay`; `TALLY_AGENT_KEY_NOTICE_DAYS` and `TALLY_AGENT_KEY_NOTICE_CLASS`. From day 90 the gateway's 403 says how to re-enrol (`keyExpiredDetail`). Migration `connectors/0009` (expand-only): `tally_agent.key_notice_day`. Help entry `hlp.notify.accounting.agent_key_expiring`.
