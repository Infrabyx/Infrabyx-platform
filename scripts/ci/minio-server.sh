#!/usr/bin/env bash
# STORAGE contract leg: start the MinIO server for the MinIO-server leg (PL2-D-61).
# MinIO publishes no pinnable image any more (Docker Hub repository gone; quay.io refuses
# anonymous pulls), so CI builds MinIO's last community release from source: the tag is cloned,
# its commit is checked against the pin below, and the binary is kept in the Actions cache
# (~/.cache/ipb-minio). A third-party mirror is never used. Writes IPB_TEST_MINIO_URL to
# $GITHUB_ENV once MinIO answers its health probe, and the server's process id to
# $RUNNER_TEMP/minio.pid. IPB_MINIO_ADDRESS moves it off 127.0.0.1:9000 (`pnpm check:full` gives
# it a free port, R1-D-164).
set -euo pipefail

TAG="RELEASE.2025-09-07T16-13-09Z"
COMMIT="07c3a429bfed433e49018cb0f78a52145d4bedeb"
CACHE="${IPB_MINIO_CACHE:-$HOME/.cache/ipb-minio}"
BIN="$CACHE/minio-$COMMIT"
# Test-only credentials for a throwaway server on the runner's loopback.
USER_="ipb-minio-test"
PASS_="ipb-minio-test-secret"
KMS_KEY="ipb-minio-key:$(head -c 32 /dev/urandom | base64)"
ADDR="${IPB_MINIO_ADDRESS:-127.0.0.1:9000}"
mkdir -p "$CACHE"

if [ -x "$BIN" ]; then
  echo "MinIO $TAG from the Actions cache"
else
  SRC="$RUNNER_TEMP/minio-src"
  rm -rf "$SRC"
  git -c advice.detachedHead=false clone --depth 1 --branch "$TAG" https://github.com/minio/minio.git "$SRC"
  got=$(git -C "$SRC" rev-parse HEAD)
  if [ "$got" != "$COMMIT" ]; then
    echo "::error title=MinIO::tag $TAG is at $got, pinned $COMMIT; refusing to build"
    exit 1
  fi
  (cd "$SRC" && CGO_ENABLED=0 GOFLAGS=-trimpath go build -o "$BIN" .)
  echo "MinIO $TAG built from source at $COMMIT"
fi

mkdir -p "$RUNNER_TEMP/minio-data"
MINIO_ROOT_USER="$USER_" MINIO_ROOT_PASSWORD="$PASS_" MINIO_KMS_SECRET_KEY="$KMS_KEY" \
  nohup "$BIN" server "$RUNNER_TEMP/minio-data" --address "$ADDR" \
  >"$RUNNER_TEMP/minio.log" 2>&1 &
echo "$!" >"$RUNNER_TEMP/minio.pid"

for _ in $(seq 1 60); do
  if curl -fsS "http://$ADDR/minio/health/live" >/dev/null 2>&1; then
    echo "IPB_TEST_MINIO_URL=http://$ADDR" >>"$GITHUB_ENV"
    exit 0
  fi
  sleep 1
done
echo "::error title=MinIO::MinIO did not become healthy"
tail -20 "$RUNNER_TEMP/minio.log" || true
exit 1
