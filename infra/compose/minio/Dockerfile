# syntax=docker/dockerfile:1.7
# MinIO for local Compose (IPB-01-33; PL6 plan §4). MinIO publishes no pinnable image any more, so
# this builds its last community release from source, as CI does (scripts/ci/minio-server.sh,
# PL2-D-61, OWNER-QUESTIONS #4): the tag is cloned and its commit checked against the pin. Never a
# third-party mirror. Local development only; nothing here is deployed.
FROM golang:1.24.13-bookworm@sha256:1a6d4452c65dea36aac2e2d606b01b4a029ec90cc1ae53890540ce6173ea77ac AS build
ARG TAG=RELEASE.2025-09-07T16-13-09Z
ARG COMMIT=07c3a429bfed433e49018cb0f78a52145d4bedeb
WORKDIR /src
RUN git -c advice.detachedHead=false clone --depth 1 --branch "$TAG" https://github.com/minio/minio.git . \
    && test "$(git rev-parse HEAD)" = "$COMMIT" \
    && CGO_ENABLED=0 GOFLAGS=-trimpath go build -o /out/minio .

# The pinned Node base doubles as the runtime (bookworm-slim, no new base image) and gives the
# health check a client.
FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205
COPY --from=build /out/minio /usr/local/bin/minio
# The data directory belongs to the runtime user, so a fresh named volume inherits that owner.
RUN mkdir /data && chown 10001:10001 /data
USER 10001
EXPOSE 9000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=6 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:9000/minio/health/live').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# Certificates directory under /tmp (the root filesystem is read-only in Compose).
ENTRYPOINT ["minio", "server", "/data", "--address", ":9000", "--certs-dir", "/tmp/minio-certs"]
