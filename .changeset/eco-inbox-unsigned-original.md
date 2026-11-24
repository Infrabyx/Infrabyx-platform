---
"@infrabyx/tenancy": minor
---

An unsigned partner original in the inbox (Udofin PR-UDF-085; R1-D-288). `EcosystemInbox.receive(ctx, mapped, { original })` without a `jws` keeps the original after the same checks, REGULATED, written once and with the JWS's reader roles; `ReceiveResult.originalSigned` and `InboxEvent.originalSigned` (`false` for unsigned, `null` with no original) and `originalRecordOf` (`{ original, signed }`) say which, and nothing claims a signature for it. Migration `tenancy/0033` drops 0029's original-with-JWS check; existing rows are untouched.
