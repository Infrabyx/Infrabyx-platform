---
"@infrabyx/connectors": minor
---

`googleServiceAccountToken` (C-24, PL4-C-01): exchanges a service-account assertion at Google's token endpoint and caches the access token until 5 minutes before expiry, with one shared exchange for concurrent callers. `fcm` uses it, and `vertexServiceAccountToken` gives `gemini_vertex_asia_south1` a cloud-platform token from a service-account key read through SECRETS. An injected workload-identity token provider still works for both.
