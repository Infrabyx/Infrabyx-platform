# syntax=docker/dockerfile:1.7
# The TallyPrime agent (Finbyx PR-FBX-46; R1-D-137, R1-D-178; threat model §3.121): the program a
# tenant runs next to TallyPrime. Owner answer #128: it ships as source and this image (no signed
# Windows installer); the product builds, signs and attests it in its own release, as for every
# other image. Build from the repository root:
#   docker build -f infra/docker/tally-agent/Dockerfile -t infrabyx/tally-agent .
# Run (the tenant's side): the config mounted read-only, the state on its own volume, no port:
#   docker run -d --read-only --tmpfs /tmp -v tally-agent:/data \
#     -v ./config.json:/etc/infrabyx-tally-agent/config.json:ro infrabyx/tally-agent
# It listens on no port (no EXPOSE). It runs as UID 10001 on a read-only root filesystem; /data
# (the key and identity, mode 0600) and /tmp (the heartbeat) are the only writable paths.

FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_HOME=/corepack
# pnpm comes from the root package.json `packageManager` pin through corepack (ADR-0002).
RUN corepack enable

FROM base AS deps
WORKDIR /repo
# A product's image fetches @infrabyx/* from GitHub Packages with a read token passed as the
# build secret `npmrc` (`--secret id=npmrc,src=$HOME/.npmrc`): the user config holds the token,
# the repository's .npmrc names the registry only, and no layer keeps it (PR-FBX-08).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    --mount=type=secret,id=ca,required=false \
    --mount=type=secret,id=npmrc,target=/root/.npmrc,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi \
    && pnpm fetch --store-dir /pnpm/store

FROM deps AS build
ARG APP=tally-agent
# Git hooks are a developer guard (PL1-D-17); the image build has no git.
ENV LEFTHOOK=0
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    --mount=type=secret,id=ca,required=false \
    --mount=type=secret,id=npmrc,target=/root/.npmrc,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi \
    && test -n "$APP" && test -f "apps/$APP/package.json" \
    && PKG="$(node -p "require('./apps/$APP/package.json').name")" \
    && pnpm install --prefer-offline --frozen-lockfile --store-dir /pnpm/store \
    && pnpm turbo run build --filter="$PKG..." \
    && pnpm --filter="$PKG" deploy --legacy --prod --prefer-offline --store-dir /pnpm/store /out

# The runtime starts again from the pinned Node image: no corepack shims, and the package managers
# the image bundles (npm, npx, corepack, yarn) are removed, since the agent never installs anything.
FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS runtime
ENV NODE_ENV=production
# Debian 12's fixed packages first, pinned exactly (infra/docker/debian-fixes.sh, R1-D-319), while
# apt is still there; then the package managers go.
RUN --mount=type=bind,source=infra/docker/debian-fixes.sh,target=/tmp/debian-fixes.sh \
    --mount=type=secret,id=ca,required=false \
    sh /tmp/debian-fixes.sh \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn \
      /usr/local/bin/yarnpkg /opt/yarn-* \
    && groupadd --gid 10001 app \
    && useradd --uid 10001 --gid app --no-create-home --home-dir /app --shell /usr/sbin/nologin app \
    && mkdir -p /data /etc/infrabyx-tally-agent \
    && chown 10001:10001 /data && chmod 0700 /data
WORKDIR /app
# The code stays owned by root: the agent can read it, never change it.
COPY --from=build /out /app
USER 10001
VOLUME ["/data"]
# Healthy while the loop's heartbeat (/tmp) is under 90 seconds old; there is no port to probe.
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 CMD ["node", "/app/dist/health.js"]
ENTRYPOINT ["node", "--enable-source-maps", "dist/main.js"]
