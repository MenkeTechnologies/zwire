#!/usr/bin/env bash
# Install zwire into /Applications as a SELF-CONTAINED .app.
#
# Unlike the old thin-wrapper install (which exec'd bin/zwire in this checkout),
# this bundles EVERYTHING the browser needs INTO /Applications/zwire.app:
#   Contents/Resources/browser/   the Chromium base bundle (the ~325MB browser)
#   Contents/Resources/ext/       newtab · zpwrchrome · hud-internal extensions
#   Contents/Resources/native/    zwire-host (Rust binary: scheme · sysinfo · PTY)
#                                  + stryke (Hooks sidecar: runner + --lsp)
#   Contents/MacOS/zwire          a bundle-relative launcher
# So you can delete this repo (and the base snapshot) and the app still runs —
# with NO system dependencies (the native host is a self-contained Rust binary,
# not python/psutil). Kept outside the bundle are the per-user PROFILE
# (<app-data>/zwire/profile) and a per-user copy of the extensions (staged
# from the bundle at launch so each user owns a writable copy — Chromium writes
# each extension's indexed rulesets into <ext>/_metadata/, which a shared
# /Applications bundle can't provide) — user data, like any app's ~/Library.
#
# Requires the Rust toolchain at build time (cargo). macOS .app here; the host
# binary itself is cross-platform (sysinfo + portable-pty) for a future Linux/Win port.
set -euo pipefail
cd "$(dirname "$0")/.."
export APP_TITLE="ZWIRE" APP_SUB="// self-contained .app"
source scripts/cyberpunk.sh

ROOT="$(pwd)"
ICON="$ROOT/branding/zwire.icns"
VERSION="$(python3 -c 'import json;print(json.load(open("package.json"))["version"])')"
DEST="${ZWIRE_DEST:-/Applications/zwire.app}"
RES="$DEST/Contents/Resources"

cyber_banner
cyber_status "OPERATION" "LOCALINSTALL // self-contained deploy to /Applications"
echo

cyber_section "PRE-FLIGHT"
# Cross-platform dispatch: this script builds a macOS .app; Linux has its own
# self-contained installer (~/.local/opt/zwire + .desktop). Same idea, different
# packaging. The native host (zwire-host) is one cross-platform Rust binary.
case "$(uname -s)" in
  Darwin) : ;;
  Linux)  exec bash "$ROOT/scripts/localinstall-linux.sh" "$@" ;;
  MINGW*|MSYS*|CYGWIN*)
    # Windows native-messaging is registry-based + shortcuts are .lnk, so the
    # Windows installer is PowerShell, not bash. Point the user at it.
    cyber_warn "Windows install is PowerShell — run it from PowerShell:"
    cyber_status "RUN" "powershell -ExecutionPolicy Bypass -File scripts\\localinstall-windows.ps1"
    exit 0 ;;
  *) cyber_fail "unsupported OS $(uname -s) — packaged: macOS (.app), Linux (~/.local), Windows (.ps1)"; exit 1 ;;
esac
source scripts/state-dir.sh
STATE=${ZWIRE_STATE:-$(zwire_default_state)}
if [[ ! -f "$STATE/base.path" ]]; then
  cyber_warn "no base browser yet — building …"
  bash scripts/build.sh >/dev/null || { cyber_fail "base build failed"; exit 1; }
fi
BASE_BIN="$(cat "$STATE/base.path")"
BASE_APP="${BASE_BIN%/Contents/MacOS/*}"          # …/zbrowser.app
# base.path stores an ABSOLUTE path; a state-dir migration (e.g. the bare `zwire`
# folder → the bundle-id `com.menketechnologies.zwire` dir) moves $STATE/base but
# leaves that recorded path pointing at the old, now-deleted location. The bundle
# always lives under $STATE/base/, so recover it there and rewrite the pointer
# before falling back to a full rebuild — no needless ~325MB refetch.
if [[ ! -d "$BASE_APP" ]]; then
  RECOVERED="$(ls -d "$STATE/base/"*.app 2>/dev/null | head -1 || true)"
  RECOVERED_BIN="$RECOVERED/Contents/MacOS/$(basename "${BASE_BIN}")"
  if [[ -n "$RECOVERED" && -x "$RECOVERED_BIN" ]]; then
    cyber_warn "recorded base moved — repointing to $RECOVERED"
    printf '%s\n' "$RECOVERED_BIN" > "$STATE/base.path"
    BASE_BIN="$RECOVERED_BIN"; BASE_APP="$RECOVERED"
  else
    cyber_warn "recorded base missing — rebuilding …"
    bash scripts/build.sh >/dev/null || { cyber_fail "base build failed"; exit 1; }
    BASE_BIN="$(cat "$STATE/base.path")"; BASE_APP="${BASE_BIN%/Contents/MacOS/*}"
  fi
fi
APP_DIRNAME="$(basename "$BASE_APP")"              # zbrowser.app
[[ -d "$BASE_APP" ]] || { cyber_fail "base bundle missing: $BASE_APP"; exit 1; }
cyber_ok "base bundle // $BASE_APP"
echo

cyber_section "BUILD NATIVE HOST (rust)"
export PATH="$HOME/.cargo/bin:$PATH"
command -v cargo >/dev/null || { cyber_fail "cargo not found — install Rust (https://rustup.rs)"; exit 1; }
( cd extensions/hud-internal/native/zwire-host && cargo build --release ) >/dev/null 2>&1 \
  || { cyber_fail "native host build failed (cargo build --release)"; exit 1; }
HOST_BIN="$ROOT/extensions/hud-internal/native/zwire-host/target/release/zwire-host"
cyber_ok "host // zwire-host $(du -h "$HOST_BIN" | awk '{print $1}') (self-contained binary, no python)"
echo

cyber_section "BUILD SELF-CONTAINED .app"
command rm -rf "$DEST"
mkdir -p "$DEST/Contents/MacOS" "$RES/browser" "$RES/ext" "$RES/native"

# 1) the browser bundle (biggest copy)
cyber_status "COPY" "browser bundle (~$(du -sh "$BASE_APP" | awk '{print $1}')) …"
cp -R "$BASE_APP" "$RES/browser/"
cyber_ok "browser -> Resources/browser/$APP_DIRNAME"

# 1b) Rebrand the NESTED browser bundle. It — not the outer wrapper — is the
# process macOS actually runs (the launcher exec's its binary), so the Dock,
# ⌘-Tab switcher, and notification icon come from ITS name/icon. The fork build
# ships as "zbrowser" with the stock Chromium icon; rename it to zwire and point
# it at our icns. (The About/Quit MENU ITEMS come from the compiled product name
# and still need a branded rebuild — this fixes everything the bundle controls.)
NESTED="$RES/browser/$APP_DIRNAME"; NPL="$NESTED/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleName zwire" "$NPL" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName zwire" "$NPL" 2>/dev/null || /usr/libexec/PlistBuddy -c "Add :CFBundleDisplayName string zwire" "$NPL" 2>/dev/null || true
if [[ -f "$ICON" ]]; then
  cp "$ICON" "$NESTED/Contents/Resources/zwire.icns"
  /usr/libexec/PlistBuddy -c "Set :CFBundleIconFile zwire" "$NPL" 2>/dev/null || /usr/libexec/PlistBuddy -c "Add :CFBundleIconFile string zwire" "$NPL"
  /usr/libexec/PlistBuddy -c "Delete :CFBundleIconName" "$NPL" 2>/dev/null || true
fi
# TCC purpose strings. macOS does not merely DENY a privacy-gated capability with
# no usage description — it SIGABRTs the whole process (TCC namespace abort). The
# plain-Chromium snapshot from fetch-base.sh ships ZERO NS*UsageDescription keys,
# so the first page that calls Web Bluetooth / getUserMedia / Geolocation kills
# the browser. Inject the strings into the NESTED bundle here (the launcher exec's
# its binary) — AND into the OUTER wrapper's Info.plist below, because macOS
# attributes TCC to the LAUNCHED (outer) app bundle: a Gmail passkey sign-in via
# Web Bluetooth SIGABRT'd even with the nested keys present until the outer had
# them too. Both must carry the full set. Set-or-Add stays idempotent on a
# re-copied base. (A real Chrome uses entitlements instead; ad-hoc zwire can't.)
nplist_set() { # $1 key  $2 purpose string
  /usr/libexec/PlistBuddy -c "Set :$1 $2" "$NPL" 2>/dev/null \
    || /usr/libexec/PlistBuddy -c "Add :$1 string $2" "$NPL" 2>/dev/null || true
}
nplist_set NSBluetoothAlwaysUsageDescription     "zwire lets sites you allow connect to nearby Bluetooth devices (Web Bluetooth)."
nplist_set NSBluetoothPeripheralUsageDescription "zwire lets sites you allow connect to nearby Bluetooth devices (Web Bluetooth)."
nplist_set NSCameraUsageDescription              "zwire lets sites you allow use the camera for video capture and calls."
nplist_set NSMicrophoneUsageDescription          "zwire lets sites you allow use the microphone for audio capture and calls."
nplist_set NSLocationWhenInUseUsageDescription   "zwire lets sites you allow access your location (Geolocation)."
nplist_set NSLocationUsageDescription            "zwire lets sites you allow access your location (Geolocation)."
nplist_set NSLocalNetworkUsageDescription        "zwire lets sites you allow reach devices on your local network (WebRTC, casting, local servers)."
# NSBonjourServices is an ARRAY — (re)build it idempotently so casting/mDNS works
# under macOS 15+ local-network privacy (mirrors Chrome's _googlecast._tcp).
/usr/libexec/PlistBuddy -c "Delete :NSBonjourServices" "$NPL" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :NSBonjourServices array" "$NPL" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :NSBonjourServices:0 string _googlecast._tcp" "$NPL" 2>/dev/null || true
codesign --force --sign - "$NESTED" >/dev/null 2>&1 || cyber_warn "nested rebrand re-sign failed"
cyber_ok "rebrand // nested browser -> zwire (name + icon + TCC purpose strings)"

# 2) the extensions (skip node_modules/.git/tests to stay lean; skip _metadata —
#    it's a dev-profile-specific compiled index Chromium regenerates per-user at
#    launch, so bundling it is dead weight that never gets loaded).
for ext in newtab extensions/zpwrchrome extensions/hud-internal; do
  name="$(basename "$ext")"
  rsync -a --exclude 'node_modules' --exclude '.git' --exclude 'tests' --exclude 'target' --exclude '_metadata' "$ROOT/$ext/" "$RES/ext/$name/"
  cyber_ok "ext // $name"
done

# Stamp the app version into the HUD System page. version.js hardcodes ZWIRE_VERSION
# (the extension can't read the .app CFBundleVersion at runtime); stamp the STAGED copy
# from package.json every build so the bundled System page can never drift from the release.
VER_JS="$RES/ext/hud-internal/pages/version.js"
if [ -f "$VER_JS" ]; then
  perl -i -pe "s/var ZWIRE_VERSION = '[^']*'/var ZWIRE_VERSION = '$VERSION'/" "$VER_JS"
  cyber_ok "version // stamped System page → v$VERSION"
fi

# 3) the native host — a single self-contained Rust binary (no python/psutil)
cp "$HOST_BIN" "$RES/native/zwire-host"
chmod +x "$RES/native/zwire-host"
cyber_ok "native // zwire-host (rust binary)"

# 3b) the stryke interpreter — sidecar for the Hooks feature (the script runner
#     + the `stryke --lsp` language server). Bundled next to zwire-host so the
#     host's resolve_stryke() finds it as a sibling, keeping the app
#     self-contained (no dependency on the user having stryke on PATH). Mirrors
#     the Tauri siblings' externalBin sidecar (prepare-stryke-sidecar.mjs), whose
#     bundle strips the host-triple suffix to a plain `stryke`. Same resolution
#     order; skipped with a warning if stryke can't be found (resolve_stryke()
#     then falls back to a system stryke on PATH), so the build never hard-fails.
STRYKE_SRC=""
for cand in "${ZWIRE_STRYKE:-}" "$(command -v stryke 2>/dev/null || true)" \
            "$HOME/.cargo/bin/stryke" /opt/homebrew/bin/stryke /usr/local/bin/stryke; do
  if [[ -n "$cand" && -x "$cand" ]]; then STRYKE_SRC="$cand"; break; fi
done
if [[ -n "$STRYKE_SRC" ]]; then
  cp "$STRYKE_SRC" "$RES/native/stryke"
  chmod +x "$RES/native/stryke"
  cyber_ok "native // stryke (Hooks sidecar: runner + --lsp) ← $STRYKE_SRC"
else
  cyber_warn "stryke not found — Hooks sidecar skipped (host falls back to a system stryke on PATH)"
fi

# 4) icon
[[ -f "$ICON" ]] && cp "$ICON" "$RES/zwire.icns" && cyber_ok "icon // zwire.icns"

# 5) bundle-relative launcher — resolves everything from inside the .app, installs
#    the native-host manifest into the profile (pointing at the bundled host), and
#    execs the bundled browser with the bundled extensions. Quoted heredoc keeps
#    every $var literal, resolved at RUNTIME by the launcher.
cat > "$DEST/Contents/MacOS/zwire" <<'LAUNCH'
#!/bin/bash
set -euo pipefail
RES="$(cd "$(dirname "$0")/../Resources" && pwd)"
# macOS app-data folder is the bundle id (matches CFBundleIdentifier + the
# convention that Application Support dirs are named by reverse-DNS id).
STATE="${ZWIRE_STATE:-$HOME/Library/Application Support/com.menketechnologies.zwire}"
# One-time migrations into the bundle-id dir: an earlier build kept state under
# the bare `zwire` folder, and older ones under ~/.zwire. Move whichever exists
# so an upgrade keeps the profile/base/scheme intact. No-op once migrated (or
# when ZWIRE_STATE is set).
if [[ -z "${ZWIRE_STATE:-}" && ! -e "$STATE" ]]; then
  LEGACY_APPDATA="$HOME/Library/Application Support/zwire"
  if [[ -d "$LEGACY_APPDATA" ]]; then
    mv "$LEGACY_APPDATA" "$STATE" 2>/dev/null || true
  elif [[ -d "$HOME/.zwire" ]]; then
    mv "$HOME/.zwire" "$STATE" 2>/dev/null || true
  fi
fi
PROFILE="$STATE/profile"
mkdir -p "$PROFILE/NativeMessagingHosts" "$PROFILE/Default/NativeMessagingHosts"
read -r -d '' HOSTJSON <<JSON || true
{
  "name": "com.zwire.hud",
  "description": "zwire HUD native host",
  "path": "$RES/native/zwire-host",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://omcgnnjfmbmpdlofklbpddkhnfibfhgg/",
    "chrome-extension://hpppdchpnphmiijdeanibpcadgknmaja/",
    "chrome-extension://gpoepnekoiplhkegjpocnpeijiefgieb/"
  ]
}
JSON
printf '%s\n' "$HOSTJSON" > "$PROFILE/NativeMessagingHosts/com.zwire.hud.json"
printf '%s\n' "$HOSTJSON" > "$PROFILE/Default/NativeMessagingHosts/com.zwire.hud.json"
BROWSER_APP="$(ls -d "$RES/browser/"*.app | head -1)"
EXE="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$BROWSER_APP/Contents/Info.plist")"
# Per-user extension copy. Chromium writes each unpacked extension's compiled
# declarativeNetRequest ruleset + content hashes into <ext>/_metadata/, so the
# browser needs WRITE access to the extension dir. The /Applications bundle has a
# single owner (whoever ran localinstall), so a second user can't write into the
# shared ext tree and extension loads fail ("Internal error while parsing rules").
# Stage the bundled extensions into a per-user dir and load from there; --exclude
# _metadata keeps each user's generated index across launches (no needless
# re-index). Stable IDs come from the manifest "key", not the path, so native
# messaging + externally_connectable are unaffected by the relocation.
USEREXT="$STATE/ext"
mkdir -p "$USEREXT"
rsync -a --delete --exclude '_metadata' "$RES/ext/" "$USEREXT/"
LOAD="$USEREXT/newtab,$USEREXT/zpwrchrome,$USEREXT/hud-internal"
exec "$BROWSER_APP/Contents/MacOS/$EXE" \
  --user-data-dir="$PROFILE" \
  --load-extension="$LOAD" \
  --extensions-on-chrome-urls \
  --test-type \
  --no-first-run \
  --no-default-browser-check \
  --homepage="chrome://newtab" \
  --disable-features=NtpFooter \
  --enable-features=SplitViewHorizontal,SplitViewTabRestore \
  --restore-last-session \
  "$@"
LAUNCH
chmod +x "$DEST/Contents/MacOS/zwire"
cyber_ok "launcher // bundle-relative"

# 6) Info.plist + PkgInfo
printf 'APPL????' > "$DEST/Contents/PkgInfo"
cat > "$DEST/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>zwire</string>
  <key>CFBundleDisplayName</key><string>zwire</string>
  <key>CFBundleExecutable</key><string>zwire</string>
  <key>CFBundleIdentifier</key><string>com.menketechnologies.zwire</string>
  <key>CFBundleIconFile</key><string>zwire</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${VERSION}</string>
  <key>CFBundleVersion</key><string>${VERSION}</string>
  <key>LSMinimumSystemVersion</key><string>10.15</string>
  <key>NSHighResolutionCapable</key><true/>
  <!-- TCC purpose strings. macOS SIGABRTs the process (TCC namespace abort) when a
       privacy-gated web API is hit with no NS*UsageDescription. The launched app is
       THIS outer wrapper, so TCC reads THIS Info.plist (not just the nested browser
       bundle) — e.g. Gmail passkey sign-in uses Web Bluetooth (caBLE/hybrid). Keys
       must live here too, mirroring the nested-bundle injection above. -->
  <key>NSBluetoothAlwaysUsageDescription</key><string>zwire lets sites you allow connect to nearby Bluetooth devices (Web Bluetooth), including passkey sign-in across devices.</string>
  <key>NSBluetoothPeripheralUsageDescription</key><string>zwire lets sites you allow connect to nearby Bluetooth devices (Web Bluetooth), including passkey sign-in across devices.</string>
  <key>NSCameraUsageDescription</key><string>zwire lets sites you allow use the camera for video capture and calls.</string>
  <key>NSMicrophoneUsageDescription</key><string>zwire lets sites you allow use the microphone for audio capture and calls.</string>
  <key>NSLocationWhenInUseUsageDescription</key><string>zwire lets sites you allow access your location (Geolocation).</string>
  <key>NSLocationUsageDescription</key><string>zwire lets sites you allow access your location (Geolocation).</string>
  <!-- Local network (macOS 15+/Sequoia local-network privacy): WebRTC to local peers,
       casting, and local dev servers need this. NSBonjourServices declares the mDNS
       service types the app browses (mirrors Chrome's _googlecast._tcp for Cast). -->
  <key>NSLocalNetworkUsageDescription</key><string>zwire lets sites you allow reach devices on your local network (WebRTC, casting, local servers).</string>
  <key>NSBonjourServices</key>
  <array>
    <string>_googlecast._tcp</string>
  </array>
</dict>
</plist>
EOF
cyber_ok "Info.plist // v${VERSION}"
echo

# Run-as-any-user: the .app lives in a shared /Applications but a SECOND user
# must be able to read + execute every embedded file (the browser bundle, its
# helpers, the native host, the extensions). rsync/cp can carry over restrictive
# source modes (e.g. the extensions' `_metadata` dirs were drwx------), which
# silently break a non-owner launch. Normalize: a+rX = world-read for files,
# world-traverse for dirs, world-exec for anything already executable. Done
# BEFORE codesign so the signature covers the final modes.
chmod -R a+rX "$DEST"
cyber_ok "perms // world-readable (runs as any user)"

cyber_section "SEAL + REGISTER"
codesign --force --sign - "$DEST" 2>/dev/null && cyber_ok "ad-hoc signed" \
  || cyber_warn "ad-hoc sign failed (icon may lag)"
LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
[[ -x "$LSREGISTER" ]] && "$LSREGISTER" -f "$DEST" >/dev/null 2>&1 && cyber_ok "LaunchServices registered" || true
touch "$DEST"
echo
cyber_line
SIZE=$(du -sh "$DEST" | awk '{print $1}')
cyber_ok "installed // ${SIZE} // $DEST  (self-contained — repo can be deleted)"
cyber_tagline "ZWIRE DEPLOYED. LAUNCH FROM /Applications."
