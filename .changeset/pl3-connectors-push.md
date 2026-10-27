---
"@infrabyx/connectors": minor
---

PUSH adapters (new subpath `@infrabyx/connectors/push`): `expo` (reference, Expo push API v2,
`sendTopic` unsupported) and `fcm` (alternative, FCM HTTP v1, C-24 service-account assertion or a
workload-identity access token, cached until 5 minutes before expiry; `receipts` unsupported).
Both refuse anything beyond title, deep link and INTERNAL data (`IPB-NTF-006`), remove tokens the
vendor reports unregistered, and stay `unproven` until their sandbox legs (#50, #51).
