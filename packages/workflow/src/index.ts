// @infrabyx/workflow — maker-checker around the tenancy engine (PL3 plan §5): the Work Inbox
// (`InboxService`, the `HumanQueue` other packages raise items through), scheduled actions and
// delay windows, durable timers (PostgreSQL poller, optional Temporal engine), reminders,
// escalation and expiry, bulk decide, and the standard `RefundApprovals`.
// Migration: `workflow/0001_init.sql`, applied by `infrabyx-migrate` when this package is installed.
export const PACKAGE_NAME = "@infrabyx/workflow" as const;
export * from "./inbox.js";
export * from "./timers.js";
export * from "./approvals.js";
export * from "./policy.js";
export * from "./setup.js";
