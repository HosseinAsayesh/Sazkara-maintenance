#!/usr/bin/env bash
# Runs scripts/package-release.ts inside Ubuntu 24.04 (deploy/build/Dockerfile), the
# server's OS, so a release never depends on what the laptop runs.
#
#   npm run package:release:docker                      -> ../handover
#   npm run package:release:docker -- --out ~/somewhere
#   SAZKARA_WEBPACK=1 npm run package:release:docker    (low-memory bundler, see package-release.ts)
#
# Like package-release.ts, only what is committed is built: the container clones this
# repo's HEAD and installs its own node_modules from package-lock.json.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/../handover"
while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

IMAGE=sazkara-release-builder:ubuntu24.04
LICENSE_HOME="$HOME/.sazkara-license"
NPM_CACHE="$HOME/.cache/sazkara-release-npm"

if [ -n "$(git -C "$ROOT" status --porcelain)" ]; then
  echo
  echo "  NOTE: you have uncommitted changes. They are NOT in this package - only"
  echo "  what is committed is. Commit first if they should be included."
fi

# package-release.ts deletes and recreates OUT itself, so mount its parent, not OUT.
mkdir -p "$(dirname "$OUT")" "$LICENSE_HOME" "$NPM_CACHE"
OUT_PARENT="$(cd "$(dirname "$OUT")" && pwd)"
OUT_NAME="$(basename "$OUT")"

echo "== Preparing the Ubuntu 24.04 build image"
docker build -q -t "$IMAGE" "$ROOT/deploy/build" >/dev/null

echo "== Building inside Ubuntu 24.04"
docker run --rm \
  --user "$(id -u):$(id -g)" \
  -e SAZKARA_WEBPACK="${SAZKARA_WEBPACK:-}" \
  -v "$ROOT:/src:ro" \
  -v "$OUT_PARENT:/out" \
  -v "$LICENSE_HOME:/home/builder/.sazkara-license" \
  -v "$NPM_CACHE:/home/builder/.npm" \
  "$IMAGE" \
  bash -euc '
    git clone --quiet /src /tmp/work
    cd /tmp/work
    echo "== Installing dependencies for Linux"
    npm ci --no-audit --no-fund
    npx tsx scripts/package-release.ts --out "/out/$1"
  ' _ "$OUT_NAME"

echo "Release written to $OUT_PARENT/$OUT_NAME"
