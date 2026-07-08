#!/usr/bin/env bash
# rebrand-macos.sh — rebrand the downloaded base browser bundle in place so the
# Dock, ⌘-Tab switcher, and menu bar show "zwire" with the cyberpunk icon
# instead of "Chromium".
#
# The base bundle is ad-hoc signed. Patching Info.plist / Resources invalidates
# that signature, and macOS then ignores the icon + name changes and serves the
# cached original icon. So after patching we MUST re-sign ad-hoc and re-register
# the bundle with LaunchServices for the new icon to appear.
#
# This edits only the local base bundle under $ZWIRE_STATE/base — it never
# touches a system browser install. Re-run after fetch-base.sh upgrades the base.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
source "$ROOT/scripts/state-dir.sh"
STATE=${ZWIRE_STATE:-$(zwire_default_state)}
BASE_PATH_FILE=$STATE/base.path
ICON=$ROOT/branding/zwire.icns
NAME=zwire

[[ -f $BASE_PATH_FILE ]] || { echo "rebrand: no base installed — run fetch-base.sh" >&2; exit 1; }
BIN=$(cat "$BASE_PATH_FILE")
APP=${BIN%/Contents/MacOS/*}          # .../Chromium.app
PLIST=$APP/Contents/Info.plist
RES=$APP/Contents/Resources
[[ -f $PLIST ]] || { echo "rebrand: Info.plist not found at $PLIST" >&2; exit 1; }

pb() { /usr/libexec/PlistBuddy -c "$1" "$PLIST"; }
set_key() { pb "Set :$1 $2" 2>/dev/null || pb "Add :$1 string $2"; }

# Name shown in Dock / ⌘-Tab / menu bar.
set_key CFBundleName        "$NAME"
set_key CFBundleDisplayName "$NAME"

# Install the icon under a NEW filename and point the bundle at it, so we do not
# collide with the cached original icon association.
if [[ -f $ICON ]]; then
  cp "$ICON" "$RES/$NAME.icns"
  set_key CFBundleIconFile "$NAME"
  # Modern Chromium ships its icon as "AppIcon" in the compiled Assets.car and
  # references it via CFBundleIconName, which takes PRECEDENCE over the .icns in
  # CFBundleIconFile. Delete that key so macOS falls back to our zwire.icns.
  pb "Delete :CFBundleIconName" 2>/dev/null || true
fi

# TCC purpose strings. macOS SIGABRTs (does not merely deny) any process that
# reaches a privacy-gated capability with no matching NS*UsageDescription — the
# plain-Chromium snapshot ships none, so a page using Web Bluetooth / getUserMedia
# / Geolocation crashes the browser (TCC namespace abort). bin/zwire exec's THIS
# base bundle directly, so TCC reads this Info.plist; inject the strings before
# the re-sign below seals them. Keys mirror what a real Chromium browser carries.
set_key NSBluetoothAlwaysUsageDescription     "zwire lets sites you allow connect to nearby Bluetooth devices (Web Bluetooth)."
set_key NSBluetoothPeripheralUsageDescription "zwire lets sites you allow connect to nearby Bluetooth devices (Web Bluetooth)."
set_key NSCameraUsageDescription              "zwire lets sites you allow use the camera for video capture and calls."
set_key NSMicrophoneUsageDescription          "zwire lets sites you allow use the microphone for audio capture and calls."
set_key NSLocationWhenInUseUsageDescription   "zwire lets sites you allow access your location (Geolocation)."
set_key NSLocationUsageDescription            "zwire lets sites you allow access your location (Geolocation)."

# Re-seal the bundle: the top-level Info.plist/Resources changed, so re-sign
# ad-hoc (nested frameworks/helpers keep their own valid seals). Without this,
# macOS treats the icon/name change as tampering and reverts to the cache.
codesign --force --sign - "$APP" 2>/dev/null || \
  echo "rebrand: warning — ad-hoc re-sign failed; icon may not refresh" >&2

# Refresh the LaunchServices icon/name cache for this bundle.
LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
[[ -x $LSREGISTER ]] && "$LSREGISTER" -f "$APP" >/dev/null 2>&1 || true
touch "$APP"

echo "rebrand: $APP -> $NAME (re-signed + re-registered)" >&2
