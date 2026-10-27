---
"@infrabyx/feedback": minor
---

The feedback package (PL5 session 6), with migration `feedback/0001_init.sql` (run `infrabyx-migrate`; it creates the `svc_feedback_sla` reader role).

- **Widget:** `FeedbackTrigger` (footer "Report a problem" and the optional floating button), `FeedbackForm`, `FeedbackDialog` with `FEEDBACK_CONTROLLER_JS`, `AccessibilityReportForm` and `FeedbackStatusView`. Every trigger is a link to `/feedback`, so it works without JavaScript; nothing sets a cookie.
- **Minimisation:** `parseFeedback` refuses page HTML, form values, screenshots, URLs, query strings, unknown fields and personal numbers in the text with `IPB-FB-001` and stores nothing. Routes are reduced to patterns and user agents to OS and browser families.
- **Service:** `FeedbackService.submit` (honeypot, rate limit `IPB-FB-002`, NPS never in a first session and at most once per `fb.nps.interval_days`), the hand-off to SUPPORT or BACKLOG, the status loop (`onStatusChanged`, `refreshStatus`, `mine`, `viewByLink`) and `triageAccessibility`.
- **Endpoint:** `handleFeedbackPost` for the JSON and no-JavaScript posts.
- **Sweep:** `FeedbackSweep.tick()` raises `AccessibilityIssueSlaBreached` once per missed timer and retries pending hand-offs; `FeedbackSweep.purge()` deletes items 3 years after closure (OWNER-QUESTIONS #48).
