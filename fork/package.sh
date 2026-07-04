#!/usr/bin/env bash
# fork/package.sh — install the freshly built fork as the zbrowser base.
#
#   fork/package.sh OUTDIR
#
# OUTDIR is the build dir (…/src/out/zbrowser) holding Chromium.app. Copies it
# into $ZBROWSER_STATE/base, records base.path, then rebrands the bundle
# (Dock name + cyberpunk icon) via the shared scripts/rebrand-macos.sh.
#
# After this, bin/zbrowser launches the HUD-chromed fork with zpwrchrome + the
# cyberpunk theme/new-tab preloaded — same launcher, forked base.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
STATE=${ZBROWSER_STATE:-$HOME/.zbrowser}
OUTDIR=${1:?usage: package.sh OUTDIR}
BASE_DIR=$STATE/base

os=$(uname -s)
case "$os" in
  Darwin)
    APP=$(find "$OUTDIR" -maxdepth 1 -name 'Chromium.app' -type d | head -1)
    [[ -d $APP ]] || { echo "package: Chromium.app not found in $OUTDIR" >&2; exit 1; }
    mkdir -p "$BASE_DIR"
    rm -rf "$BASE_DIR/fork"
    cp -R "$APP" "$BASE_DIR/fork-Chromium.app"
    BIN="$BASE_DIR/fork-Chromium.app/Contents/MacOS/Chromium"
    ;;
  Linux)
    BIN_SRC="$OUTDIR/chrome"
    [[ -x $BIN_SRC ]] || { echo "package: chrome binary not found in $OUTDIR" >&2; exit 1; }
    mkdir -p "$BASE_DIR/fork-linux"
    cp -R "$OUTDIR"/* "$BASE_DIR/fork-linux/"
    BIN="$BASE_DIR/fork-linux/chrome"
    ;;
  *) echo "package: unsupported OS $os" >&2; exit 1 ;;
esac

printf '%s\n' "$BIN" > "$STATE/base.path"
printf 'fork-%s\n' "$(cat "$ROOT/fork/CHROMIUM_VERSION")" > "$STATE/base.version"
echo "package: base -> $BIN" >&2

# Rebrand the bundle (macOS: name + icon + re-sign).
[[ $os == Darwin ]] && "$ROOT/scripts/rebrand-macos.sh" || true
echo "package: done — run \`zbrowser\`" >&2
