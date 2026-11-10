---
"@infrabyx/export": patch
---

Register `export.outbox` for the outbox relay (`export` migration `register_outbox`; LawDocsComply PR-LDC-35, R1-D-112). The outbox was never registered, so `OutboxRelay` neither found nor delivered its events; run `infrabyx-migrate` and the next relay pass delivers the backlog.
