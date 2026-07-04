#!/usr/bin/env bash
# fork/fetch.sh — check out the pinned Chromium source for the zbrowser fork.
#
#   fork/fetch.sh [SRC_ROOT]
#
# SRC_ROOT defaults to $ZBROWSER_SRC or ~/zbrowser-chromium. Expect ~100GB and
# 30min–several hours. Installs depot_tools if missing, fetches Chromium,
# checks out the pinned tag from fork/CHROMIUM_VERSION, and syncs deps.
#
# Reference model: ungoogled-chromium / helium-chromium (pinned tag + patch
# series). See fork/README.md.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
VERSION=$(cat "$ROOT/fork/CHROMIUM_VERSION")
SRC_ROOT=${1:-${ZBROWSER_SRC:-$HOME/zbrowser-chromium}}
DEPOT=$SRC_ROOT/depot_tools

echo "fork/fetch: target Chromium $VERSION into $SRC_ROOT" >&2
mkdir -p "$SRC_ROOT"

# 1. depot_tools
if [[ ! -d $DEPOT ]]; then
  git -C "$SRC_ROOT" clone https://chromium.googlesource.com/chromium/tools/depot_tools.git
fi
export PATH="$DEPOT:$PATH"

# 2. fetch chromium (no history to save space/time)
if [[ ! -d $SRC_ROOT/src ]]; then
  ( cd "$SRC_ROOT" && fetch --no-history chromium )
fi

# 3. checkout the pinned release tag + sync deps for that tag
(
  cd "$SRC_ROOT/src"
  git fetch --tags origin
  git checkout "tags/$VERSION" -B "zbrowser-$VERSION"
  gclient sync --no-history --with_branch_heads --with_tags -D
  gclient runhooks
)

echo "fork/fetch: done. src at $SRC_ROOT/src (branch zbrowser-$VERSION)" >&2
echo "fork/fetch: next -> fork/apply-patches.sh $SRC_ROOT/src" >&2
