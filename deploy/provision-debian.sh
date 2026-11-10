#!/usr/bin/env bash
# Installs UniDoc Studio on a Debian 12/13 machine or container as a service,
# behind HTTPS with a password:
#   bash provision-debian.sh <source.tar.gz>
# <source.tar.gz> is the repository with one top-level folder (a GitHub
# "Download tarball", or what deploy/proxmox-install.sh builds).
#
# What it sets up:
#   - Node.js 22 (NodeSource apt repository) and Chromium for the PDF export
#   - the app in /opt/unidoc-studio/app, built, running as user "unidoc" on 127.0.0.1:3000
#   - Caddy on port 443 in front of it: HTTPS (self-signed) and a login
# The app itself has no login, so it is never exposed directly.
#
# Options (environment):
#   UNIDOC_USER       login name (default: unidoc)
#   UNIDOC_PASSWORD   login password (default: a random one, printed once at the end;
#                     running the script again keeps the existing login)
set -euo pipefail

SRC=${1:?usage: provision-debian.sh <source.tar.gz>}
APP_HOME=/opt/unidoc-studio
APP_DIR=$APP_HOME/app
LOGIN_USER=${UNIDOC_USER:-unidoc}
export DEBIAN_FRONTEND=noninteractive
# The caller's locale (for example en_US.UTF-8 from a Proxmox host) usually does not
# exist in a fresh container, which makes every package step print locale warnings.
export LANG=C.UTF-8 LC_ALL=C.UTF-8
unset LANGUAGE

say() { printf '\n== %s\n' "$*"; }
die() { printf '\nProvisioning stopped: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "run this as root."
[ -r "$SRC" ] || die "cannot read $SRC."
. /etc/os-release
[ "${ID:-}" = debian ] || die "this script supports Debian 12 and 13 (found ${PRETTY_NAME:-unknown}). On other systems use Docker: docker compose up -d --build"

say "Installing system packages"
apt-get update -qq
apt-get install -y -qq --no-install-recommends ca-certificates curl gnupg chromium fonts-liberation caddy >/dev/null

say "Installing Node.js 22"
if ! command -v node >/dev/null 2>&1 || ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=6)?0:1)'; then
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update -qq
  apt-get install -y -qq nodejs >/dev/null
fi
node --version

say "Installing the app into $APP_DIR"
id unidoc >/dev/null 2>&1 || useradd --system --create-home --home-dir "$APP_HOME" --shell /usr/sbin/nologin unidoc
systemctl stop unidoc-studio 2>/dev/null || true
rm -rf "$APP_DIR"
install -d -o unidoc -g unidoc "$APP_DIR"
tar -xzf "$SRC" -C "$APP_DIR" --strip-components=1 --no-same-owner
chown -R unidoc:unidoc "$APP_HOME"
LOG=/var/log/unidoc-studio-install.log
echo "downloading dependencies and building: about 2 to 10 minutes, nothing is printed meanwhile"
echo "(to watch it from another shell: tail -f $LOG inside this machine)"
if ! runuser -u unidoc -- env HOME="$APP_HOME" bash "$APP_DIR/install.sh" > "$LOG" 2>&1; then
  tail -n 30 "$LOG" >&2
  die "the app did not build. Full log: $LOG"
fi
echo "built (log: $LOG)"

say "Creating the service"
# Chromium's own sandbox does not start inside an unprivileged container; the
# renderer only loads this app's own pages, and the container is the boundary.
SANDBOX_LINE=""
if [ -f /.dockerenv ] || { command -v systemd-detect-virt >/dev/null 2>&1 && systemd-detect-virt --container --quiet; }; then
  SANDBOX_LINE="Environment=UNIDOC_CHROME_NO_SANDBOX=1"
fi
cat > /etc/systemd/system/unidoc-studio.service <<UNIT
[Unit]
Description=UniDoc Studio (network documentation)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=unidoc
Group=unidoc
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOME=$APP_HOME
$SANDBOX_LINE
ExecStart=/usr/bin/node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3000
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

say "Configuring HTTPS and the login"
GENERATED=""
KEPT=""
PASSWORD=${UNIDOC_PASSWORD:-}
HASH=""
if [ -z "$PASSWORD" ] && grep -q 'Written by provision-debian.sh' /etc/caddy/Caddyfile 2>/dev/null; then
  # Re-run (update): keep the existing login unless a new password was supplied.
  read -r OLD_USER OLD_HASH < <(awk '/basicauth \{/ {getline; print $1, $2; exit}' /etc/caddy/Caddyfile) || true
  case "${OLD_HASH:-}" in '$2'*) LOGIN_USER=$OLD_USER; HASH=$OLD_HASH; KEPT=1 ;; esac
fi
if [ -z "$HASH" ]; then
  if [ -z "$PASSWORD" ]; then
    PASSWORD=$(head -c 18 /dev/urandom | base64 | tr -d '/+=' | cut -c1-20)
    GENERATED=1
  fi
  # Only the bcrypt hash is stored. The password goes in on stdin, not on a command line.
  HASH=$(printf '%s\n' "$PASSWORD" | caddy hash-password 2>/dev/null | tail -n 1)
  case "$HASH" in '$2'*) ;; *) die "could not hash the password with caddy." ;; esac
fi
ADDR=$(hostname -I 2>/dev/null | awk '{print $1}')
HOST=$(hostname)
SITES="https://$HOST"
[ -n "$ADDR" ] && SITES="https://$ADDR, $SITES"
cat > /etc/caddy/Caddyfile <<CADDY
# UniDoc Studio: HTTPS with a self-signed certificate and a login in front of
# the app, which listens on 127.0.0.1:3000 only. Written by provision-debian.sh.
$SITES {
	tls internal
	basicauth {
		$LOGIN_USER $HASH
	}
	reverse_proxy 127.0.0.1:3000
}
CADDY
chmod 0640 /etc/caddy/Caddyfile
chown root:caddy /etc/caddy/Caddyfile 2>/dev/null || true
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || die "the generated Caddyfile did not validate."

if [ -d /run/systemd/system ]; then
  systemctl daemon-reload
  systemctl enable --now unidoc-studio >/dev/null 2>&1
  systemctl enable caddy >/dev/null 2>&1
  systemctl restart caddy
  for _ in $(seq 1 30); do
    curl -fs -o /dev/null http://127.0.0.1:3000 && break
    sleep 1
  done
  curl -fs -o /dev/null http://127.0.0.1:3000 || die "the app did not answer on 127.0.0.1:3000. Check: journalctl -u unidoc-studio"
  code=$(curl -ks -o /dev/null -w '%{http_code}' "https://${ADDR:-$HOST}/" || true)
  [ "$code" = 401 ] || die "expected the login prompt (HTTP 401) on https://${ADDR:-$HOST}/ but got ${code:-no answer}. Check: journalctl -u caddy"
else
  echo "systemd is not running here, so the services were configured but not started."
fi

rm -f "$SRC"
say "UniDoc Studio is installed"
echo "  Address : https://${ADDR:-$HOST}/"
echo "  Login   : $LOGIN_USER"
if [ -n "$GENERATED" ]; then
  echo "  Password: $PASSWORD"
  echo "  This password is shown once and is not stored. Save it now."
elif [ -n "$KEPT" ]; then
  echo "  Password: unchanged from the previous install"
else
  echo "  Password: the one you supplied in UNIDOC_PASSWORD"
fi
echo "  The browser will warn about the certificate once: it is self-signed."
echo "  To change the password later:  caddy hash-password   then replace the hash in /etc/caddy/Caddyfile and run: systemctl reload caddy"
