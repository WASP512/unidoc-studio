#!/usr/bin/env bash
# UniDoc Studio installer for Linux and macOS:  bash install.sh
set -e
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22.6 or later is required. Get it from https://nodejs.org/en/download and run this again."
  exit 1
fi
exec node scripts/setup.mjs "$@"
