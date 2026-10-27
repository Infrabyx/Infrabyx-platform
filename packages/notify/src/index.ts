// @infrabyx/notify — NOTIFY fan-out to in-app, email, SMS, WhatsApp and push (PL3 plan §6): the
// notification catalogue and its lint (`infrabyx-notify-lint`), routing, quiet hours and digest,
// resend classes, the platform suppression list (C-23), marketing consent, `kill.msg.*`, sealed
// push tokens and the workflow `ApprovalNotifier`.
// Migration: `notify/0001_init.sql`, applied by `infrabyx-migrate` when this package is installed.
export const PACKAGE_NAME = "@infrabyx/notify" as const;
export * from "./catalogue.js";
export * from "./routing.js";
export * from "./service.js";
export * from "./push-store.js";
export * from "./approval-notifier.js";
