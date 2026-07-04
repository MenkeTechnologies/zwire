#!/usr/bin/env bash
# scripts/check-patch-series.sh — verify fork/patches/series and the *.patch
# files on disk are in exact 1:1 correspondence.
#
# The series file drives fork/apply-patches.sh; a patch on disk but absent from
# series is silently never applied, and a series entry with no file breaks the
# apply run. This catches both drifts (the 0007 case) before they ship.
#
# Series line format: the patch filename is the first whitespace-delimited token;
# `#`-prefixed lines and blank lines are ignored; trailing `# comment` is allowed.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
DIR=$ROOT/fork/patches
SERIES=$DIR/series
fail=0

[[ -f $SERIES ]] || { echo "check-patch-series: no series file at $SERIES" >&2; exit 1; }

# Series entries (first token of each non-comment, non-blank line).
listed=()
while read -r entry _; do
  [[ -z $entry || $entry == \#* ]] && continue
  listed+=("$entry")
  if [[ ! -f $DIR/$entry ]]; then
    echo "check-patch-series: series lists '$entry' but $DIR/$entry does not exist" >&2
    fail=1
  fi
done < "$SERIES"

# Every *.patch on disk must be listed.
for path in "$DIR"/*.patch; do
  name=$(basename "$path")
  found=0
  for entry in "${listed[@]}"; do
    [[ $entry == "$name" ]] && { found=1; break; }
  done
  if [[ $found -eq 0 ]]; then
    echo "check-patch-series: $name exists on disk but is missing from series" >&2
    fail=1
  fi
done

if [[ $fail -eq 0 ]]; then
  echo "check-patch-series: OK — ${#listed[@]} patches, series and disk match"
fi
exit $fail
