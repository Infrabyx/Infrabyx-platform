---
"@infrabyx/contracts": minor
---

`SVC_OUTBOX_RELAY` joins `SERVICE_READER_ROLES` (owner answer #74(e), R1-D-01): the outbox relay's service reader, whose tables are the module outboxes registered in the database rather than a static list, and `OUTBOX_DISPATCH_ACTION`, the only kind of write it may make (`<schema>.outbox.dispatch`).
