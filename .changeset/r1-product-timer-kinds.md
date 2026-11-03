---
"@infrabyx/workflow": minor
---

A product's own durable timer kinds (Udofin PR-UDF-035; Finbyx PR-FBX-13 (1); R1-D-49). `WorkflowTimers.on("<product>.<area>.<name>", handler)` registers a kind; `schedule` and `cancel` take it with a reference of 1 to 64 letters, digits, `_` or `-`, and refuse an unregistered or malformed kind. Migration `workflow/0003` widens the timer table's checks; the platform kinds keep their references. `parseTimerId` reads product kinds for the Temporal engine. Run `infrabyx-migrate`.
