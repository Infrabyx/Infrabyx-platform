#!/bin/sh
# Debian 12 security fixes that the pinned base node:24.22.1-bookworm-slim does not carry yet,
# installed in every runtime stage before its package managers are removed (owner, 28 Nov 2026;
# R1-D-319). Each version is pinned exactly and was confirmed in Debian's own archive (the
# bookworm-security Packages index for amd64 and arm64, 28 Nov 2026), not only in the scanner's
# database:
#   libzstd1 1.5.4+dfsg2-5+deb12u1          CVE-2026-124851
#   libpam0g, libpam-modules, libpam-modules-bin, libpam-runtime 1.5.2-6+deb12u3   CVE-2025-6020
#   apt, libapt-pkg6.0 2.6.2                 CVE-2026-109518
# Node.js 24.22.1 bundles its own zstd 1.5.7, which this does not touch: refuseZstdBodies and
# refuseZstdFetch (@infrabyx/connectors/content-coding) stay.
#
# Used as a bind mount, so no layer keeps the script:
#   RUN --mount=type=bind,source=infra/docker/debian-fixes.sh,target=/tmp/debian-fixes.sh \
#       --mount=type=secret,id=ca,required=false \
#       sh /tmp/debian-fixes.sh && ...
# Products copy this file and use the same line (docs/product-guide.md §7fj).
#
# Behind a TLS-inspecting proxy (a session container), pass its CA as the `ca` build secret and
# the proxy as the predefined `https_proxy` build argument, with --network host: apt then reads
# the same archive over HTTPS, trusting that CA. Without the secret (CI, product builds) apt uses
# the image's own sources unchanged. Either way apt checks the archive's signatures.
set -eu
export DEBIAN_FRONTEND=noninteractive

PINS="libzstd1=1.5.4+dfsg2-5+deb12u1
libpam0g=1.5.2-6+deb12u3
libpam-modules=1.5.2-6+deb12u3
libpam-modules-bin=1.5.2-6+deb12u3
libpam-runtime=1.5.2-6+deb12u3
apt=2.6.2
libapt-pkg6.0=2.6.2"

if [ -s /run/secrets/ca ]; then
  mkdir -p /tmp/apt-https/sources.list.d
  sed 's#http://deb.debian.org/#https://deb.debian.org/#' /etc/apt/sources.list.d/debian.sources \
    > /tmp/apt-https/sources.list.d/debian.sources
  # apt downloads as the unprivileged _apt user, which cannot read the secret itself.
  install -m 0644 /run/secrets/ca /tmp/apt-https/ca.crt
  set -- -o Dir::Etc::SourceParts=/tmp/apt-https/sources.list.d -o Acquire::https::CaInfo=/tmp/apt-https/ca.crt
fi

apt-get "$@" update
# shellcheck disable=SC2086 # one pinned package per word
apt-get "$@" install -y --no-install-recommends $PINS

# Fail the build unless every package is now exactly the pinned version.
for pin in $PINS; do
  name="${pin%%=*}"
  want="${pin#*=}"
  got="$(dpkg-query -W -f '${Version}' "$name")"
  if [ "$got" != "$want" ]; then
    echo "debian-fixes: $name is $got, expected $want" >&2
    exit 1
  fi
done

apt-get clean
rm -rf /var/lib/apt/lists/* /tmp/apt-https
