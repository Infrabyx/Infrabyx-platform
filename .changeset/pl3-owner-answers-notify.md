---
"@infrabyx/notify": minor
---

Owner answers #22 and #23 (PL3-D-21), migration `notify/0002_service_readers.sql`: the dispatcher
and the unsubscribe link read as the service readers `SVC_NOTIFY_DISPATCH` and
`SVC_NOTIFY_UNSUBSCRIBE`; collection and recovery classes go only inside the contact window
(08:00–21:00 in the recipient's zone, never bypassed), which a product may narrow through the
`contactWindow` hook and never widen; the mandatory class `inbox.escalated`.
