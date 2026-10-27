# @infrabyx/feedback

The feedback widget, feedback items, the hand-off to Operations Hub with the status loop, the accessibility SLA timers and the purge.

**Specified by:** IPB-04 §04.3.11 (IPB-04-94…99), IPB-06-61 and 06-62, Ecosystem §6.40; PL5 plan §7.1; decision PL5-D-10.

## Install

Run `infrabyx-migrate` (migration `feedback/0001_init.sql`; it creates the `svc_feedback_sla` reader role). Settings read: `fb.nps.interval_days`, `fb.widget.floating`, `a11y.feedback.ack_hours`, `a11y.feedback.workaround_days`, `a11y.feedback.fix_days`.

## Use

```ts
const feedback = new FeedbackService({
  kernel,
  audit,
  product: "FBX",
  support,
  backlog,
  outbox,
  settings,
  allow,
});
// POST /api/feedback (widget fetch or the no-JavaScript form)
const res = await handleFeedbackPost(feedback, {
  body,
  csrfOk,
  mode: "form",
  submitter: { ctx, clientKey },
});
// OH → product: in.infrabyx.feedback.FeedbackStatusChanged.v1
await feedback.onStatusChanged({ eventId, tenantId, data });
// one worker: every few minutes, and daily
await new FeedbackSweep({ kernel, audit, product: "FBX", service: feedback, outbox }).tick();
await sweep.purge();
```

Render `FeedbackTrigger` in the footer, `FeedbackDialog` once per page with `FEEDBACK_CONTROLLER_JS` served first-party under the CSP nonce, `FeedbackForm` on `/feedback`, `AccessibilityReportForm` on `/accessibility` and `FeedbackStatusView` on `/feedback/status/{id}`. The help keys `hlp.feedback.*` are registered with the platform help registry.

## Rules

- **Never captured:** page content, form values, screenshots, URLs, query strings or document ids. A request that sends any of them is refused whole with `IPB-FB-001`. Personal numbers and secrets in the text are refused too.
- **Spam and rate limits:** the honeypot and the rate limits (the app's `allow` per client, and 10 items an hour per person) answer `IPB-FB-002`. The NPS question is never shown in a first session (or when that is unknown) and at most once per interval.
- **Hand-off:** bugs and accessibility reports go to SUPPORT, ideas, praise, NPS and help-content feedback to BACKLOG. A failed hand-off is retried by the sweep.
- **Accessibility SLA:** acknowledgement 24 hours, workaround 5 days, fix 30 days for P1 and 90 otherwise. A P1 on a regulated step also gets an interim path by the next business day. Each missed timer raises one `AccessibilityIssueSlaBreached`.
- **Purge:** items are deleted 3 years after closure (OWNER-QUESTIONS #48); PostgreSQL refuses any earlier delete.
