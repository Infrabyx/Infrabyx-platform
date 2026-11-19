#!/bin/bash
# The image's entrypoint: starts Keycloak with the JVM mitigations every node must carry, then hands
# over to Keycloak's own kc.sh with the same arguments (`start`, `start --optimized`, `start-dev`, ...).
#
# CVE-2026-114938 ("Java4Shell"; owner answer #143, waiver OWNER-WAIVER-CRIT-01, R1-D-192): the
# HotSpot Base64 intrinsic is turned off on every host, whatever the CPU, because Keycloak decodes
# Base64 from requests before authentication. The flag is appended last to JAVA_OPTS_APPEND, which
# kc.sh puts after every other JVM option, and HotSpot takes the last value of a repeated flag, so a
# deployment's own JAVA_OPTS or JAVA_OPTS_APPEND cannot drop it. The JVM reads three more variables
# that could turn the intrinsic back on (_JAVA_OPTIONS is applied after the command line); a value
# that names the flag in any of them is refused, so the node fails closed instead of starting
# unprotected.
#
# `ipb-kc.sh --ipb-verify-jvm` checks the flag on this image's JVM and exits (the image build and
# infra/docker/keycloak-jvm-flags.e2e.test.mjs run it; the e2e test also reads the live JVM's flags).
set -euo pipefail

readonly IPB_JVM_MITIGATION="-XX:-UseBASE64Intrinsics"

for var in _JAVA_OPTIONS JDK_JAVA_OPTIONS JAVA_TOOL_OPTIONS; do
  if [[ "${!var:-}" == *UseBASE64Intrinsics* ]]; then
    echo "ipb-kc.sh: refusing to start: ${var} names UseBASE64Intrinsics; the image sets ${IPB_JVM_MITIGATION} itself (CVE-2026-114938)" >&2
    exit 64
  fi
done
# The image's ENV already holds the flag; it is appended again unless it is already the last option.
if [[ "${JAVA_OPTS_APPEND:-}" != *"${IPB_JVM_MITIGATION}" ]]; then
  export JAVA_OPTS_APPEND="${JAVA_OPTS_APPEND:+${JAVA_OPTS_APPEND} }${IPB_JVM_MITIGATION}"
fi

if [[ "${1:-}" == "--ipb-verify-jvm" ]]; then
  # The JVM kc.sh would run (JAVA_HOME if set, else the one on PATH), with the options as appended.
  java="${JAVA_HOME:+${JAVA_HOME}/bin/}java"
  # shellcheck disable=SC2086 # word splitting of the options is intended, as in kc.sh
  flags="$("$java" ${JAVA_OPTS_APPEND} -XX:+PrintFlagsFinal -version 2>/dev/null)"
  if grep -Eq '^ *bool +UseBASE64Intrinsics += false +\{[^}]*\} +\{command line\}' <<<"$flags"; then
    echo "ipb-kc.sh: UseBASE64Intrinsics=false {command line}"
    exit 0
  fi
  echo "ipb-kc.sh: UseBASE64Intrinsics is not false from the command line:" >&2
  grep -E 'UseBASE64Intrinsics' <<<"$flags" >&2 || true
  exit 1
fi

exec /opt/keycloak/bin/kc.sh "$@"
