#!/usr/bin/env bash
# setup-native-host.sh — build the zwire-host native binary and install its
# Chrome native-messaging manifest into the profile, so the HUD terminal,
# system-stats stream, and colorscheme bridge work.
#
# Cross-platform (macOS + Linux + WSL): Chromium reads native-messaging host
# manifests from <user-data-dir>/NativeMessagingHosts/, so a profile-relative
# install is portable — no per-OS ~/Library vs ~/.config split needed.
#
# Idempotent + cheap: only compiles when the binary is missing (or FORCE=1),
# then (re)writes the manifest pointing at it. `bin/zwire` calls this on launch
# when the manifest is missing or dangling, so a dev run is self-sufficient on
# any platform without needing the full `localinstall`.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
STATE=${ZWIRE_STATE:-$HOME/.zwire}
PROFILE=$STATE/profile
HOST_DIR=$ROOT/extensions/hud-internal/native/zwire-host
BIN=${ZWIRE_HOST_BIN:-$HOST_DIR/target/release/zwire-host}

# Stable extension IDs (pinned via each manifest's "key").
HUD_ID=omcgnnjfmbmpdlofklbpddkhnfibfhgg
ZPWR_ID=hpppdchpnphmiijdeanibpcadgknmaja
NEWTAB_ID=gpoepnekoiplhkegjpocnpeijiefgieb

# Windows/WSL: the browser wants a .exe path; the host is cross-platform Rust.
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) [[ $BIN == *.exe ]] || BIN="$BIN.exe" ;;
esac

if [[ ! -x $BIN || ${FORCE:-0} == 1 ]]; then
  command -v cargo >/dev/null 2>&1 || {
    echo "setup-native-host: cargo not found — install Rust: https://rustup.rs" >&2
    exit 1
  }
  echo "setup-native-host: building zwire-host (release) …" >&2
  ( cd "$HOST_DIR" && cargo build --release ) >/dev/null 2>&1 || {
    echo "setup-native-host: cargo build --release failed" >&2
    exit 1
  }
fi

# Chromium checks both <profile>/NativeMessagingHosts and <profile>/Default/…
for d in "$PROFILE/NativeMessagingHosts" "$PROFILE/Default/NativeMessagingHosts"; do
  mkdir -p "$d"
  cat > "$d/com.zwire.hud.json" <<JSON
{
  "name": "com.zwire.hud",
  "description": "zwire HUD native host",
  "path": "$BIN",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$HUD_ID/",
    "chrome-extension://$ZPWR_ID/",
    "chrome-extension://$NEWTAB_ID/"
  ]
}
JSON
done

echo "setup-native-host: manifest -> $BIN" >&2
