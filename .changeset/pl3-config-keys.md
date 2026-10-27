---
"@infrabyx/config": minor
---

PL3 session 1: settings for RULES (`rules.*`), PUSH (`int.push.*`), NOTIFY dedupe, workflow timers,
export (`eng.export.*`) and the tighten-only maker-checker tenant keys `mc.*` (new tighten mode
`subset`); exact `kill.msg.email|sms|whatsapp|push|inapp` switches; `FlagService.boot()` persists or
loads the flag snapshot at startup, and `onAlert` raises `ops.flags.provider_unreachable`
(throttled) whenever flags are served without the provider (PL3-D-13).
