#!/usr/bin/env bash
# Installs the chart, policy and OpenTofu tools of the `infra` job (PL6 plan §5.4, §6, §7.3) into
# $INFRA_TOOLS (default ~/.cache/ipb-infra-tools), from pinned versions only:
# - Helm, kubeconform, tflint and its rulesets with `go install <module>@<version>`, checked by
#   Go's checksum database (GOTOOLCHAIN=auto fetches the Go release a module asks for);
# - the Kyverno CLI and OpenTofu, whose modules cannot be `go install`ed (replace directives),
#   built from their tags after each tag's commit is checked against the pin (the MinIO pattern,
#   PL2-D-61).
# Each was published at least 7 days before it was pinned (PL2-D-32). Never a third-party mirror.
set -euo pipefail

HELM_VERSION="v4.3.1"
KUBECONFORM_VERSION="v0.8.0"
KYVERNO_TAG="v1.19.1"
KYVERNO_COMMIT="40ec788d48bb28d83dbf85538e962a59db9d45c6"
TOFU_TAG="v1.13.1"
TOFU_COMMIT="233700b795b6d2372f1c56ed57a4abaec9d36475"
TFLINT_VERSION="v0.64.0"
TFLINT_RULESETS=("aws@v0.49.0" "azurerm@v0.32.0" "google@v0.40.0")

DIR="${INFRA_TOOLS:-$HOME/.cache/ipb-infra-tools}"
mkdir -p "$DIR"
export GOBIN="$DIR" GOTOOLCHAIN=auto GOFLAGS=-trimpath CGO_ENABLED=0

[ -x "$DIR/helm" ] && "$DIR/helm" version --short | grep -q "^${HELM_VERSION%.*}" ||
  go install "helm.sh/helm/v4/cmd/helm@$HELM_VERSION"
[ -x "$DIR/kubeconform" ] || go install "github.com/yannh/kubeconform/cmd/kubeconform@$KUBECONFORM_VERSION"
[ -x "$DIR/tflint" ] || go install "github.com/terraform-linters/tflint@$TFLINT_VERSION"
# tflint finds a ruleset installed by hand as tflint-ruleset-<name> in TFLINT_PLUGIN_DIR.
mkdir -p "$DIR/tflint-plugins"
for r in "${TFLINT_RULESETS[@]}"; do
  [ -x "$DIR/tflint-plugins/tflint-ruleset-${r%@*}" ] ||
    GOBIN="$DIR/tflint-plugins" go install "github.com/terraform-linters/tflint-ruleset-${r%@*}@${r#*@}"
done

# build_tag <name> <repo> <tag> <commit> <package>: clone the tag, check its commit, build once.
build_tag() {
  local name="$1" repo="$2" tag="$3" commit="$4" pkg="$5"
  if [ ! -x "$DIR/$name-$commit" ]; then
    local src
    src="$(mktemp -d)"
    git -c advice.detachedHead=false clone --depth 1 --branch "$tag" "$repo" "$src"
    local got
    got="$(git -C "$src" rev-parse HEAD)"
    if [ "$got" != "$commit" ]; then
      echo "::error title=$name::tag $tag is at $got, pinned $commit; refusing to build"
      exit 1
    fi
    (cd "$src" && go build -o "$DIR/$name-$commit" "$pkg")
    rm -rf "$src"
  fi
  ln -sf "$DIR/$name-$commit" "$DIR/$name"
}

build_tag kyverno https://github.com/kyverno/kyverno.git "$KYVERNO_TAG" "$KYVERNO_COMMIT" ./cmd/cli/kubectl-kyverno
build_tag tofu https://github.com/opentofu/opentofu.git "$TOFU_TAG" "$TOFU_COMMIT" ./cmd/tofu

"$DIR/helm" version --short
"$DIR/kubeconform" -v
"$DIR/kyverno" version | head -3
"$DIR/tofu" version | head -1
"$DIR/tflint" --version | head -1
