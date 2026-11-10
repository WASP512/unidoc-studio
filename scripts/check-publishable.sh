#!/usr/bin/env bash
# Pre-publish check: fails if the tree or the sample PDFs contain anything that
# should not leave this machine.
#   bash scripts/check-publishable.sh [extra-pattern-file]
# The optional file holds one extended regex per line (for example hostnames,
# addresses or names from a real site) and is never committed.
set -u
cd "$(dirname "$0")/.."
fail=0

note() { printf '%s\n' "$*"; }

# 1. credential-looking files
if git ls-files | grep -iE '\.(pem|key|crt|p12|pfx)$|(^|/)\.env' >/dev/null; then
  note "FAIL: key, certificate or .env file is tracked"; fail=1
fi

# 2. planted demo secrets must never reach a rendered report
for f in samples/*.pdf; do
  [ -e "$f" ] || continue
  if pdftotext "$f" - 2>/dev/null | grep -qiE 'demo-fake|private-key|preshared|passphrase'; then
    note "FAIL: $f contains a secret marker"; fail=1
  fi
done

# 3. caller-supplied patterns (real-site data)
if [ "${1:-}" != "" ] && [ -r "$1" ]; then
  while IFS= read -r pat; do
    [ -z "$pat" ] && continue
    if git grep -IilE -- "$pat" -- . ':!data/oui.tsv' ':!package-lock.json' >/dev/null 2>&1; then
      note "FAIL: tracked text matches a private pattern"; fail=1
    fi
    for f in samples/*.pdf; do
      [ -e "$f" ] || continue
      if pdftotext "$f" - 2>/dev/null | grep -qiE -- "$pat"; then
        note "FAIL: $f matches a private pattern"; fail=1
      fi
    done
  done < "$1"
fi

[ "$fail" = 0 ] && note "OK: nothing private found"
exit "$fail"
