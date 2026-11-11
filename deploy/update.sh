#!/usr/bin/env bash
# Updates a UniDoc Studio install that was made by provision-debian.sh (for
# example the Proxmox container) to the latest version. The login is kept, and
# the running version stays up until the new one has been built.
#
# Normally this is started by the "Update" button in the web interface: the
# installer puts this script at /usr/local/sbin/unidoc-studio-update and a
# systemd path unit runs it as root when the app asks. The app cannot pass it
# anything: where the update comes from is fixed here.
#
# By hand, inside the machine, as root:
#     curl -fsSL https://raw.githubusercontent.com/WASP512/unidoc-studio/main/deploy/update.sh | bash
# From the Proxmox host, for container <CTID>:
#     pct exec <CTID> -- bash -c "curl -fsSL https://raw.githubusercontent.com/WASP512/unidoc-studio/main/deploy/update.sh | bash"
#
# Options (environment):
#   UNIDOC_REPO         WASP512/unidoc-studio
#   UNIDOC_REF          main (a branch, tag or commit)
#   UNIDOC_ARCHIVE_URL  where to download the source archive from (default: GitHub, from the two above)
set -euo pipefail

main() {
  REPO=${UNIDOC_REPO:-WASP512/unidoc-studio}
  REF=${UNIDOC_REF:-main}
  URL=${UNIDOC_ARCHIVE_URL:-https://github.com/$REPO/archive/$REF.tar.gz}
  STATE=/var/lib/unidoc-studio
  UPD=$STATE/update
  REQUESTED=""
  [ "${1:-}" = "--requested" ] && REQUESTED=1
  WORK=""
  NOW=""        # "running" while this run owns the status file
  ERR=""
  FROM=""
  TO=""
  STARTED=$(date +%s)
  RUN="$STARTED-$$"

  stop() { printf '\nUpdate stopped: %s\n' "$*" >&2; ERR=$*; exit 1; }
  # The status file is what the web interface shows. One value per line, no quoting.
  status() {
    NOW=$1
    local finished=""
    [ "$1" = running ] || finished=$(date +%s)
    printf 'run=%s\nstate=%s\nstarted=%s\nfinished=%s\nfrom=%s\nto=%s\nerror=%s\n' \
      "$RUN" "$1" "$STARTED" "$finished" "$FROM" "$TO" "$(printf '%s' "${2:-}" | tr '\n\r' '  ')" > "$UPD/status.new"
    mv -f "$UPD/status.new" "$UPD/status"
  }
  step() {
    printf '\n== %s\n' "$1"
    printf '%s\t%s\t%s\n' "$(date +%s)" "$2" "$1" >> "$UPD/steps"
  }
  finish() {
    [ -n "$WORK" ] && rm -rf "$WORK"
    if [ "$NOW" = running ]; then status failed "${ERR:-the update stopped unexpectedly.}"; fi
    return 0
  }
  trap finish EXIT

  [ "$(id -u)" = 0 ] || stop "run this as root."
  # Take the request away first, so that it starts one update and not a loop of them.
  [ -n "$REQUESTED" ] && rm -f "$STATE/request/update"
  [ -f /etc/systemd/system/unidoc-studio.service ] ||
    stop "no UniDoc Studio service found on this machine. Use the installer instead (see README, \"Install\")."

  install -d -o root -g root -m 0755 "$STATE" "$UPD"
  exec 9> /run/unidoc-studio-update.lock
  if ! flock -n 9; then
    [ -n "$REQUESTED" ] && exit 0
    stop "another update is already running."
  fi

  : > "$UPD/steps"
  if [ -n "$REQUESTED" ]; then exec > "$UPD/log" 2>&1; else : > "$UPD/log"; fi
  if [ -f "$UPD/installed" ]; then FROM=$(tr -cd '0-9a-f' < "$UPD/installed" | head -c 40); fi
  status running

  WORK=$(mktemp -d)
  step "Checking for a new version" 3
  curl -fsSL --retry 2 --max-time 600 -o "$WORK/src.tar.gz" "$URL" ||
    stop "could not download $URL. Check that this machine can reach the internet."
  # GitHub archives carry the commit they were made from.
  TO=$( (gzip -dc "$WORK/src.tar.gz" 2>/dev/null | head -c 2048 | tr -d '\0' | grep -ao 'comment=[0-9a-f]\{40\}' | head -n 1 | cut -d= -f2) || true)
  echo "installed: ${FROM:-unknown}"
  echo "available: ${TO:-unknown}"
  if [ -n "$REQUESTED" ] && [ -n "$TO" ] && [ "$TO" = "$FROM" ]; then
    echo "already up to date"
    status uptodate
    exit 0
  fi

  tar -xzf "$WORK/src.tar.gz" -C "$WORK" --wildcards --strip-components=2 '*/deploy/provision-debian.sh' ||
    stop "the source archive does not contain deploy/provision-debian.sh."
  if ! UNIDOC_UPDATE_RUN=1 UNIDOC_STEPS_FILE="$UPD/steps" UNIDOC_ERROR_FILE="$WORK/error" bash "$WORK/provision-debian.sh" "$WORK/src.tar.gz"; then
    ERR=$(head -c 600 "$WORK/error" 2>/dev/null || true)
    ERR=${ERR:-the installer stopped. See /var/log/unidoc-studio-install.log on the machine.}
    exit 1
  fi
  status "done"
  exit 0
}

main "$@"
