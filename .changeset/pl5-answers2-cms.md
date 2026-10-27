---
"@infrabyx/cms": minor
---

Owner answers #53 and #55 (PL5-D-11), with migration `cms/0004_renditions_notices.sql`.

- **Renditions (#53):** with a MEDIA port, `MediaLibrary` stores AVIF, WebP and a JPEG or PNG fallback at the fixed widths for each raster upload, refuses images the port cannot decode or above the pixel limit, and `sources()` returns the `<picture>` sources. The 90-day purge removes renditions with their media.
- **Notice period (#55):** a MAJOR change to the Terms or Payment Terms takes effect only 30 days (`pol.notice_days`) after users are notified, the later of `PolicyStudio.publishNotice` and `recordNoticeSent` (or the `notifyPolicyChange` hook returning `sentAt`). `noticeStatus` and `PublicPolicies.upcoming` show where a change stands.
- **What to wire:** pass `media` and `settings` to `MediaLibrary`; publish each MAJOR Terms notice in Studio and report the NOTIFY send time.
