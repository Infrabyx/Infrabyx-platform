# @infrabyx/workflow

Maker-checker around the tenancy approvals engine: the Work Inbox, scheduled actions and delay windows, durable timers, reminders, escalation and expiry, bulk decide, and the standard `RefundApprovals`.

**Specified by:** `docs/ipb/` — IPB-02 §02.4.2, §02.4.6.1, IPB-02-80; IPB-07-14, 07-15, §07.4.9; IPB-01 WORKFLOW. Plan: `docs/phases/PL3-plan.md` §5; as built: PL3-D-19.

## Use

```ts
import { createWorkflow, settingsApprovalPolicy } from "@infrabyx/workflow";

const { approvals, inbox, timers, workflow } = createWorkflow({
  kernel,
  audit,
  outbox,
  product: "LD",
  fieldCrypto,
  settings, // settings: SettingsService
  timerEngine, // optional: TemporalTimers from @infrabyx/connectors/workflow
  notifier, // NOTIFY classes approval.reminder / approval.escalated (from @infrabyx/notify)
});
approvals.register("payments.refund", { financial: true, amountOf: (p) => Number(p.amountMinor) });
const stop = timers.start(60_000); // the PostgreSQL poller and reconciler, always on
```

- **Engine** (`@infrabyx/tenancy`): requests expire after 7 days, or 72 hours for R4, R5 and financial R3; a reminder at 24 hours (or the tenant's shorter `mc.reminder_hours`), an escalation to the tenant's `ORG_ADMIN` role at 48 hours (it never decides); an expired request is terminal (`IPB-UX-012`) and is raised again. `mc.checker_roles.<action>` narrows the checker roles and `mc.dual_checker_above.<action>` adds a second checker above an amount; neither can loosen the platform policy.
- **Work Inbox** (`InboxService`, the `HumanQueue` other packages raise items through): items for a user or a role; an approval item is never shown to its maker; items resolve when the record changes. `list`, `badgeCount`, `markRead`, `resolve`.
- **Scheduled actions:** an approved request with a delay becomes `workflow.scheduled_action`, shown to checkers in the inbox; a timer executes it after `execute_at`. `executeScheduled` before then is `IPB-UX-005`; `cancelScheduled` works for the maker, `ORG_OWNER` and `PLT_SECURITY_OFFICER`.
- **Timers:** every timer is a `workflow.timer` row written in the transaction that needs it. `timers.start()` polls due timers; with `TemporalTimers` they also fire on time (`timerActivities(timers.fireById)` on a worker with `TIMER_WORKFLOWS_PATH`). A failing timer retries with backoff and, after 5 attempts, fails the scheduled action and raises a `job_failed` item.
- **Bulk:** `decideMany` decides each request on its own; above `ux.bulk.confirm_threshold` the caller must type `<decision> <count>` or it is `IPB-UX-006`.
- **`engineRefundApprovals(approvals, ctx)`** is the `RefundApprovals` the PAYMENTS adapters need.

## Migration

`migrations/0001_init.sql` (schema `workflow`), applied by `infrabyx-migrate` after `@infrabyx/rules`; it needs `tenancy/0002`. Run `infrabyx-rls-lint` afterwards.
