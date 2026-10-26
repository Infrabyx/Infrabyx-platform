# Base images (IPB-01-01, §01.4.1.1)

Every `apps/*/Dockerfile` stage uses the pinned Node image **by tag and digest**. Renovate updates tag and digest together (`pinDigests: true`); `scripts/ipb-check.mjs` fails any `FROM node` line that does not match.

| Image  | Tag                     | Manifest-list digest (use in `FROM`)                                      | Pinned on  | Notes                                                                                                                                                                                                                                    |
| ------ | ----------------------- | ------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node` | `24.22.1-bookworm-slim` | `sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205` | 2026-10-26 | Multi-arch index (linux/amd64 `sha256:2dd9a4f758e173b65fee15388f7706af6fb01ef50cf7a2c0538711d67a6981ae`, linux/arm64 `sha256:294d33a992da016e059121deb0c979dffb4478b77a304376bca41393297c1ea2`). Source: Docker Hub tag API at pin time. |

```dockerfile
FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS base
```

Rules (IPB-01-31): multi-stage, non-root UID 10001, read-only root filesystem, `HEALTHCHECK`; `hadolint` and `trivy config` gate in CI (PL6).
