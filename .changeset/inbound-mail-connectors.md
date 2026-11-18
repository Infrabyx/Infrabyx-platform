---
"@infrabyx/connectors": minor
---

Inbound mail replies (PR-LDC-50, R1-D-177): `SesEmail.verifyInbound` takes SES email receiving's signed `Received` notifications from a separate SNS topic (`inbound.topicArn`), with the message inline (SNS action) or read from the configured inbound S3 bucket in India (S3 action, capped at 10 MiB), and the SPF, aligned-DKIM and DMARC verdicts from the signed receipt only. `ses` and `brevo` send a message's own `replyTo` in place of the brand's. Brevo offers no inbound route (no payload signature or receiving-side verdict); the exit runbook records it.
