---
"@infrabyx/testing": minor
---

Finbyx PR-FBX-53 (R1-D-266): `queueNameCases()`, the QUEUE contract cases for the platform's name rule (every bad queue name refused `IPB-PORT-003` by `enqueue`, `schedule`, `consume`, `moveToDLQ`, `replay` and `stats`; every bad job name by `enqueue` and `schedule`), with the lists `QUEUE_BAD_QUEUE_NAMES` and `QUEUE_BAD_JOB_NAMES` (a raw CloudEvents type among them). The `bullmq` and `pg-boss` legs run them; run them on your own in-memory QUEUE: `defineContractSuite("QUEUE", () => fixture, queueNameCases())`.
