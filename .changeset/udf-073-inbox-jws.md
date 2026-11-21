---
"@infrabyx/tenancy": minor
---

`EcosystemInbox.receive` verifies a regulated message's detached JWS and keeps it beside the event (Udofin PR-UDF-073; R1-D-257). With the new `regulated: { keys, replay }` option, `receive(ctx, envelope, { jws })` checks the `X-Infrabyx-JWS` value against the envelope's limits (compact detached, at most 1,024 octets), verifies it with `verifyRegulatedMessage`, and stores it in the new nullable `eco_inbox.jws` column; a failure is IPB-API-018 (`signature-invalid`) and nothing is stored. Handlers and `list` get `event.jws`; `receive` answers the stored JWS (the first one for a duplicate). Migration `tenancy/0026` adds the column to every existing inbox and to new ones, with a CHECK on its length and form and a trigger that refuses any later change (written once). Run `infrabyx-migrate`; pass the header value to `receive` instead of verifying it yourself first.
