#!/usr/bin/env bash
# Install zwire into /Applications as a SELF-CONTAINED .app.
#
# Unlike the old thin-wrapper install (which exec'd bin/zwire in this checkout),
# this bundles EVERYTHING the browser needs INTO /Applications/zwire.app:
#   Contents/Resources/browser/   the Chromium base bundle (the ~325MB browser)
#   Contents/Resources/ext/       newtab · zpwrchrome · hud-internal extensions
#   Contents/Resources/native/    zwire-host (Rust binary: scheme · sysinfo · PTY)
#   Contents/MacOS/zwire          a bundle-relative launcher
# So you can delete this repo (and ~/.zwire/base) and the app still runs — with
# NO system dependencies (the native host is a self-contained Rust binary, not
# python/psutil). The only thing kept outside is the user PROFILE
# (~/.zwire/profile) — user data, like any app's ~/Library, not part of the app.
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
DEST="/Applications/zwire.app"
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
STATE=${ZWIRE_STATE:-$HOME/.zwire}
if [[ ! -f "$STATE/base.path" ]]; then
  cyber_warn "no base browser yet — building …"
  bash scripts/build.sh >/dev/null || { cyber_fail "base build failed"; exit 1; }
fi
BASE_BIN="$(cat "$STATE/base.path")"
BASE_APP="${BASE_BIN%/Contents/MacOS/*}"          # …/zbrowser.app
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

# 2) the extensions (skip node_modules/.git/tests to stay lean)
for ext in newtab extensions/zpwrchrome extensions/hud-internal; do
  name="$(basename "$ext")"
  rsync -a --exclude 'node_modules' --exclude '.git' --exclude 'tests' --exclude 'target' "$ROOT/$ext/" "$RES/ext/$name/"
  cyber_ok "ext // $name"
done

# 3) the native host — a single self-contained Rust binary (no python/psutil)
cp "$HOST_BIN" "$RES/native/zwire-host"
chmod +x "$RES/native/zwire-host"
cyber_ok "native // zwire-host (rust binary)"

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
STATE="${ZWIRE_STATE:-$HOME/.zwire}"
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
LOAD="$RES/ext/newtab,$RES/ext/zpwrchrome,$RES/ext/hud-internal"
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
</dict>
</plist>
EOF
cyber_ok "Info.plist // v${VERSION}"
echo

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
