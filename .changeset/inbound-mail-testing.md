---
"@infrabyx/testing": minor
---

Inbound mail replies (PR-LDC-50, R1-D-177): `FakeInboundEmail` (records sends with their reply address, and an inbound route) and `defineEmailInboundContract`, run against the fake and the SES adapter. The SES and Brevo stubs record the reply address they were sent.
