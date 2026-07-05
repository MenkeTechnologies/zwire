#!/usr/bin/env bash
# fork/package.sh — install the freshly built fork as the zwire base.
#
#   fork/package.sh OUTDIR
#
# OUTDIR is the build dir (…/src/out/zwire) holding Chromium.app. Copies it
# into $ZWIRE_STATE/base, records base.path, then rebrands the bundle
# (Dock name + cyberpunk icon) via the shared scripts/rebrand-macos.sh.
#
# After this, bin/zwire launches the HUD-chromed fork with zpwrchrome + the
# cyberpunk theme/new-tab preloaded — same launcher, forked base.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
STATE=${ZWIRE_STATE:-$HOME/.zwire}
OUTDIR=${1:?usage: package.sh OUTDIR}
BASE_DIR=$STATE/base

os=$(uname -s)
case "$os" in
  Darwin)
    # The 0006 branding patch renames the bundle to zwire.app (and its
    # executable to `zwire`); an unbranded build yields Chromium.app. Match
    # whichever main bundle exists, excluding the Helper bundles.
    APP=$(find "$OUTDIR" -maxdepth 1 -name '*.app' -type d ! -name '*Helper*' | head -1)
    [[ -d $APP ]] || { echo "package: no app bundle found in $OUTDIR" >&2; exit 1; }
    APP_NAME=$(basename "$APP")                       # zwire.app | Chromium.app
    # Derive the real executable name from the bundle instead of hardcoding it.
    EXE=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$APP/Contents/Info.plist")
    mkdir -p "$BASE_DIR"
    # Install under the bundle's own name (zwire.app) — no "fork-" prefix, so
    # Finder / Dock / ⌘-Tab all read "zwire". base.version records the fork.
    rm -rf "${BASE_DIR:?}"/fork-*.app "${BASE_DIR:?}/$APP_NAME"
    cp -R "$APP" "$BASE_DIR/$APP_NAME"
    BIN="$BASE_DIR/$APP_NAME/Contents/MacOS/$EXE"
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
echo "package: done — run \`zwire\`" >&2
