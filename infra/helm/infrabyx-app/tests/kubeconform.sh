#!/usr/bin/env bash
# kubeconform over every CI values render of the chart (IPB-01-32; PL6 plan §5.4), against the
# Kubernetes and CRD JSON schemas pinned to commits, so a test never reads a moving branch.
set -euo pipefail
CHART="$(cd "$(dirname "$0")/.." && pwd)"
HELM="${IPB_HELM:-helm}"
KUBECONFORM="${IPB_KUBECONFORM:-kubeconform}"
K8S_VERSION="1.33.0"
K8S_SCHEMAS="89a35a5e9a1412a692a2603d79c3786f602238a4" # yannh/kubernetes-json-schema
CRD_SCHEMAS="3eb90d47aba8d61919d4419dd38301536e32a94b" # datreeio/CRDs-catalog
for values in "$CHART"/ci/*.yaml; do
  echo "== $(basename "$values")"
  "$HELM" template r "$CHART" -f "$values" |
    "$KUBECONFORM" -strict -summary -kubernetes-version "$K8S_VERSION" \
      -schema-location "https://raw.githubusercontent.com/yannh/kubernetes-json-schema/$K8S_SCHEMAS/{{.NormalizedKubernetesVersion}}-standalone{{.StrictSuffix}}/{{.ResourceKind}}{{.KindSuffix}}.json" \
      -schema-location "https://raw.githubusercontent.com/datreeio/CRDs-catalog/$CRD_SCHEMAS/{{.Group}}/{{.ResourceKind}}_{{.ResourceAPIVersion}}.json"
done
