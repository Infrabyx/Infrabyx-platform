# @infrabyx/workflow

## 0.1.0

### Minor Changes

- 3951517: Owner answers #21 and #22 (PL3-D-21), migration `workflow/0002_owner_answers_pl3.sql`: inbox items
  raised with `escalateAfterHours` escalate once to ORG_ADMIN through an `inbox.escalate` timer
  (`notifier.itemEscalated`), and the excluded principal never sees or resolves them; the timer
  poller reads as the service reader `SVC_SCHEDULER` instead of `PLT_AUDITOR_RO` (`onServiceRead`).
- dd7a98b: First release (publishable, PL1-D-20): `createWorkflow` wires the approvals engine, the Work Inbox
  (`InboxService`, the `HumanQueue`), scheduled actions and delay windows, durable timers (PostgreSQL
  poller and reconciler; optional Temporal engine), reminders, escalation and expiry, `decideMany`
  with typed confirmation, the settings-backed `mc.*` policy and `engineRefundApprovals`. Migration
  `workflow/0001_init.sql` (PL3-D-19).

### Patch Changes

- Updated dependencies [50093e9]
- Updated dependencies [2725b6c]
- Updated dependencies [dd7a98b]
- Updated dependencies [50093e9]
- Updated dependencies [e268b60]
- Updated dependencies [1ed0659]
- Updated dependencies [2725b6c]
- Updated dependencies [1ed0659]
- Updated dependencies [53697f5]
- Updated dependencies [dd7a98b]
- Updated dependencies [e268b60]
- Updated dependencies [1ed0659]
- Updated dependencies [50093e9]
- Updated dependencies [53697f5]
- Updated dependencies [3951517]
- Updated dependencies [3951517]
- Updated dependencies [dd7a98b]
- Updated dependencies [e268b60]
- Updated dependencies [1ed0659]
- Updated dependencies [53697f5]
- Updated dependencies [dd7a98b]
  - @infrabyx/config@0.3.0
  - @infrabyx/contracts@0.3.0
  - @infrabyx/crypto@0.3.0
  - @infrabyx/tenancy@0.3.0
