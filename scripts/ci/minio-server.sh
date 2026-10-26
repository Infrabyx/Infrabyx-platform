#!/usr/bin/env bash
# STORAGE contract leg: start the MinIO server for the MinIO-server leg (PL2-D-61).
# Source order: the Actions cache (an image tarball pulled earlier) → quay.io by the pinned digest
# in TEST_IMAGES → the same release built from source (cached binary). A third-party mirror is
# never used. Writes IPB_TEST_MINIO_URL to $GITHUB_ENV once MinIO answers its health probe.
# With the placeholder digest it only resolves and prints the real digest (first run).
set -euo pipefail

TAG="RELEASE.2025-09-07T16-13-09Z"
CACHE="${IPB_MINIO_CACHE:-$HOME/.cache/ipb-minio}"
mkdir -p "$CACHE"
REF=$(node -e 'const s=require("fs").readFileSync("packages/testing/src/containers.ts","utf8");const m=/minio:\s*\{[^}]*?image:\s*"([^"]+)"/s.exec(s);if(!m)process.exit(1);process.stdout.write(m[1])')
DIGEST="${REF##*@}"
LOCAL="ipb-minio:pinned"
# Test-only credentials for a throwaway container on the runner's loopback.
USER_="ipb-minio-test"
PASS_="ipb-minio-test-secret"
KMS_KEY="ipb-minio-key:$(head -c 32 /dev/urandom | base64)"

if [ "$DIGEST" = "sha256:0000000000000000000000000000000000000000000000000000000000000000" ]; then
  docker pull "quay.io/minio/minio:$TAG"
  echo "::notice title=MinIO digest::pin $(docker inspect -f '{{index .RepoDigests 0}}' "quay.io/minio/minio:$TAG") in TEST_IMAGES"
  exit 0
fi

mode=""
if [ -f "$CACHE/image.tar" ] && docker load -i "$CACHE/image.tar"; then
  mode="cache"
elif docker pull "$REF"; then
  docker tag "$REF" "$LOCAL"
  docker save "$LOCAL" -o "$CACHE/image.tar"
  mode="quay"
else
  echo "::warning title=MinIO::quay.io did not serve $REF; building $TAG from source (PL2-D-61)"
  if [ ! -x "$CACHE/minio-$TAG" ]; then
    rm -rf "$CACHE/src"
    git clone --depth 1 --branch "$TAG" https://github.com/minio/minio.git "$CACHE/src"
    (cd "$CACHE/src" && CGO_ENABLED=0 go build -trimpath -o "$CACHE/minio-$TAG" .)
  fi
  mode="source"
fi

if [ "$mode" = "source" ]; then
  mkdir -p "$RUNNER_TEMP/minio-data"
  MINIO_ROOT_USER="$USER_" MINIO_ROOT_PASSWORD="$PASS_" MINIO_KMS_SECRET_KEY="$KMS_KEY" \
    nohup "$CACHE/minio-$TAG" server "$RUNNER_TEMP/minio-data" --address 127.0.0.1:9000 \
    >"$RUNNER_TEMP/minio.log" 2>&1 &
else
  docker run -d --name ipb-minio -p 127.0.0.1:9000:9000 \
    -e MINIO_ROOT_USER="$USER_" -e MINIO_ROOT_PASSWORD="$PASS_" -e MINIO_KMS_SECRET_KEY="$KMS_KEY" \
    "$LOCAL" server /data >/dev/null
fi

for _ in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:9000/minio/health/live >/dev/null 2>&1; then
    echo "MinIO $TAG up from $mode"
    echo "IPB_TEST_MINIO_URL=http://127.0.0.1:9000" >>"$GITHUB_ENV"
    exit 0
  fi
  sleep 1
done
echo "::error title=MinIO::MinIO did not become healthy"
docker logs ipb-minio 2>/dev/null | tail -20 || tail -20 "$RUNNER_TEMP/minio.log" || true
exit 1
