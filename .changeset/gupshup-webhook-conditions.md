---
"@infrabyx/connectors": patch
---

Owner conditions for the Gupshup URL secret (PL2-D-65): an `ipb_token` shorter than 32 random bytes is refused; the telemetry scrubber redacts credential-named query parameters (`ipb_token`, tokens, secrets, keys, signatures, passwords); Gupshup SMS reports and WhatsApp events are passed on only after `confirmStatus` confirms them and are withheld (with `onWithheld`) without it.
