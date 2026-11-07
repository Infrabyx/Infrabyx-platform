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

The image also carries the bundled breached-password list `ipb-common-passwords.txt` at `/opt/keycloak/data/password-blacklists/` with its licence notice (PR-LDC-04, R1-D-83): the 10,000 most common passwords of 12 or more characters, lower-cased, derived from SecLists' `xato-net-10-million-passwords-1000000.txt` (MIT). Source, checksums and the derivation are in `infra/keycloak/customer-otp/password-blacklists/README.md`; `infra/docker/keycloak-password-blacklist.test.mjs` (`pnpm images:test`) checks them. No base image changes, and nothing is downloaded at build or run time.

| Image               | Tag                   | Digest                                                                    | Pinned on  | Notes                                                                                                                                                                                                                                                                |
| ------------------- | --------------------- | ------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `keycloak/keycloak` | `26.8.1-2`            | `sha256:3f3c5f8e03c614774b4bd9173b88391fefa4153bfc010d8012d59ad825377332` | 2026-11-07 | The runtime, and the jars the extension compiles against; the same digest as the IDENTITY test image. The rebuild of 31 Oct 2026, pinned once 7 days old; it clears CVE-2026-91415, four base findings stay waived to 20 Dec by the owner (#124, R1-D-109, R1-D-110) |
| `eclipse-temurin`   | `21.0.12_8-jdk-noble` | `sha256:4d271cd5e0624598cf563342f47281b09cb364bc13acbbd7251f49f83470018d` | 2026-10-29 | Compile stage only (`javac --release 21`); nothing of it reaches the runtime image. Published 18 Sep 2026                                                                                                                                                            |
