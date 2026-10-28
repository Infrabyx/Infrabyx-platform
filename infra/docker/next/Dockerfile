# syntax=docker/dockerfile:1.7
# The image of every Next.js deployable (apps/public, apps/console; IPB-01-31, §01.4.8.1, PL6 plan
# §3.1). Build from the repository root, naming the app folder:
#   docker build -f infra/docker/next/Dockerfile --build-arg APP=public -t infrabyx/public .
# Behind a TLS-inspecting proxy, pass its CA as a build secret: --secret id=ca,src=<ca.pem>.
# The runtime runs as UID 10001 on a read-only root filesystem; the chart and Compose mount the only
# writable paths (/tmp and .next/cache) as empty volumes.

FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_HOME=/corepack \
    NEXT_TELEMETRY_DISABLED=1
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
ARG APP
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
    && pnpm --filter="$PKG" deploy --legacy --prod --prefer-offline --store-dir /pnpm/store /out \
    && rm -rf "apps/$APP/.next/cache" \
    && cp -r "apps/$APP/.next" /out/.next

# The runtime starts again from the pinned Node image: no corepack shims, and the package managers
# the image bundles (npm, npx, corepack, yarn) are removed, since the app never installs anything.
FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn \
      /usr/local/bin/yarnpkg /opt/yarn-* \
    && groupadd --gid 10001 app \
    && useradd --uid 10001 --gid app --no-create-home --home-dir /app --shell /usr/sbin/nologin app
WORKDIR /app
# The code stays owned by root: the app user can read it, never change it.
COPY --from=build /out /app
COPY infra/docker/healthcheck.mjs /app/healthcheck.mjs
USER 10001
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 CMD ["node", "/app/healthcheck.mjs"]
ENTRYPOINT ["node", "--enable-source-maps", "node_modules/next/dist/bin/next", "start"]
