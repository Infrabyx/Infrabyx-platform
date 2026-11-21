---
"@infrabyx/connectors": minor
---

Finbyx PR-FBX-53 (R1-D-266): the QUEUE adapters (`bullmq`, `pg-boss`) check names with the platform rule from `@infrabyx/contracts/ports` (`assertQueueName`, `assertQueueJob`), so a product's fixture can apply exactly the same rule. The rule is unchanged (lower case; a queue name has no `.` and at most 63 characters, a job name at most 100); refusals now also carry `meta.reason` (`queue_name`, `job_name`, `job_data`). `checkQueue` and `checkJob` stay exported.
