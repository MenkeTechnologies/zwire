#!/usr/bin/env bash
# fork/apply-patches.sh — apply the zbrowser HUD patch series over a checked-out
# Chromium tree.
#
#   fork/apply-patches.sh SRC   [--reverse]
#
# SRC is the Chromium src/ dir (from fork/fetch.sh). Patches are applied in the
# order listed in fork/patches/series, with `git apply` from SRC. --reverse
# unapplies them (to rebase onto a new Chromium tag).
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
PATCH_DIR=$ROOT/fork/patches
SERIES=$PATCH_DIR/series
SRC=${1:?usage: apply-patches.sh SRC [--reverse]}
REVERSE=${2:-}

[[ -d $SRC ]] || { echo "apply-patches: no src dir at $SRC" >&2; exit 1; }
[[ -f $SERIES ]] || { echo "apply-patches: no series file at $SERIES" >&2; exit 1; }

# Ordered, comment/blank-tolerant series read.
mapfile -t PATCHES < <(grep -vE '^\s*(#|$)' "$SERIES")
[[ ${#PATCHES[@]} -gt 0 ]] || { echo "apply-patches: series is empty (Phase 1 not authored yet)" >&2; exit 0; }

apply_one() {
  local p=$PATCH_DIR/$1
  [[ -f $p ]] || { echo "apply-patches: missing $p" >&2; exit 1; }
  if [[ $REVERSE == --reverse ]]; then
    git -C "$SRC" apply --reverse --3way "$p"
    echo "  - reversed $1" >&2
  else
    git -C "$SRC" apply --3way "$p"
    echo "  + applied  $1" >&2
  fi
}

# Reverse order when unapplying.
if [[ $REVERSE == --reverse ]]; then
  for (( i=${#PATCHES[@]}-1; i>=0; i-- )); do apply_one "${PATCHES[$i]}"; done
else
  for p in "${PATCHES[@]}"; do apply_one "$p"; done
fi
echo "apply-patches: done (${#PATCHES[@]} patches)" >&2
