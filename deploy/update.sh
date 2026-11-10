#!/usr/bin/env bash
# Updates a UniDoc Studio install that was made by provision-debian.sh (for
# example the Proxmox container) to the latest version. The login is kept.
#
#   Inside the machine, as root:
#     curl -fsSL https://raw.githubusercontent.com/WASP512/unidoc-studio/main/deploy/update.sh | bash
#   From the Proxmox host, for container <CTID>:
#     pct exec <CTID> -- bash -c "curl -fsSL https://raw.githubusercontent.com/WASP512/unidoc-studio/main/deploy/update.sh | bash"
#
# Options (environment): UNIDOC_REPO (WASP512/unidoc-studio), UNIDOC_REF (main; a branch, tag or commit)
set -euo pipefail

REPO=${UNIDOC_REPO:-WASP512/unidoc-studio}
REF=${UNIDOC_REF:-main}
die() { printf '\nUpdate stopped: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "run this as root."
[ -f /etc/systemd/system/unidoc-studio.service ] ||
  die "no UniDoc Studio service found on this machine. Use the installer instead (see README, \"Install\")."

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
printf '\n== Downloading %s (%s)\n' "$REPO" "$REF"
curl -fsSL -o "$WORK/src.tar.gz" "https://github.com/$REPO/archive/$REF.tar.gz" ||
  die "could not download https://github.com/$REPO/archive/$REF.tar.gz"
tar -xzf "$WORK/src.tar.gz" -C "$WORK" --wildcards --strip-components=2 '*/deploy/provision-debian.sh' ||
  die "the source archive does not contain deploy/provision-debian.sh."
bash "$WORK/provision-debian.sh" "$WORK/src.tar.gz"
