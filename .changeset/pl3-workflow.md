---
"@infrabyx/workflow": minor
---

First release (publishable, PL1-D-20): `createWorkflow` wires the approvals engine, the Work Inbox
(`InboxService`, the `HumanQueue`), scheduled actions and delay windows, durable timers (PostgreSQL
poller and reconciler; optional Temporal engine), reminders, escalation and expiry, `decideMany`
with typed confirmation, the settings-backed `mc.*` policy and `engineRefundApprovals`. Migration
`workflow/0001_init.sql` (PL3-D-19).
