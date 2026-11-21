---
"@infrabyx/audit": minor
---

Udofin PR-UDF-072 (R1-D-262): migration `audit/0013` widens `audit.security_event`'s kind check to admit `connector.retrieval.host_refused` (expand-only; existing rows pass). `PgSecurityEvents.record` refuses an event of a kind with a typed shape whose detail or resource does not fit it, before it takes a connection, so a URL, query or credential never reaches the table. Apply the migration before recording the new kind.
