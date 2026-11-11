#!/usr/bin/env bash
# Installs UniDoc Studio on a Debian 12/13 machine or container as a service,
# behind HTTPS with a password:
#   bash provision-debian.sh <source.tar.gz>
# <source.tar.gz> is the repository with one top-level folder (a GitHub
# "Download tarball", or what deploy/proxmox-install.sh builds).
# Running it again on an existing install is the update: the new version is
# built next to the running one and swapped in only if it builds and starts.
#
# What it sets up:
#   - Node.js 22 (NodeSource apt repository) and Chromium for the PDF export
#   - the app in /opt/unidoc-studio/app, built, running as user "unidoc" on 127.0.0.1:3000
#   - Caddy on port 443 in front of it: HTTPS (self-signed) and a login
#   - the updater behind the "Update" button in the web interface (see deploy/update.sh)
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
NEW_DIR=$APP_HOME/app.new
OLD_DIR=$APP_HOME/app.old
# Root-owned state: the app can read update progress here but cannot write it.
STATE=/var/lib/unidoc-studio
UNIT=/etc/systemd/system/unidoc-studio.service
LOG=/var/log/unidoc-studio-install.log
LOGIN_USER=${UNIDOC_USER:-unidoc}
UPDATE_RUN=${UNIDOC_UPDATE_RUN:-}
export DEBIAN_FRONTEND=noninteractive
# The caller's locale (for example en_US.UTF-8 from a Proxmox host) usually does not
# exist in a fresh container, which makes every package step print locale warnings.
export LANG=C.UTF-8 LC_ALL=C.UTF-8
unset LANGUAGE

# say <text> [percent]: prints the step and, during an update, records it for the web interface.
say() {
  printf '\n== %s\n' "$1"
  if [ -n "${UNIDOC_STEPS_FILE:-}" ]; then
    printf '%s\t%s\t%s\n' "$(date +%s)" "${2:-}" "$1" >> "$UNIDOC_STEPS_FILE" || true
  fi
}
die() {
  printf '\nProvisioning stopped: %s\n' "$*" >&2
  if [ -n "${UNIDOC_ERROR_FILE:-}" ]; then printf '%s\n' "$*" > "$UNIDOC_ERROR_FILE" || true; fi
  exit 1
}
# Everything inside the app's home is done as the app's user, never as root.
as_app() { runuser -u unidoc -- env HOME="$APP_HOME" "$@"; }
have_systemd() { [ -d /run/systemd/system ]; }
app_answers() {
  local _
  for _ in $(seq 1 "${1:-30}"); do
    curl -fs -o /dev/null http://127.0.0.1:3000 && return 0
    sleep 1
  done
  return 1
}

[ "$(id -u)" = 0 ] || die "run this as root."
[ -r "$SRC" ] || die "cannot read $SRC."
. /etc/os-release
[ "${ID:-}" = debian ] || die "this script supports Debian 12 and 13 (found ${PRETTY_NAME:-unknown}). On other systems use Docker: docker compose up -d --build"

# GitHub archives carry the commit they were made from; it becomes the installed version.
COMMIT=${UNIDOC_COMMIT:-$( (gzip -dc "$SRC" 2>/dev/null | head -c 2048 | tr -d '\0' | grep -ao 'comment=[0-9a-f]\{40\}' | head -n 1 | cut -d= -f2) || true)}

say "Installing system packages" 12
apt-get update -qq
apt-get install -y -qq --no-install-recommends ca-certificates curl gnupg chromium fonts-liberation caddy >/dev/null

say "Installing Node.js 22" 20
if ! command -v node >/dev/null 2>&1 || ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=6)?0:1)'; then
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update -qq
  apt-get install -y -qq nodejs >/dev/null
fi
node --version

say "Building the new version" 28
id unidoc >/dev/null 2>&1 || useradd --system --create-home --home-dir "$APP_HOME" --shell /usr/sbin/nologin unidoc
install -d -o unidoc -g unidoc "$APP_HOME"
install -d -o root -g root -m 0755 "$STATE" "$STATE/update"
# The app asks for an update by creating a file here; nothing in it is read.
install -d -o unidoc -g unidoc -m 0700 "$STATE/request"
FREE_MB=$(df -Pm "$APP_HOME" | awk 'NR==2 {print $4}')
[ "${FREE_MB:-0}" -ge 1500 ] || die "only ${FREE_MB:-0} MB free in $APP_HOME; building needs about 1500 MB. Nothing was changed."
as_app rm -rf "$NEW_DIR" "$OLD_DIR"
as_app mkdir "$NEW_DIR"
as_app tar -xzf - -C "$NEW_DIR" --strip-components=1 < "$SRC"
: > "$LOG"
ln -sfn "$LOG" "$STATE/update/build.log"
echo "downloading dependencies and building: about 2 to 10 minutes, nothing is printed meanwhile"
echo "(to watch it from another shell: tail -f $LOG inside this machine)"
if ! as_app bash "$NEW_DIR/install.sh" > "$LOG" 2>&1; then
  tail -n 30 "$LOG" >&2
  as_app rm -rf "$NEW_DIR"
  if [ -d "$APP_DIR" ]; then
    die "the new version did not build, so the installed version was left running. Full log: $LOG"
  fi
  die "the app did not build. Full log: $LOG"
fi
echo "built (log: $LOG)"

say "Switching to the new version" 82
# Chromium's own sandbox does not start inside an unprivileged container; the
# renderer only loads this app's own pages, and the container is the boundary.
SANDBOX_LINE=""
if [ -f /.dockerenv ] || { command -v systemd-detect-virt >/dev/null 2>&1 && systemd-detect-virt --container --quiet; }; then
  SANDBOX_LINE="Environment=UNIDOC_CHROME_NO_SANDBOX=1"
fi
HAD_OLD=""
if have_systemd; then systemctl stop unidoc-studio 2>/dev/null || true; fi
if [ -d "$APP_DIR" ]; then
  as_app mv "$APP_DIR" "$OLD_DIR"
  HAD_OLD=1
  if [ -f "$UNIT" ]; then cp -p "$UNIT" "$UNIT.previous"; fi
fi
as_app mv "$NEW_DIR" "$APP_DIR"
cat > "$UNIT" <<UNIT
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
Environment=UNIDOC_UPDATE_DIR=$STATE
$SANDBOX_LINE
ExecStart=/usr/bin/node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3000
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

if have_systemd; then
  systemctl daemon-reload
  systemctl enable unidoc-studio >/dev/null 2>&1
  systemctl restart unidoc-studio
  if ! app_answers 40; then
    if [ -n "$HAD_OLD" ]; then
      # Put the previous version back so the site is not left down.
      systemctl stop unidoc-studio 2>/dev/null || true
      as_app rm -rf "$APP_DIR"
      as_app mv "$OLD_DIR" "$APP_DIR"
      if [ -f "$UNIT.previous" ]; then mv "$UNIT.previous" "$UNIT"; fi
      systemctl daemon-reload
      systemctl restart unidoc-studio || true
      if app_answers 40; then
        die "the new version did not start, so the previous version was put back and is running. Check: journalctl -u unidoc-studio"
      fi
      die "the new version did not start, and the previous version did not come back either. Check: journalctl -u unidoc-studio"
    fi
    die "the app did not answer on 127.0.0.1:3000. Check: journalctl -u unidoc-studio"
  fi
fi
as_app rm -rf "$OLD_DIR"
rm -f "$UNIT.previous"
if [ -n "$COMMIT" ]; then printf '%s\n' "$COMMIT" > "$STATE/update/installed"; else rm -f "$STATE/update/installed"; fi

say "Setting up updates from the web interface" 88
# The updater is taken from the archive, not from the app folder, which the app's user can write to.
UPDATER=$(mktemp)
if tar -xzf "$SRC" -O --wildcards '*/deploy/update.sh' > "$UPDATER" 2>/dev/null && [ -s "$UPDATER" ]; then
  install -o root -g root -m 0755 "$UPDATER" /usr/local/sbin/unidoc-studio-update
  cat > /etc/systemd/system/unidoc-studio-update.service <<UNIT
[Unit]
Description=UniDoc Studio update (asked for from the web interface)
After=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/unidoc-studio-update --requested
TimeoutStartSec=3600
UNIT
  cat > /etc/systemd/system/unidoc-studio-update.path <<UNIT
[Unit]
Description=Starts a UniDoc Studio update when the web interface asks for one

[Path]
PathExists=$STATE/request/update
Unit=unidoc-studio-update.service

[Install]
WantedBy=multi-user.target
UNIT
  if have_systemd; then
    systemctl daemon-reload
    systemctl enable --now unidoc-studio-update.path >/dev/null 2>&1
  fi
else
  echo "this source has no deploy/update.sh; updates from the web interface are not set up."
fi
rm -f "$UPDATER"

say "Configuring HTTPS and the login" 93
GENERATED=""
KEPT=""
KEEP_PROXY=""
PASSWORD=${UNIDOC_PASSWORD:-}
HASH=""
if [ -z "$PASSWORD" ] && grep -q 'Written by provision-debian.sh' /etc/caddy/Caddyfile 2>/dev/null; then
  # Re-run (update): keep the existing login unless a new password was supplied.
  read -r OLD_USER OLD_HASH < <(awk '/basicauth \{/ {getline; print $1, $2; exit}' /etc/caddy/Caddyfile) || true
  case "${OLD_HASH:-}" in '$2'*) LOGIN_USER=$OLD_USER; HASH=$OLD_HASH; KEPT=1 ;; esac
fi
if [ -z "$HASH" ] && [ -n "$UPDATE_RUN" ] && [ -z "$PASSWORD" ]; then
  # An update never invents a new login or replaces a web server configuration it did not write.
  KEEP_PROXY=1
  echo "the web server configuration was changed by hand, so it is left as it is."
fi
ADDR=$(hostname -I 2>/dev/null | awk '{print $1}')
HOST=$(hostname)
if [ -z "$KEEP_PROXY" ]; then
  if [ -z "$HASH" ]; then
    if [ -z "$PASSWORD" ]; then
      PASSWORD=$(head -c 18 /dev/urandom | base64 | tr -d '/+=' | cut -c1-20)
      GENERATED=1
    fi
    # Only the bcrypt hash is stored. The password goes in on stdin, not on a command line.
    HASH=$(printf '%s\n' "$PASSWORD" | caddy hash-password 2>/dev/null | tail -n 1)
    case "$HASH" in '$2'*) ;; *) die "could not hash the password with caddy." ;; esac
  fi
  SITES="https://$HOST"
  [ -n "$ADDR" ] && SITES="https://$ADDR, $SITES"
  CADDYFILE=$(cat <<CADDY
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
)
  PROXY_CHANGED=""
  if [ "$(cat /etc/caddy/Caddyfile 2>/dev/null || true)" != "$CADDYFILE" ]; then
    printf '%s\n' "$CADDYFILE" > /etc/caddy/Caddyfile
    PROXY_CHANGED=1
  fi
  chmod 0640 /etc/caddy/Caddyfile
  chown root:caddy /etc/caddy/Caddyfile 2>/dev/null || true
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || die "the generated Caddyfile did not validate."
fi

if have_systemd; then
  if [ -z "$KEEP_PROXY" ]; then
    systemctl enable caddy >/dev/null 2>&1
    # Restarting the web server drops open connections, so only when its configuration changed.
    if [ -n "$PROXY_CHANGED" ] || ! systemctl is-active --quiet caddy; then systemctl restart caddy; fi
    code=""
    for _ in $(seq 1 10); do
      code=$(curl -ks -o /dev/null -w '%{http_code}' "https://${ADDR:-$HOST}/" || true)
      [ "$code" = 401 ] && break
      sleep 1
    done
    [ "$code" = 401 ] || die "expected the login prompt (HTTP 401) on https://${ADDR:-$HOST}/ but got ${code:-no answer}. Check: journalctl -u caddy"
  fi
else
  echo "systemd is not running here, so the services were configured but not started."
fi

rm -f "$SRC"
say "UniDoc Studio is installed" 100
echo "  Address : https://${ADDR:-$HOST}/"
[ -n "$COMMIT" ] && echo "  Version : $COMMIT"
if [ -n "$KEEP_PROXY" ]; then
  echo "  Login   : unchanged"
else
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
fi
echo "  To update later: the Update button at the top of the web interface."
