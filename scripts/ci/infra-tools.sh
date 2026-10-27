#!/usr/bin/env bash
# Installs the chart and policy tools of the `infra` job (PL6 plan §5.4, §6) into $INFRA_TOOLS
# (default ~/.cache/ipb-infra-tools), from pinned versions only:
# - Helm and kubeconform with `go install <module>@<version>`, checked by Go's checksum database;
# - the Kyverno CLI, whose module cannot be `go install`ed (replace directives), built from its
#   tag after the tag's commit is checked against the pin (the MinIO pattern, PL2-D-61).
# Each was published at least 7 days before it was pinned (PL2-D-32). Never a third-party mirror.
set -euo pipefail

HELM_VERSION="v4.3.1"
KUBECONFORM_VERSION="v0.8.0"
KYVERNO_TAG="v1.19.1"
KYVERNO_COMMIT="40ec788d48bb28d83dbf85538e962a59db9d45c6"

DIR="${INFRA_TOOLS:-$HOME/.cache/ipb-infra-tools}"
mkdir -p "$DIR"
export GOBIN="$DIR" GOTOOLCHAIN=auto GOFLAGS=-trimpath CGO_ENABLED=0

[ -x "$DIR/helm" ] && "$DIR/helm" version --short | grep -q "^${HELM_VERSION%.*}" ||
  go install "helm.sh/helm/v4/cmd/helm@$HELM_VERSION"
[ -x "$DIR/kubeconform" ] || go install "github.com/yannh/kubeconform/cmd/kubeconform@$KUBECONFORM_VERSION"

if [ ! -x "$DIR/kyverno-$KYVERNO_COMMIT" ]; then
  SRC="$(mktemp -d)"
  git -c advice.detachedHead=false clone --depth 1 --branch "$KYVERNO_TAG" https://github.com/kyverno/kyverno.git "$SRC"
  got="$(git -C "$SRC" rev-parse HEAD)"
  if [ "$got" != "$KYVERNO_COMMIT" ]; then
    echo "::error title=Kyverno::tag $KYVERNO_TAG is at $got, pinned $KYVERNO_COMMIT; refusing to build"
    exit 1
  fi
  (cd "$SRC" && go build -o "$DIR/kyverno-$KYVERNO_COMMIT" ./cmd/cli/kubectl-kyverno)
  rm -rf "$SRC"
fi
ln -sf "$DIR/kyverno-$KYVERNO_COMMIT" "$DIR/kyverno"

"$DIR/helm" version --short
"$DIR/kubeconform" -v
"$DIR/kyverno" version | head -3
