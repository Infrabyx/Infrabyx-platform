# @infrabyx/feedback

## 0.1.0

### Minor Changes

- 275d4ba: The feedback package (PL5 session 6), with migration `feedback/0001_init.sql` (run `infrabyx-migrate`; it creates the `svc_feedback_sla` reader role).

  - **Widget:** `FeedbackTrigger` (footer "Report a problem" and the optional floating button), `FeedbackForm`, `FeedbackDialog` with `FEEDBACK_CONTROLLER_JS`, `AccessibilityReportForm` and `FeedbackStatusView`. Every trigger is a link to `/feedback`, so it works without JavaScript; nothing sets a cookie.
  - **Minimisation:** `parseFeedback` refuses page HTML, form values, screenshots, URLs, query strings, unknown fields and personal numbers in the text with `IPB-FB-001` and stores nothing. Routes are reduced to patterns and user agents to OS and browser families.
  - **Service:** `FeedbackService.submit` (honeypot, rate limit `IPB-FB-002`, NPS never in a first session and at most once per `fb.nps.interval_days`), the hand-off to SUPPORT or BACKLOG, the status loop (`onStatusChanged`, `refreshStatus`, `mine`, `viewByLink`) and `triageAccessibility`.
  - **Endpoint:** `handleFeedbackPost` for the JSON and no-JavaScript posts.
  - **Sweep:** `FeedbackSweep.tick()` raises `AccessibilityIssueSlaBreached` once per missed timer and retries pending hand-offs; `FeedbackSweep.purge()` deletes items 3 years after closure (OWNER-QUESTIONS #48).

- 1076df2: PL5 session 8b: `FeedbackService.queue(ctx, { type?, open? })`, the staff queue of the context's tenant with the accessibility timers (`FeedbackQueueItem`), for PLT_SUPER_ADMIN or PLT_ACCESSIBILITY_LEAD (`QUEUE_ROLES`) in the platform context.

### Patch Changes

- Updated dependencies [de53086]
- Updated dependencies [de53086]
- Updated dependencies [de53086]
- Updated dependencies [f1a36a1]
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
- Updated dependencies [b7de3c6]
- Updated dependencies [b50922c]
- Updated dependencies [1076df2]
- Updated dependencies [f1da214]
- Updated dependencies [e8e83cb]
- Updated dependencies [275d4ba]
- Updated dependencies [8dfe167]
  - @infrabyx/ai@0.2.0
  - @infrabyx/config@0.5.0
  - @infrabyx/contracts@0.5.0
  - @infrabyx/ui@0.1.0
  - @infrabyx/tenancy@0.5.0
  - @infrabyx/crypto@0.4.1
