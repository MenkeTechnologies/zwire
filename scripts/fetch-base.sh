#!/usr/bin/env bash
# fetch-base.sh — download the base browser for zwire.
#
# Uses a plain Chromium continuous-build snapshot (Google-hosted): a real
# Chromium/Blink build with NO "Google Chrome" product branding and NO "for
# automated testing" banner (that stripe is exclusive to Chrome for Testing).
# Unbranded Chromium also retains the --load-extension switch that preloads
# zpwrchrome (removed only from *branded* Chrome 137+).
#
#   scripts/fetch-base.sh [REVISION]
#
# REVISION defaults to the latest snapshot (LAST_CHANGE). The resolved binary
# path is written to $ZWIRE_STATE/base.path (read by bin/zwire); the
# revision is recorded in base.version for reproducibility.
set -euo pipefail

STATE=${ZWIRE_STATE:-$HOME/.zwire}
BASE_DIR=$STATE/base
mkdir -p "$BASE_DIR"

# Host platform -> Chromium snapshot platform id + zip layout.
os=$(uname -s); arch=$(uname -m)
case "$os/$arch" in
  Darwin/arm64)             PLAT=Mac_Arm;   ZIP=chrome-mac.zip;   SUBDIR=chrome-mac ;;
  Darwin/x86_64)            PLAT=Mac;       ZIP=chrome-mac.zip;   SUBDIR=chrome-mac ;;
  Linux/x86_64|Linux/amd64) PLAT=Linux_x64; ZIP=chrome-linux.zip; SUBDIR=chrome-linux ;;
  *) echo "fetch-base: unsupported platform $os/$arch" >&2; exit 1 ;;
esac

BASE_URL="https://storage.googleapis.com/chromium-browser-snapshots/${PLAT}"
REV=${1:-}
if [[ -z $REV ]]; then
  REV=$(curl -fsSL "${BASE_URL}/LAST_CHANGE")
fi
[[ -n $REV ]] || { echo "fetch-base: could not resolve revision" >&2; exit 1; }

URL="${BASE_URL}/${REV}/${ZIP}"
OUT=$STATE/${ZIP}

echo "fetch-base: downloading Chromium snapshot r${REV} (${PLAT})" >&2
curl -fSL --progress-bar "$URL" -o "$OUT"

rm -rf "${BASE_DIR:?}/${SUBDIR}"
unzip -q -o "$OUT" -d "$BASE_DIR"
rm -f "$OUT"

# Resolve the executable inside the extracted tree.
case "$os" in
  Darwin) BIN=$(find "$BASE_DIR/$SUBDIR" -type f -path '*Chromium.app/Contents/MacOS/*' -name 'Chromium' | head -1) ;;
  Linux)  BIN="$BASE_DIR/$SUBDIR/chrome" ;;
esac

[[ -n ${BIN:-} && -x $BIN ]] || { echo "fetch-base: binary not found after unzip" >&2; exit 1; }

printf '%s\n' "$BIN"  > "$STATE/base.path"
printf 'r%s\n' "$REV" > "$STATE/base.version"
echo "fetch-base: installed -> $BIN" >&2
