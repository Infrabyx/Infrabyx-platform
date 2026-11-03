---
"@infrabyx/connectors": patch
---

`@temporalio/*` 1.25.0 (security update, R1-D-60): `core-bridge` now ships Rust `zip` 9.0.5, which fixes CVE-2026-115905, -115907, -115908 and -115909. Products drop any override of their own that raised Temporal, and the matching waivers.
