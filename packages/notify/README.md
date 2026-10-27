# @infrabyx/notify

NOTIFY fan-out to in-app, email, SMS, WhatsApp and push.

**Specified by:** `docs/ipb/` — IPB-01 NOTIFY and PUSH, IPB-07-25, IPB-02-26, IPB-02-83; Ecosystem spec §4.4, §6.39, §10.2. Plan: `docs/phases/PL3-plan.md` §6; as built: PL3-D-20.

## Use

```ts
import { Catalogue, NotifyService, PgPushTokenStore, notifyApprovalNotifier } from "@infrabyx/notify";

const notify = new NotifyService({
  kernel, audit, product: "LD", outbox, settings, flags, humanQueue,
  catalogue: Catalogue.load(["notify/catalogue"]), // the platform file plus the product's
  contacts,          // ContactResolver: principal reference → address, never stored
  consentKey,        // C-23 group consent key, from SECRETS
  channels: { email: { port: router.port("EMAIL"), brand: "ld" }, sms: { ... }, push: { port: expo } },
});
await notify.send(ctx, { class: "approval.requested", to: [{ ref: "usr_…" }], vars: { id }, deepLink: `/approvals/${id}`, idempotencyKey });
setInterval(() => notify.dispatchDue(), 60_000); // queued, deferred and digest deliveries
```

- **Catalogue** (`notify/catalogue/*.yaml`, schema in `@infrabyx/contracts`): every class has a resend class, a help key and a deep link. `infrabyx-notify-lint` refuses duplicates, a channel without its template, marketing on WhatsApp while `mkt.meta.enabled` is false, and collection, recovery and legal notices that do not list `whatsapp` under `never_channels`.
- **Routing:** catalogue defaults → `ntf.org.routing` → the user's `ntf.user.channels` (a user can only switch channels off; a mandatory class keeps one, `IPB-NTF-001`). Non-urgent classes go to the daily digest (`ntf.user.digest_time`); an urgent class inside quiet hours (`ntf.quiet_hours`) goes at once only if the class and `ntf.org.allow_quiet_hours_bypass` allow it. Times use the recipient's zone (default Asia/Kolkata).
- **Kill switches:** `kill.msg.<channel>` refuses that channel before any I/O (`killed`).
- **Resend classes** (owner, PL2-D-65): after an unknown vendor outcome a `safe` class is resent once on the same delivery row; a `hold` class is never resent automatically. The delivery is `held` and a Work Inbox task (`confirm_resend`) goes to `ORG_ADMIN`, and `decideHeld` records the person's choice.
- **Suppression:** the platform list is the single source of truth. Hard bounces and complaints from delivery reports block the address for every tenant; tenant entries cover opt-outs and manual blocks. Addresses are kept only as C-23 keyed hashes. Lifting an entry is an R2 request (`requestLift`, `registerApprovals`).
- **Marketing consent:** default deny. `setMarketingConsent` takes the address, which is hashed and never stored. The one-click unsubscribe uses a random token (stored hashed, one use, 90 days) and withdraws the consent; `onConsentChanged` gets the Ecosystem `MarketingConsentUpdated` data for the product to publish.
- **Push:** `PgPushTokenStore` seals device tokens with FieldCrypto for the PUSH adapters in `@infrabyx/connectors/push`.
- **Delivery reports:** `handleEmailEvents`, `handleSmsReports` and `handleWhatsappEvents` take the events the adapters verified.
- **Workflow:** `notifyApprovalNotifier(notify, members)` is the `ApprovalNotifier` for `createWorkflow`. Reminders and escalations are recorded inside the timer's transaction and delivered by the dispatcher.

## Migration

`migrations/0001_init.sql` (schema `notify`), applied by `infrabyx-migrate` after `@infrabyx/workflow`.
