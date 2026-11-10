#!/usr/bin/env bash
# Starts UniDoc Studio on http://127.0.0.1:3000 (Ctrl+C to stop):  bash start.sh
set -e
cd "$(dirname "$0")"
if [ ! -d .next ]; then
  echo "Not installed yet. Run:  bash install.sh"
  exit 1
fi
echo "UniDoc Studio: http://127.0.0.1:${PORT:-3000}   (Ctrl+C to stop)"
exec npm start
