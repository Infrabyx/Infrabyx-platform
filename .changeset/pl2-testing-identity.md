---
"@infrabyx/testing": minor
---

Test images `keycloak` (26.8.1) and `zitadel` (v4.19.5, GHCR, CI only); `startNetwork()` for
services that talk to each other; `startService({ readyHttp })` probes readiness over HTTP from the
host for images without a shell.
