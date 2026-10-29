# Base images (IPB-01-01, §01.4.1.1)

Every `apps/*/Dockerfile` stage uses the pinned Node image **by tag and digest**. Renovate updates tag and digest together (`pinDigests: true`); `scripts/ipb-check.mjs` fails any `FROM node` line that does not match.

| Image  | Tag                     | Manifest-list digest (use in `FROM`)                                      | Pinned on  | Notes                                                                                                                                                                                                                                    |
| ------ | ----------------------- | ------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node` | `24.22.1-bookworm-slim` | `sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205` | 2026-10-26 | Multi-arch index (linux/amd64 `sha256:2dd9a4f758e173b65fee15388f7706af6fb01ef50cf7a2c0538711d67a6981ae`, linux/arm64 `sha256:294d33a992da016e059121deb0c979dffb4478b77a304376bca41393297c1ea2`). Source: Docker Hub tag API at pin time. |

```dockerfile
FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS base
```

Rules (IPB-01-31): multi-stage, non-root UID 10001, read-only root filesystem, `HEALTHCHECK`; `hadolint`, `trivy config` and `trivy image` gate in the `containers` CI job (PL6, `README.md`).

## The Keycloak customer image (R1-D-19)

`infra/keycloak/customer-otp/Dockerfile` builds Keycloak with the customer one-time-code extension. Both stages are pinned by tag and digest, published at least 7 days before they were pinned (PL2-D-32).

| Image               | Tag                   | Digest                                                                    | Pinned on  | Notes                                                                                                                                                                |
| ------------------- | --------------------- | ------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `keycloak/keycloak` | `26.8.1`              | `sha256:79c623a22abacf3fe6c00a5fb30f5b7843d717b234033b80995891c06116d244` | 2026-10-29 | The runtime, and the jars the extension compiles against; the same digest as the IDENTITY test image. The rebuild `26.8.1-1` (23 Oct 2026) may be pinned from 30 Oct |
| `eclipse-temurin`   | `21.0.12_8-jdk-noble` | `sha256:4d271cd5e0624598cf563342f47281b09cb364bc13acbbd7251f49f83470018d` | 2026-10-29 | Compile stage only (`javac --release 21`); nothing of it reaches the runtime image. Published 18 Sep 2026                                                            |
