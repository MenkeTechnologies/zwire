#!/usr/bin/env bash
# Install the zwire HUD native-messaging host locally so the in-page 8-scheme
# picker can drive the native color mixer live. This is the extension's
# "localinstall": build the Rust native host (cargo build) if needed, then (a)
# rewrite the host manifest's `path` to THIS checkout's absolute zwire-host
# binary, and (b) drop that manifest into every Chrome-family browser's
# NativeMessagingHosts dir on this machine so the change is live now. Then it
# reminds you to load-unpacked.
set -euo pipefail
cd "$(dirname "$0")/.."
export APP_TITLE="ZWIRE HUD" APP_SUB="// the cyberpunk HUD extension"
source scripts/cyberpunk.sh

EXT_DIR="$(pwd)"
HOST_NAME="com.zwire.hud"
SRC_MANIFEST="native/${HOST_NAME}.json"
HOST_BIN="${EXT_DIR}/native/zwire-host/target/debug/zwire-host"

cyber_banner
cyber_status "OPERATION" "LOCALINSTALL // native messaging host"
echo

cyber_section "PRE-FLIGHT"
if [[ ! -f "$SRC_MANIFEST" ]]; then
  cyber_fail "missing $SRC_MANIFEST"
  exit 1
fi
# Build the Rust native host (debug — local dev never uses --release) if it
# isn't built yet, then pin the manifest at it.
if [[ ! -f "$HOST_BIN" ]]; then
  cyber_status "OPERATION" "cargo build // zwire-host"
  ( cd "${EXT_DIR}/native/zwire-host" && cargo build ) || { cyber_fail "cargo build (zwire-host) failed"; exit 1; }
fi
if [[ ! -f "$HOST_BIN" ]]; then
  cyber_fail "missing zwire-host binary at $HOST_BIN"
  exit 1
fi
cyber_ok "native host // $HOST_BIN"
echo

# Rewrite `path` to this checkout's zwire-host; keep name/description/type/allowed_origins.
cyber_section "BUILD MANIFEST"
GENERATED="$(python3 - "$SRC_MANIFEST" "$HOST_BIN" <<'PY'
import json, sys
src, host = sys.argv[1], sys.argv[2]
with open(src) as f:
    m = json.load(f)
m["path"] = host
print(json.dumps(m, indent=2))
PY
)"
cyber_ok "path pinned to this checkout"
echo

# Chrome-family NativeMessagingHosts dirs. macOS lives under Application Support;
# Linux under ~/.config. We install into every browser whose profile root exists,
# and always ensure Chrome + Chromium (create if absent).
cyber_section "DEPLOY"
if [[ "$(uname -s)" == "Darwin" ]]; then
  BASE="$HOME/Library/Application Support"
  ROOTS=(
    "$BASE/Google/Chrome"
    "$BASE/Chromium"
    "$BASE/BraveSoftware/Brave-Browser"
    "$BASE/Microsoft Edge"
    "$BASE/Vivaldi"
    "$BASE/zwire"
    "$BASE/Zwire"
  )
  ALWAYS=("$BASE/Google/Chrome" "$BASE/Chromium")
else
  BASE="$HOME/.config"
  ROOTS=(
    "$BASE/google-chrome"
    "$BASE/chromium"
    "$BASE/BraveSoftware/Brave-Browser"
    "$BASE/microsoft-edge"
    "$BASE/vivaldi"
    "$BASE/zwire"
  )
  ALWAYS=("$BASE/google-chrome" "$BASE/chromium")
fi

installed=0
declare -A seen=()
for root in "${ROOTS[@]}" "${ALWAYS[@]}"; do
  [[ -n "${seen[$root]:-}" ]] && continue
  seen[$root]=1
  force=0
  for a in "${ALWAYS[@]}"; do [[ "$root" == "$a" ]] && force=1; done
  if [[ -d "$root" || "$force" == "1" ]]; then
    dir="$root/NativeMessagingHosts"
    mkdir -p "$dir"
    printf '%s\n' "$GENERATED" > "$dir/${HOST_NAME}.json"
    cyber_ok "$(basename "$(dirname "$root")")/$(basename "$root") // $dir"
    installed=$((installed + 1))
  fi
done
echo
cyber_line

if [[ "$installed" == "0" ]]; then
  cyber_warn "no Chrome-family browser dirs found"
else
  cyber_ok "installed into $installed browser dir(s)"
fi
cyber_tagline "HOST LIVE. NOW LOAD THE EXTENSION."
echo -e "  ${D}Load unpacked:${N} chrome://extensions -> Developer mode -> Load unpacked"
echo -e "  ${D}Point it at:${N}   ${W}${EXT_DIR}${N}"
echo -e "  ${D}Note:${N} the host's allowed_origins pins specific extension IDs;"
echo -e "  ${D}     ${N} if your unpacked ID differs, add it to native/${HOST_NAME}.json and re-run."
echo
