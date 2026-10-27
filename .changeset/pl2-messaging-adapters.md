---
"@infrabyx/connectors": minor
---

EMAIL adapters `ses` (SES v2 in ap-south-1, configuration set per brand, SNS events verified per C-13 with a timestamp window) and `brevo` (GLOBAL with a DPA reference, idempotencyKey and tag lookup, DKIM-checked failover target, shared-secret webhooks with Brevo's source ranges); SMS adapters `msg91` (Flow API v5, CRQID, bearer delivery reports, balance health) and `gupshup-sms` (Enterprise GatewayAPI as a POST form, rendered DLT text, URL-token delivery reports) with a shared DLT registry that refuses unregistered templates and headers before any request; WHATSAPP adapters `gupshup` (BSP API) and `meta-cloud` (Graph API v26.0, `X-Hub-Signature-256`, verify-token handshake) with the 24-hour window check, marketing templates off while `mkt.meta.enabled` is false, and a configuration rate card. New subpath exports `@infrabyx/connectors/email`, `/sms` and `/whatsapp`. `@aws-sdk/client-sesv2` 3.1152.0 (PL2-D-64).
