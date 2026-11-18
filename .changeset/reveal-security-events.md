---
"@infrabyx/contracts": minor
"@infrabyx/audit": minor
"@infrabyx/rules": minor
"@infrabyx/config": minor
"@infrabyx/testing": minor
---

Owner answer #132 (4) and (5) (R1-D-187). A reveal names a purpose code (`RevealRequest.purposeCode`; `RevealRule.purposeCodes`, default `REVEAL_PURPOSE_CODES`; refused `purpose_code_invalid`), recorded as the business id `purpose:<code>`. Refused reveals are kept as security audit events in `audit.security_event` (migration `audit/0012`; `PgSecurityEvents`, `SecurityEventSink`), outside the business ledger, never with the value; the threshold-th refusal of one principal within the window raises `RevealRefusalsRepeated` (settings `rules.reveal.refusal_alert_threshold`, `rules.reveal.refusal_alert_window_minutes`). A `revealRule` now requires `securityEvents`, `refusalCounter` and `outbox`. `defineRulesRevealContract` sends a purpose code and checks its refusal.
