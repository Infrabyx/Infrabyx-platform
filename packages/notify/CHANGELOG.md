# @infrabyx/notify

## 1.3.1

### Patch Changes

- Updated dependencies [bc2c301]
  - @infrabyx/tenancy@1.14.1

## 1.3.0

### Minor Changes

- 1dda4b2: Tenant notification templates (LawDocsComply PR-LDC-27; R1-plan M58; R1-D-90). `TenantTemplateStore` keeps versioned tenant overrides per class, channel and locale in `notify.tenant_template` (migration `notify/0004`, expand-only, forced RLS) behind wave 2's `TemplateResolver`: pass `store.resolver.resolve` as `templates`. An email override is a subject, a required plain-text part and an optional HTML part with `{{var}}` placeholders, linted by `lintEmailTemplate` (the class's variable whitelist, `templateVariables`; field limits; a strict HTML allow-list with no script, style, iframe, form or embedded content, no event handlers, https, mailto and tel links only, no remote images and no variables in attributes) and rendered by `renderEmailTemplate` with every HTML value escaped; security classes keep the catalogue's email. SMS and WhatsApp overrides only select a template the product's `TemplateRegistry` has registered for the tenant (DLT template with its sender and entity ids; an approved WhatsApp template by name and language), never free text, and a selection no longer registered fails the delivery closed. Every change is the R3 maker-checker request `notify.template.change` (`requestChange`, tenant owner, admin or maker; `registerApprovals`, tenant checkers only), whose executor checks the content digest and the base version, supersedes the previous version and ledgers `notify.template.activate` in the approving transaction; `history`, `get` and `resolvedOf` read the versions. `NotifyService.previewTemplate(ctx, class, channel, locale, vars)` returns the message delivery would hand the port, built by the same code. The email channel sends tenant content as `EmailMessage.content` and refuses an adapter without the `content` capability. Catalogue classes may declare `variables`; the platform classes now do where their variables are known, and the catalogue lint checks them against the SMS and WhatsApp template variables.
- 1dda4b2: Sandbox tenants (LawDocsComply PR-LDC-29; R1-plan M60; R1-D-87), failing closed.

  - `contracts`: `KernelContext.sandbox`, set by the kernel only and never trusted from a caller, and
    `isSandboxed(ctx)`, true unless the kernel read the tenant's flag as false; the `sandboxed`
    delivery state.
  - `tenancy`: migration 0018 adds `tenancy.tenant.sandbox` (default false), `tenancy.tenant_sandbox()`
    for the kernel and a trigger that lets only a platform context carrying the action
    `tenancy.tenant.sandbox.set` change it. `PgKernel` reads the flag once per read and mutate
    transaction into `tx.ctx.sandbox`, overwriting whatever the caller passed (absent when there is
    no tenant row). `TenantBootstrap` takes `sandbox`; `TenantSandbox.set` (PLT_SUPER_ADMIN, platform
    context, a reason) changes it, ledgered in the tenant.
  - `notify`: migration 0005 widens the delivery state check. In a sandbox tenant every delivery
    that would leave the platform (email, SMS, WhatsApp, push) is recorded and ledgered as
    `sandboxed` and never handed to an adapter: immediate sends, `dispatchDue`, digests and one-time
    codes alike; in-app messages are still written. A tenant whose flag cannot be read sends nothing.
  - `ai`: in a sandbox tenant the chat and embedding gateways refuse a call whose data class
    (declared, or raised by the scrubber) is above INTERNAL with `IPB-PORT-003`, recorded on the run
    (`sandbox_refused`) and ledgered as the other refusals are; PUBLIC and INTERNAL calls proceed.

  Products: run the migrations (`tenancy` 0018, `notify` 0005). Every tenant that sends notifications
  or calls the AI gateway with data above INTERNAL needs its `tenancy.tenant` row, the platform tenant
  included: without one the kernel cannot read the flag and the ports fail closed.

### Patch Changes

- 1dda4b2: NOTIFY tags each email `notify_class` with an SES-safe value (the class id with `.` as `-`) in place of `ipb_class`, which the `ses` adapter refused (reserved prefix, dotted value), so emails through `ses` no longer fail with `IPB-PORT-001`.
- Updated dependencies [1dda4b2]
- Updated dependencies [1dda4b2]
- Updated dependencies [1dda4b2]
  - @infrabyx/tenancy@1.14.0
  - @infrabyx/config@1.11.0
  - @infrabyx/contracts@1.21.0
  - @infrabyx/crypto@1.5.6

## 1.2.3

### Patch Changes

- Updated dependencies [b8c1f2c]
- Updated dependencies [b8c1f2c]
  - @infrabyx/contracts@1.20.0
  - @infrabyx/tenancy@1.13.0
  - @infrabyx/config@1.10.1
  - @infrabyx/crypto@1.5.5

## 1.2.2

### Patch Changes

- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
  - @infrabyx/tenancy@1.12.0
  - @infrabyx/contracts@1.19.0
  - @infrabyx/config@1.10.0
  - @infrabyx/crypto@1.5.4

## 1.2.1

### Patch Changes

- Updated dependencies [9c368c7]
- Updated dependencies [9c368c7]
- Updated dependencies [9c368c7]
- Updated dependencies [9c368c7]
  - @infrabyx/tenancy@1.11.0
  - @infrabyx/contracts@1.18.0
  - @infrabyx/config@1.9.2
  - @infrabyx/crypto@1.5.3

## 1.2.0

### Minor Changes

- 714ad01: Per-tenant templates (`templates` option; `null` fails closed) and delivery reports routed by vendor reference (`routeEmailEvents`, `routeSmsReports`, `routeWhatsappEvents`) through the dispatcher's ledgered service reader; migration `notify/0003` (PR-FBX-33, PR-LDC-15; R1-D-69).

### Patch Changes

- Updated dependencies [714ad01]
  - @infrabyx/contracts@1.17.0
  - @infrabyx/config@1.9.1
  - @infrabyx/crypto@1.5.2
  - @infrabyx/tenancy@1.10.1

## 1.1.14

### Patch Changes

- Updated dependencies [b3edda2]
- Updated dependencies [b3edda2]
- Updated dependencies [b3edda2]
- Updated dependencies [b3edda2]
- Updated dependencies [b3edda2]
  - @infrabyx/config@1.9.0
  - @infrabyx/tenancy@1.10.0
  - @infrabyx/contracts@1.16.0
  - @infrabyx/crypto@1.5.1

## 1.1.13

### Patch Changes

- Updated dependencies [fdd1f1a]
- Updated dependencies [ed143e3]
  - @infrabyx/config@1.8.0
  - @infrabyx/tenancy@1.9.2

## 1.1.12

### Patch Changes

- Updated dependencies [2a95100]
- Updated dependencies [2a95100]
  - @infrabyx/config@1.7.0
  - @infrabyx/crypto@1.5.0
  - @infrabyx/tenancy@1.9.1

## 1.1.11

### Patch Changes

- af2ae98: SMS and WhatsApp template values in the template's order (Udofin PR-UDF-025; R1-D-54). The stored variables lost their order in `jsonb`, so a positional DLT template could receive them shuffled. `templates.sms.vars` and `templates.whatsapp.vars` (optional) name the order; a missing named variable fails the delivery instead of sending; without a list, names sort naturally (`v1`, `v2`, … `v10`).
- Updated dependencies [7910610]
- Updated dependencies [1b99d7a]
- Updated dependencies [c83e9e0]
- Updated dependencies [af2ae98]
- Updated dependencies [c4117e4]
- Updated dependencies [1e721cd]
- Updated dependencies [854e309]
- Updated dependencies [854e309]
- Updated dependencies [0da0398]
- Updated dependencies [05c3122]
  - @infrabyx/tenancy@1.9.0
  - @infrabyx/contracts@1.15.0
  - @infrabyx/config@1.6.0
  - @infrabyx/crypto@1.4.0

## 1.1.10

### Patch Changes

- Updated dependencies [97e8524]
- Updated dependencies [e41c3bd]
- Updated dependencies [92706c4]
- Updated dependencies [92706c4]
- Updated dependencies [4a87754]
- Updated dependencies [d66ffad]
  - @infrabyx/contracts@1.14.0
  - @infrabyx/tenancy@1.8.0
  - @infrabyx/config@1.5.2
  - @infrabyx/crypto@1.3.1

## 1.1.9

### Patch Changes

- Updated dependencies [32b53ee]
- Updated dependencies [cff2a02]
  - @infrabyx/crypto@1.3.0
  - @infrabyx/contracts@1.13.0
  - @infrabyx/config@1.5.1
  - @infrabyx/tenancy@1.7.2

## 1.1.8

### Patch Changes

- Updated dependencies [63c5ad2]
- Updated dependencies [63c5ad2]
  - @infrabyx/config@1.5.0
  - @infrabyx/contracts@1.12.0
  - @infrabyx/tenancy@1.7.1
  - @infrabyx/crypto@1.2.7

## 1.1.7

### Patch Changes

- Updated dependencies [2e3a2d3]
- Updated dependencies [2e3a2d3]
- Updated dependencies [3f20011]
- Updated dependencies [3f20011]
  - @infrabyx/contracts@1.11.0
  - @infrabyx/tenancy@1.7.0
  - @infrabyx/config@1.4.1
  - @infrabyx/crypto@1.2.6

## 1.1.6

### Patch Changes

- Updated dependencies [138ae44]
- Updated dependencies [138ae44]
- Updated dependencies [138ae44]
  - @infrabyx/config@1.4.0
  - @infrabyx/contracts@1.10.0
  - @infrabyx/tenancy@1.6.0
  - @infrabyx/crypto@1.2.5

## 1.1.5

### Patch Changes

- Updated dependencies [2b307e0]
- Updated dependencies [2b307e0]
  - @infrabyx/contracts@1.9.0
  - @infrabyx/tenancy@1.5.0
  - @infrabyx/config@1.3.2
  - @infrabyx/crypto@1.2.4

## 1.1.4

### Patch Changes

- Updated dependencies [cd25633]
- Updated dependencies [cd25633]
  - @infrabyx/contracts@1.8.0
  - @infrabyx/tenancy@1.4.0
  - @infrabyx/config@1.3.1
  - @infrabyx/crypto@1.2.3

## 1.1.3

### Patch Changes

- Updated dependencies [94b706e]
  - @infrabyx/config@1.3.0
  - @infrabyx/tenancy@1.3.5

## 1.1.2

### Patch Changes

- Updated dependencies [f5622c9]
- Updated dependencies [f5622c9]
  - @infrabyx/config@1.2.0
  - @infrabyx/contracts@1.7.0
  - @infrabyx/tenancy@1.3.4
  - @infrabyx/crypto@1.2.2

## 1.1.1

### Patch Changes

- Updated dependencies [ceabe3b]
  - @infrabyx/contracts@1.6.0
  - @infrabyx/config@1.1.1
  - @infrabyx/crypto@1.2.1
  - @infrabyx/tenancy@1.3.3

## 1.1.0

### Minor Changes

- 849b8f9: One-time sign-in codes (R1-D-19): `NotifyService.sendOneTimeCode` sends at once on a `security` class, records and ledgers the delivery with `[redacted]` in place of the code and never stores the address; `notifyOtpSender` is the `CustomerOtpSender` the IDENTITY customer adapters call.

### Patch Changes

- Updated dependencies [849b8f9]
- Updated dependencies [849b8f9]
- Updated dependencies [849b8f9]
  - @infrabyx/config@1.1.0
  - @infrabyx/contracts@1.5.0
  - @infrabyx/crypto@1.2.0
  - @infrabyx/tenancy@1.3.2

## 1.0.8

### Patch Changes

- Updated dependencies [7e38652]
- Updated dependencies [7e38652]
  - @infrabyx/contracts@1.4.0
  - @infrabyx/crypto@1.1.0
  - @infrabyx/config@1.0.6
  - @infrabyx/tenancy@1.3.1

## 1.0.7

### Patch Changes

- Updated dependencies [b6058d3]
- Updated dependencies [b6058d3]
  - @infrabyx/contracts@1.3.0
  - @infrabyx/tenancy@1.3.0
  - @infrabyx/config@1.0.5
  - @infrabyx/crypto@1.0.3

## 1.0.6

### Patch Changes

- Updated dependencies [1c869a8]
  - @infrabyx/config@1.0.4
  - @infrabyx/tenancy@1.2.1

## 1.0.5

### Patch Changes

- Updated dependencies [75e9ea4]
- Updated dependencies [75e9ea4]
  - @infrabyx/contracts@1.2.0
  - @infrabyx/tenancy@1.2.0
  - @infrabyx/config@1.0.3
  - @infrabyx/crypto@1.0.2

## 1.0.4

### Patch Changes

- Updated dependencies [c0ce8ff]
- Updated dependencies [2724cd6]
  - @infrabyx/tenancy@1.1.3

## 1.0.3

### Patch Changes

- 8a2587e: The `infrabyx-*` CLI entry points run when started through a `node_modules` symlink (`pnpm exec`, npm `.bin`, `node node_modules/@infrabyx/notify/…`); before, they exited 0 without running (PR-UDF-005).
- Updated dependencies [8a2587e]
- Updated dependencies [8a2587e]
  - @infrabyx/config@1.0.2
  - @infrabyx/tenancy@1.1.2

## 1.0.2

### Patch Changes

- Updated dependencies [53a973c]
  - @infrabyx/tenancy@1.1.1

## 1.0.1

### Patch Changes

- Updated dependencies [588b509]
- Updated dependencies [588b509]
  - @infrabyx/contracts@1.1.0
  - @infrabyx/tenancy@1.1.0
  - @infrabyx/config@1.0.1
  - @infrabyx/crypto@1.0.1

## 1.0.0

### Major Changes

- 9ec9a2c: 1.0.0, the platform baseline release (IPB-14 §14.5 item 1; owner answer #67(4), PL6-D-16). Every `@infrabyx/*` package moves to 1.0.0 together; the public API is unchanged from the 0.x set of the PL6 gate (`docs/phases/PL6-gate.md` §6), so a product upgrades by moving every dependency to 1.0.0 at once. From 1.0.0 on, semantic versioning holds: a breaking change to an export, a migration or a setting is a major release with an ADR (IPB-09-34/35).

### Patch Changes

- Updated dependencies [9ec9a2c]
  - @infrabyx/config@1.0.0
  - @infrabyx/contracts@1.0.0
  - @infrabyx/crypto@1.0.0
  - @infrabyx/tenancy@1.0.0

## 0.3.1

### Patch Changes

- Updated dependencies [9d8cd8c]
- Updated dependencies [b3934f9]
  - @infrabyx/tenancy@0.6.0
  - @infrabyx/config@0.5.1

## 0.3.0

### Minor Changes

- b7de3c6: PL5 session 7: the platform catalogue's help keys move from `ntf.*` to the help-key form `hlp.notify.*` (for example `hlp.notify.security.login_alert`), registered in the platform help registry. Message keys (`title_key`) and the `ntf.*` settings keys are unchanged. A product that links to the old help keys should use the new ones.

### Patch Changes

- Updated dependencies [de53086]
- Updated dependencies [de53086]
- Updated dependencies [f1a36a1]
- Updated dependencies [1fecf45]
- Updated dependencies [1fecf45]
- Updated dependencies [b0dc390]
- Updated dependencies [b0dc390]
- Updated dependencies [b0dc390]
- Updated dependencies [275d4ba]
- Updated dependencies [934355c]
- Updated dependencies [686d24b]
- Updated dependencies [686d24b]
- Updated dependencies [e8e83cb]
- Updated dependencies [275d4ba]
- Updated dependencies [36338c3]
- Updated dependencies [934355c]
- Updated dependencies [b7de3c6]
- Updated dependencies [e8e83cb]
- Updated dependencies [275d4ba]
  - @infrabyx/config@0.5.0
  - @infrabyx/contracts@0.5.0
  - @infrabyx/tenancy@0.5.0
  - @infrabyx/crypto@0.4.1

## 0.2.0

### Minor Changes

- 9af583a: Platform notification class `vidhi.digest` (in-app by default, e-mail optional) for "What Vidhi did today" (PL4-D-11).
- 183c532: Platform notification classes `vidhi.schedule.skipped` (in-app) and `vidhi.schedule.paused` (mandatory, in-app and e-mail) for scheduled Vidhi runs (PL4-D-09).

### Patch Changes

- Updated dependencies [2b07109]
- Updated dependencies [200b25a]
- Updated dependencies [f6e9a88]
- Updated dependencies [f6e9a88]
- Updated dependencies [200b25a]
- Updated dependencies [9af583a]
- Updated dependencies [288ae44]
- Updated dependencies [b205b1d]
- Updated dependencies [183c532]
- Updated dependencies [f6e9a88]
- Updated dependencies [183c532]
- Updated dependencies [200b25a]
- Updated dependencies [b205b1d]
  - @infrabyx/contracts@0.4.0
  - @infrabyx/config@0.4.0
  - @infrabyx/crypto@0.4.0
  - @infrabyx/tenancy@0.4.0

## 0.1.0

### Minor Changes

- 1ed0659: First release (publishable, PL1-D-20): `NotifyService` (NOTIFY_PORT) with the notification
  catalogue and `infrabyx-notify-lint`, routing, quiet hours and digest, `kill.msg.*`, resend classes
  with held deliveries, the platform suppression list (C-23) with an R2 lift, marketing consent and
  one-click unsubscribe, sealed push tokens (`PgPushTokenStore`), delivery reports and
  `notifyApprovalNotifier`. Migration `notify/0001_init.sql` (PL3-D-20).
- 3951517: Owner answers #22 and #23 (PL3-D-21), migration `notify/0002_service_readers.sql`: the dispatcher
  and the unsubscribe link read as the service readers `SVC_NOTIFY_DISPATCH` and
  `SVC_NOTIFY_UNSUBSCRIBE`; collection and recovery classes go only inside the contact window
  (08:00–21:00 in the recipient's zone, never bypassed), which a product may narrow through the
  `contactWindow` hook and never widen; the mandatory class `inbox.escalated`.

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
