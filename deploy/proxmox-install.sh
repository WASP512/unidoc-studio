#!/usr/bin/env bash
# One-step install of UniDoc Studio on Proxmox VE. Run it in the Proxmox host
# shell as root. It creates an unprivileged Debian container, installs the app
# in it as a service, and prints the address and login when it is done.
#
#   Straight from GitHub:
#     curl -fsSL https://raw.githubusercontent.com/WASP512/unidoc-studio/main/deploy/proxmox-install.sh | bash
#
#   From a copy of the repository on the host:
#     bash deploy/proxmox-install.sh
#
# Options (environment), all optional:
#   CTID            container ID                      (default: next free ID)
#   CT_HOSTNAME     container hostname                (default: unidoc-studio)
#   CT_STORAGE      storage for the container disk    (default: first storage that allows containers)
#   TEMPLATE_STORAGE storage for the OS template      (default: first storage that allows templates)
#   CT_BRIDGE       network bridge                    (default: vmbr0)
#   CT_IP           "dhcp" or "192.168.1.50/24"       (default: dhcp)
#   CT_GATEWAY      gateway, with a static CT_IP
#   CT_VLAN         VLAN tag for the container's network card
#   CT_CORES / CT_MEMORY / CT_DISK   2 cores / 2048 MB / 8 GB
#   UNIDOC_USER / UNIDOC_PASSWORD    login (default: unidoc / a random password printed once)
#   GITHUB_TOKEN    read-only token, only needed if the repository is private
#   UNIDOC_REPO / UNIDOC_REF         WASP512/unidoc-studio / main
set -euo pipefail

REPO=${UNIDOC_REPO:-WASP512/unidoc-studio}
REF=${UNIDOC_REF:-main}
CT_HOSTNAME=${CT_HOSTNAME:-unidoc-studio}
CT_BRIDGE=${CT_BRIDGE:-vmbr0}
CT_IP=${CT_IP:-dhcp}
CT_CORES=${CT_CORES:-2}
CT_MEMORY=${CT_MEMORY:-2048}
CT_DISK=${CT_DISK:-8}

say() { printf '\n== %s\n' "$*"; }
die() { printf '\nInstall stopped: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "run this as root in the Proxmox host shell."
for tool in pct pveam pvesm pvesh; do
  command -v "$tool" >/dev/null 2>&1 || die "'$tool' not found. This script runs on the Proxmox VE host, not inside a VM or container."
done

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# ---------------------------------------------------------------- source
say "Getting the UniDoc Studio source"
HERE=""
case "${BASH_SOURCE[0]:-}" in
  */proxmox-install.sh|proxmox-install.sh) HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." 2>/dev/null && pwd) ;;
esac
if [ -n "$HERE" ] && [ -f "$HERE/package.json" ] && [ -f "$HERE/deploy/provision-debian.sh" ]; then
  echo "using the local copy in $HERE"
  tar -czf "$WORK/src.tar.gz" -C "$(dirname "$HERE")" \
    --exclude="$(basename "$HERE")/node_modules" --exclude="$(basename "$HERE")/.next" --exclude="$(basename "$HERE")/.git" \
    "$(basename "$HERE")"
elif [ -n "${GITHUB_TOKEN:-}" ]; then
  echo "downloading $REPO ($REF) from GitHub"
  # The token is passed to curl on stdin so it never shows in the process list.
  printf 'header = "Authorization: Bearer %s"\n' "$GITHUB_TOKEN" |
    curl -fsSL --config - -H "Accept: application/vnd.github+json" -o "$WORK/src.tar.gz" "https://api.github.com/repos/$REPO/tarball/$REF" ||
    die "could not download the source. Check that the token can read $REPO."
else
  echo "downloading $REPO ($REF) from GitHub"
  curl -fsSL -o "$WORK/src.tar.gz" "https://github.com/$REPO/archive/$REF.tar.gz" ||
    die "could not download https://github.com/$REPO/archive/$REF.tar.gz. If the repository is private, set GITHUB_TOKEN to a read-only token, or copy the repository to this host and run deploy/proxmox-install.sh from it."
fi
tar -xzf "$WORK/src.tar.gz" -C "$WORK" --wildcards --strip-components=2 '*/deploy/provision-debian.sh' ||
  die "the source archive does not contain deploy/provision-debian.sh."

# ---------------------------------------------------------------- container
CTID=${CTID:-$(pvesh get /cluster/nextid)}
pct status "$CTID" >/dev/null 2>&1 && die "container ID $CTID already exists. Set CTID to a free ID."
CT_STORAGE=${CT_STORAGE:-$(pvesm status --content rootdir 2>/dev/null | awk 'NR>1 && $3=="active" {print $1; exit}')}
TEMPLATE_STORAGE=${TEMPLATE_STORAGE:-$(pvesm status --content vztmpl 2>/dev/null | awk 'NR>1 && $3=="active" {print $1; exit}')}
[ -n "$CT_STORAGE" ] || die "no storage that allows containers was found. Set CT_STORAGE."
[ -n "$TEMPLATE_STORAGE" ] || die "no storage that allows container templates was found. Set TEMPLATE_STORAGE."

say "Preparing the Debian template"
pveam update >/dev/null 2>&1 || true
# The template list can hold several CPU architectures; only this host's will start.
ARCH=$(dpkg --print-architecture 2>/dev/null || true)
case "$ARCH" in amd64|arm64) ;; *) die "unsupported host architecture '${ARCH:-unknown}' (expected amd64 or arm64)." ;; esac
TEMPLATE=$(pveam available --section system 2>/dev/null | awk '{print $2}' | grep -E "^debian-1[23]-standard_.*_${ARCH}\.tar" | sort -V | tail -n 1 || true)
[ -n "$TEMPLATE" ] || die "no Debian 12 or 13 template for $ARCH is offered by this Proxmox host (pveam available --section system)."
if ! pveam list "$TEMPLATE_STORAGE" 2>/dev/null | grep -q "$TEMPLATE"; then
  pveam download "$TEMPLATE_STORAGE" "$TEMPLATE" >/dev/null || die "could not download $TEMPLATE to $TEMPLATE_STORAGE."
fi
echo "$TEMPLATE"

NET="name=eth0,bridge=$CT_BRIDGE,ip=$CT_IP"
if [ "$CT_IP" != dhcp ] && [ -n "${CT_GATEWAY:-}" ]; then NET="$NET,gw=$CT_GATEWAY"; fi
if [ -n "${CT_VLAN:-}" ]; then NET="$NET,tag=$CT_VLAN"; fi

say "Creating container $CTID ($CT_HOSTNAME) on $CT_STORAGE"
pct create "$CTID" "$TEMPLATE_STORAGE:vztmpl/$TEMPLATE" \
  --hostname "$CT_HOSTNAME" --ostype debian --arch "$ARCH" --unprivileged 1 --features nesting=1 \
  --cores "$CT_CORES" --memory "$CT_MEMORY" --swap 512 --rootfs "$CT_STORAGE:$CT_DISK" \
  --net0 "$NET" --onboot 1 --tags unidoc >/dev/null ||
  die "could not create container $CTID."
if ! pct start "$CTID"; then
  # Nothing has run in it yet, so remove the container this script just created.
  pct destroy "$CTID" >/dev/null 2>&1 && removed="It was removed again." || removed="Remove it with: pct destroy $CTID"
  die "container $CTID did not start (template $TEMPLATE, storage $CT_STORAGE, bridge $CT_BRIDGE). $removed"
fi

say "Waiting for the container's network"
ready=""
for _ in $(seq 1 60); do
  if pct exec "$CTID" -- getent hosts deb.debian.org >/dev/null 2>&1; then ready=1; break; fi
  sleep 2
done
[ -n "$ready" ] || die "container $CTID has no working network or DNS (bridge $CT_BRIDGE, ip $CT_IP). Fix it, then remove the container with: pct stop $CTID && pct destroy $CTID"

# ---------------------------------------------------------------- install
say "Installing inside the container (several minutes)"
pct push "$CTID" "$WORK/src.tar.gz" /root/unidoc-src.tar.gz
pct push "$CTID" "$WORK/provision-debian.sh" /root/provision-debian.sh
# The password, if you chose one, is handed over in a root-only file rather than on a command line.
if [ -n "${UNIDOC_PASSWORD:-}" ]; then
  (umask 077 && printf 'UNIDOC_PASSWORD=%q\n' "$UNIDOC_PASSWORD" > "$WORK/env")
else
  (umask 077 && : > "$WORK/env")
fi
printf 'UNIDOC_USER=%q\n' "${UNIDOC_USER:-unidoc}" >> "$WORK/env"
pct push "$CTID" "$WORK/env" /root/unidoc-env --perms 0600
pct exec "$CTID" -- bash -c 'set -a; . /root/unidoc-env; set +a; rm -f /root/unidoc-env; exec bash /root/provision-debian.sh /root/unidoc-src.tar.gz' ||
  die "the install inside container $CTID failed (see the messages above). The container was left in place for inspection: pct enter $CTID"
pct exec "$CTID" -- rm -f /root/provision-debian.sh

say "Done. Container $CTID starts with the host. To remove it: pct stop $CTID && pct destroy $CTID"
