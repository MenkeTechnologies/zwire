#!/usr/bin/env bash
# fork/build.sh — configure + compile the zbrowser Chromium fork.
#
#   fork/build.sh SRC [OUT]
#
# SRC is the Chromium src/ dir. OUT is the build subdir under src/out
# (default: zbrowser). First compile is 1–4 hours; incremental rebuilds after a
# patch are minutes. Uses fork/args.gn.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
SRC=${1:?usage: build.sh SRC [OUT]}
OUT=${2:-zbrowser}
DEPOT=${ZBROWSER_SRC:-$(dirname "$SRC")}/depot_tools

[[ -d $SRC ]] || { echo "build: no src dir at $SRC" >&2; exit 1; }
[[ -d $DEPOT ]] && export PATH="$DEPOT:$PATH"

OUTDIR=$SRC/out/$OUT
mkdir -p "$OUTDIR"
cp "$ROOT/fork/args.gn" "$OUTDIR/args.gn"

echo "build: gn gen out/$OUT" >&2
( cd "$SRC" && gn gen "out/$OUT" )

echo "build: autoninja chrome (this is the long one)" >&2
( cd "$SRC" && autoninja -C "out/$OUT" chrome )

echo "build: done -> $OUTDIR/Chromium.app" >&2
echo "build: next -> fork/package.sh $OUTDIR" >&2
