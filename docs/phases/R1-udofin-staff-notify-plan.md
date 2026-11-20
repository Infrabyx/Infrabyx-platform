# R1 plan: staff and RE-administrator notifications by role (PR-UDF-052)

Owner's order, 19 Nov 2026 night (item E5 of E1 to E8, each planned and built as its own PR). Decision R1-D-222. Spec of record: IPB-07-25 (notification design: digest-first, quiet hours, channel preferences, mandatory classes locked but routable, a deep link and a help key on every notification), IPB-01 NOTIFY (one call fans out; principal references, never addresses), IPB-02-03 and §02.4 (tenant isolation under forced RLS; every mutation ledgered), IPB-02-10 (agents are makers only). Nothing under `docs/ipb/` or `docs/ecosystem/` is edited.

## A. What Udofin asked for

"A staff and RE-administrator channel: email and in-app to a person by role in a tenant ("the RE's admins", "Udofin operations"), with a template class, no personal data in the subject, and a delivery receipt. Today NOTIFY's product door serves borrowers only."

`NotifyService.send` takes explicit principal references. Udofin calls it with borrower party references; for staff it would have to look up who holds a role itself, outside NOTIFY's ledger entry, and nothing stops a staff message from carrying a borrower's name or number in its subject. The only role-resolving door is the workflow `ApprovalNotifier`, fixed to three maker-checker classes, and it takes role members from a product callback.

## B. Design

1. **A staff class** (`contracts` `NotificationClass`): `audience: staff` marks a class that goes only to staff by role. The catalogue refuses a staff class that is `marketing`, uses a channel other than `inapp` and `email`, or does not declare `variables`; `subject_variables` (a subset of `variables`, default none) lists the only variables its subject or title may carry. Every other rule of IPB-07-25 applies unchanged: a staff class needs a deep link and a help key; `mandatory` (operational) staff classes cannot be switched off but can be routed (`ntf.org.routing`); optional ones follow the person's `ntf.user.channels`; non-urgent ones are digest-first; quiet hours, `kill.msg.*`, the platform suppression list, the sandbox rule and the resend classes apply as for any class.
2. **The door** (`notify` `NotifyService`): `notifyStaff(ctx, { class, roles[], vars, deepLink, locale?, idempotencyKey, exclude? })` records and sends now; `enqueueStaff(tx, …)` records inside the caller's transaction for `dispatchDue` (the approval-notifier pattern). The tenant is the verified context's only; there is no tenant field, so one call never reaches another tenant.
3. **Resolution at send time, inside the recording transaction**: every `active` person (`tenancy.user.type = 'user'`; agents and service accounts never) whose `tenancy.membership.roles` holds one of the roles, plus the holders of an active (unrevoked) tenant function when a role is `FN:<CODE>`. Both tables are under forced RLS, so a holder of the same role in another tenant is never seen. `exclude` drops the actor (for example the maker). Roles must be tenant (`ORG_*`), group-operations (`OPS_*`), product or function roles; `PLT_*`, `SVC_*` and `AGT_*` are refused. More than 1,000 holders is refused.
4. **Who was targeted is recorded**: one delivery row per holder and channel (as for `send`), and the ledger entry `notify.notification.create` carries `audience: staff`, the roles and the resolved principal ids (INTERNAL ids, never an address).
5. **No holders**: a recorded outcome, not a refusal. The notification row is written with no delivery and ledgered with `outcome: no_recipients`; the result says `outcome: "no_recipients"`, so the product can fall back (for example to its operations team) under a new idempotency key. A repeat of the same key replays the same outcome. Reason: "the RE has no administrator" is an operational fact the audit should show; a refusal would leave no trace.
6. **No personal data in the subject**, in three layers: (a) every variable name must be in the class's `variables` (unknown names refused); (b) every value is checked: no e-mail address, phone number, PAN, Aadhaar number or VID (`findAadhaarLike`) anywhere, and a subject variable must be a reference or code (`^[A-Za-z0-9][A-Za-z0-9_.:/#-]{0,79}$`, no run of 10 or more digits), a number or a boolean; (c) the subject and title templates may use only `subject_variables`: the in-app and push title texts (`messages`) are checked when `NotifyService` is built (a finding fails boot), and a tenant's own email template for a staff class is refused by the template lint (at save, and again at every delivery and preview) when its subject uses another variable. A vendor-side template (`templates.email.key`) cannot be read by the platform; layers (a) and (b) bound what it can show (residual, threat model §3.152). Refusals are `IPB-NTF-007` (422) with a `reason`.
7. **Staff classes only through the door**: `send` and `enqueue` refuse a staff class (`IPB-NTF-007`, `reason: staff_class`), so the role resolution and the variable checks always run; `notifyStaff` refuses a class that is not a staff class.
8. **Delivery receipt**: `deliveryReceipt(ctx, notificationId)` returns the class, the outcome and, per recipient, every channel's `DeliveryRecord` (state, attempt, adapter, error code, time) and `reached` (any delivery `sent` or `delivered`). The states are the existing delivery states, updated by delivery and by vendor reports (`routeEmailEvents`). There is no new event: delivery state changes have none today; the receipt is read on demand. `deliveryStatus` keeps working.
9. **Addresses**: the product's `ContactResolver` resolves `usr_…` references to a staff e-mail address at delivery, as it does today for approval classes; nothing is stored.
10. **"Udofin operations"**: a team in the operator's own tenant holding `OPS_*` roles. The product sends in that tenant's context (a service context); an RE tenant's event that should alert operations is sent there by the product with references only. No cross-tenant fan-out (assumption, owner question #160).

## C. Data model and migrations

None. Deliveries and notifications use the existing tables (`notify.notification`, `notify.delivery`, `notify.inapp_message`, forced RLS); the roles and targeted ids go in the ledger entry. No setting: the door is used only by calling it with a staff class the product ships.

## D. Contracts (`@infrabyx/contracts`; minor)

- `NotificationClass.audience?: "staff"`, `NotificationClass.subject_variables?: string[]`, with the catalogue rules of §B.1 in its refinement.
- `STAFF_CHANNELS` (`inapp`, `email`), `StaffRole`, `StaffNotificationRequest`, `StaffSendResult` (`SendResult` plus `outcome` and `recipients`), `DeliveryReceipt`.
- `NotifyPort.notifyStaff?` and `NotifyPort.deliveryReceipt?` (optional, so other implementations still compile).
- Error `IPB-NTF-007` "Staff notification refused: class, role, recipients or variables" (422).

## E. Tests (by IPB ID)

- `contracts`: a staff class with SMS, without `variables`, as marketing, or with `subject_variables` outside `variables` is refused; `subject_variables` on a non-staff class is refused; `StaffNotificationRequest` refuses `PLT_*`, `SVC_*`, `AGT_*` and malformed roles (IPB-07-25, IPB-02-10).
- `notify` unit (`staff.test.ts`): unknown variable, e-mail, phone, PAN, Aadhaar-like and free text in a subject variable refused; references, numbers and booleans pass; body variables refuse personal data only; title texts with a non-subject variable fail the boot check; a tenant email template for a staff class whose subject uses a body variable is refused by `lintEmailTemplate` and by `renderEmailTemplate` (IPB-04-28 template lint).
- `notify` PostgreSQL (`staff.int.test.ts`): role resolution (`ORG_ADMIN` holders get in-app and email; a disabled user, an agent and a non-holder do not; `exclude` drops the actor; an `FN:` holder is found, a revoked one is not); cross-tenant isolation (a holder of the same role in another tenant never receives, and its in-app list stays empty); `no_recipients` recorded and ledgered, then replayed; idempotency (same key, one notification, one email); receipt per recipient (`reached`, states, a failed address); a mandatory staff class keeps its channel when the person turns both off (IPB-NTF-001 at preferences), an optional one honours the preference (IPB-07-25 @IPB-07-AT-22 timing unchanged); `send` refuses a staff class; the ledger entry names the roles and the targeted ids (IPB-02 §02.4).

## F. Stubs and exit checklist

No vendor, no network, no migration, no setting. Exit: `build lint typecheck test` for `contracts` and `notify` and their dependants; `notify` `test:int`; `ipb:check`; prettier on changed files; `check:full` where time allows; changeset `.changeset/staff-notify.md` (`contracts` and `notify` minors); guide §7dh; threat model §3.152; DECISIONS R1-D-222; owner question #160; the PR-UDF-052 row's Answer cell updated.

## G. Owner decisions needed

#160 (defaults taken, nothing blocks): (1) "Udofin operations" is the operator tenant's `OPS_*` holders, sent in that tenant's context, no cross-tenant fan-out; (2) an empty role set is a recorded `no_recipients` outcome, not a refusal; (3) subject variables are references or codes only, and body variables are checked for detectable personal data (e-mail, phone, PAN, Aadhaar); (4) staff classes use in-app and email only.
