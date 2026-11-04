---
"@infrabyx/notify": patch
---

NOTIFY tags each email `notify_class` with an SES-safe value (the class id with `.` as `-`) in place of `ipb_class`, which the `ses` adapter refused (reserved prefix, dotted value), so emails through `ses` no longer fail with `IPB-PORT-001`.
