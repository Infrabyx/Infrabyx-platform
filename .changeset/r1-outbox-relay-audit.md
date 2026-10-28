---
"@infrabyx/audit": minor
---

Migration `audit/0002` lets the outbox relay (`svc_outbox_relay`, R1-D-01) append the ledger entry of each batch it dispatches, under the ledger's tenant and actor policy; no read and no other table.
