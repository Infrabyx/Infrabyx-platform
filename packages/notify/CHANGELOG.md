# @infrabyx/notify

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
