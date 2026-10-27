# @infrabyx/notify

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
