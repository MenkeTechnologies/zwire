#!/usr/bin/env bash
# Install zwire into /Applications as a SELF-CONTAINED .app.
#
# Unlike the old thin-wrapper install (which exec'd bin/zwire in this checkout),
# this bundles EVERYTHING the browser needs INTO /Applications/zwire.app:
#   Contents/Resources/browser/   the Chromium base bundle (the ~325MB browser)
#   Contents/Resources/ext/       newtab · zpwrchrome · hud-internal extensions
#   Contents/Resources/native/    zwire-host (Rust binary: scheme · sysinfo · PTY)
#                                 zpwrchrome-host (Rust binary: downloads · otp · search)
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
# Version comes out of package.json with perl, not python3: the JSON here is a
# flat manifest, and a perl one-liner has no interpreter-flavor dependency (a
# non-CPython python3 on PATH broke the release script mid-cut).
VERSION="$(perl -ne 'if (!$seen && /"version"\s*:\s*"([^"]+)"/) { print "$1\n"; $seen = 1 }' package.json)"
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
    # NOT a silent scripts/build.sh here: that fetches a STOCK Chromium snapshot,
    # and swapping the engine under the same product name is invisible in the
    # output — a fork base that had gone missing was replaced with stock
    # Chromium, packaged, and shipped as a zwire release. Say what is missing and
    # stop; the fork is rebuilt deliberately (fork/build.sh + fork/package.sh).
    cyber_fail "recorded base is gone: $BASE_APP"
    cyber_status "FIX" "fork/fetch.sh && fork/build.sh && fork/package.sh \$ZWIRE_SRC/out/<dir>   (patched engine)"
    cyber_status "OR" "scripts/fetch-base.sh   (stock Chromium — NOT the fork; no HUD chrome patches)"
    exit 1
  fi
fi
APP_DIRNAME="$(basename "$BASE_APP")"              # zbrowser.app
[[ -d "$BASE_APP" ]] || { cyber_fail "base bundle missing: $BASE_APP"; exit 1; }

# Is this the patched fork, or a stock snapshot? The fork's branding patch
# (0006) renames the bundle + executable to zwire and the framework carries the
# HUD scheme bridge; a stock snapshot is Chromium.app with neither. Packaging
# stock as "zwire" produces a browser with none of the 25 native patches — no
# HUD chrome, no native palette, no browser-wide audio EQ — that still looks
# right in Finder, so refuse it unless it was asked for explicitly.
# Globs, not `ls` — the bundle names contain a space ("zwire Framework"), and an
# unmatched glob just leaves BASE_FW_BIN empty, which is the case this check
# exists to report anyway.
BASE_FW_BIN=""
for _fw_ver in "$BASE_APP"/Contents/Frameworks/*.framework/Versions/*/; do
  for _fw_bin in "$_fw_ver"*Framework; do
    if [[ -f $_fw_bin ]]; then BASE_FW_BIN=$_fw_bin; break 2; fi
  done
done
# grep reads the binary directly (-a): piping `strings` into `grep -q` returns
# 141 under `set -o pipefail` — grep exits at the first match and strings dies on
# SIGPIPE — which read as "not the fork" for a base that IS the fork.
if [[ -f $BASE_FW_BIN ]] && LC_ALL=C grep -qa 'hud-scheme' "$BASE_FW_BIN" 2>/dev/null; then
  cyber_ok "base bundle // $BASE_APP  (fork build — native patches present)"
elif [[ ${ZWIRE_ALLOW_STOCK_BASE:-} == 1 ]]; then
  cyber_warn "base bundle // $BASE_APP  (STOCK Chromium — no fork patches; ZWIRE_ALLOW_STOCK_BASE=1)"
else
  cyber_fail "base bundle is NOT the patched fork: $BASE_APP"
  cyber_status "FIX" "fork/build.sh && fork/package.sh \$ZWIRE_SRC/out/<dir>   (build + install the fork base)"
  cyber_status "OR" "ZWIRE_ALLOW_STOCK_BASE=1 $0   (deliberately package stock Chromium)"
  exit 1
fi
echo

cyber_section "BUILD NATIVE HOST (rust)"
export PATH="$HOME/.cargo/bin:$PATH"
command -v cargo >/dev/null || { cyber_fail "cargo not found — install Rust (https://rustup.rs)"; exit 1; }
( cd extensions/hud-internal/native/zwire-host && cargo build --release ) >/dev/null 2>&1 \
  || { cyber_fail "native host build failed (cargo build --release)"; exit 1; }
HOST_BIN="$ROOT/extensions/hud-internal/native/zwire-host/target/release/zwire-host"
cyber_ok "host // zwire-host $(du -h "$HOST_BIN" | awk '{print $1}') (self-contained binary, no python)"

# zpwrchrome's own native host (BP protocol) — backs `dl.*` segmented downloads,
# otp, search, run.spawn. Bundled rather than taken from Homebrew: the brew keg's
# manifest hardcodes a versioned Cellar path that `brew upgrade` deletes, which
# silently drops every download back to the browser's built-in downloader.
( cd extensions/zpwrchrome/zpwrchrome-host && cargo build --release ) >/dev/null 2>&1 \
  || { cyber_fail "zpwrchrome host build failed (cargo build --release)"; exit 1; }
ZPWR_HOST_BIN="$ROOT/extensions/zpwrchrome/zpwrchrome-host/target/release/zpwrchrome-host"
cyber_ok "host // zpwrchrome-host $(du -h "$ZPWR_HOST_BIN" | awk '{print $1}') (downloads · otp · search)"
echo

cyber_section "BUILD SELF-CONTAINED .app"
# An existing /Applications/zwire.app installed from the .pkg is owned by root,
# so this `rm -rf` deletes what it can and then fails on the bundle directory —
# leaving NO working install behind while the script exits on the next write.
# Prove the destination is replaceable BEFORE destroying it: a writable parent
# is enough to swap the bundle, otherwise re-exec the whole install under sudo
# (and if sudo needs a password we can't supply, stop with the old app intact).
# The probe is a RENAME, never a delete: `mv` needs only a writable parent, is
# atomic, and leaves the old install fully intact if it fails. (`rm -rf` needs
# write on every directory INSIDE the bundle, which a root-owned .pkg install
# doesn't grant — it deletes what it can, fails, and leaves nothing behind.)
if [[ -e $DEST ]]; then
  OLD_BUNDLE="$DEST.replacing.$$"
  if ! mv "$DEST" "$OLD_BUNDLE" 2>/dev/null; then
    if [[ ${ZWIRE_INSTALL_ELEVATED:-} == 1 ]]; then
      cyber_fail "cannot replace $DEST even as root"; exit 1
    fi
    if sudo -n true 2>/dev/null; then
      cyber_status "ELEVATE" "$DEST is not writable — re-running the install with sudo"
      exec sudo -n env ZWIRE_INSTALL_ELEVATED=1 ZWIRE_DEST="$DEST" bash "$0" "$@"
    fi
    cyber_fail "$DEST belongs to another user (installed from the .pkg?) — rerun with: sudo $0"
    exit 1
  fi
  command rm -rf "$OLD_BUNDLE" 2>/dev/null || sudo -n rm -rf "$OLD_BUNDLE" 2>/dev/null || \
    cyber_warn "left the previous bundle at $OLD_BUNDLE (could not delete it)"
fi
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

# Stamp the extension manifest version too. Chrome keys MV3 service-worker updates on the
# manifest "version": if it never changes, a reinstall keeps the CACHED old service worker
# (host binary updates, background.js does not). Stamping it from package.json means every
# bumped release forces Chrome to reload the extension + refresh the worker.
MANIFEST_JSON="$RES/ext/hud-internal/manifest.json"
if [ -f "$MANIFEST_JSON" ]; then
  perl -i -pe "s/(\"version\"\s*:\s*)\"[^\"]*\"/\${1}\"$VERSION\"/ if \$. < 12" "$MANIFEST_JSON"
  cyber_ok "version // stamped extension manifest → v$VERSION"
fi

# Same worker-cache trap for the extensions that carry their OWN version
# (zpwrchrome, newtab): a submodule can ship a behaviour change without a
# release bump, and Chrome then keeps serving the cached service worker — the
# page JS is re-read from disk, so the UI gains callers for message kinds the
# stale worker has no handler for, and every one of them fails with "The
# message port closed before a response was received."
#
# Appending a content-derived 4th component makes the version follow the code:
# same files -> same version -> no needless reload, changed files -> new version
# -> Chrome re-registers the worker. Manifest versions allow 4 dot-separated
# integers of at most 65535, hence the modulo.
stamp_content_version() {
  local dir="$1" name="$2" manifest="$1/manifest.json"
  [ -f "$manifest" ] || return 0
  local base rev
  base="$(perl -ne 'if (!$seen && /"version"\s*:\s*"([^"]+)"/) { print "$1"; $seen = 1 }' "$manifest")"
  [ -n "$base" ] || return 0
  # Hash every file the browser actually loads; the manifest is excluded so the
  # stamp we are about to write cannot feed back into the next hash.
  rev="$(find "$dir" -type f ! -name manifest.json ! -path '*/_metadata/*' -exec shasum -a 256 {} + \
         | shasum -a 256 | cut -c1-8)"
  rev=$(( 0x$rev % 65536 ))
  # Keep at most 3 components from the extension's own version so the appended
  # component stays inside Chrome's 4-integer limit.
  base="$(printf '%s' "$base" | cut -d. -f1-3)"
  perl -i -pe "s/(\"version\"\s*:\s*)\"[^\"]*\"/\${1}\"$base.$rev\"/ if \$. < 12" "$manifest"
  cyber_ok "version // $name manifest → v$base.$rev (content-keyed, forces worker refresh)"
}
stamp_content_version "$RES/ext/zpwrchrome" "zpwrchrome"
stamp_content_version "$RES/ext/newtab" "newtab"

# …and the version stamp alone is NOT enough. Measured against this Chromium
# (150.0.7871.46) with `--load-extension`: after replacing background.js and
# bumping the manifest version, the browser served the NEW file over
# chrome-extension:// (197,490 bytes, new handlers present) while the worker it
# actually parsed was the OLD cached script (196,642 bytes, handlers absent) —
# across a full browser restart. Every message kind the new page JS sends but
# the cached worker has no handler for then fails with "The message port closed
# before a response was received."
#
# Service-worker registration is keyed on the worker's SCRIPT URL, so the staged
# manifest is pointed at a content-keyed shim that imports the real
# background.js. New code -> new filename -> new registration -> the worker and
# the pages are always the same build. background.js keeps its name, so nothing
# that references it by URL has to change.
stamp_service_worker() {
  local dir="$1" name="$2" manifest="$1/manifest.json"
  [ -f "$manifest" ] || return 0
  local worker isModule rev shim
  worker="$(perl -ne 'if (/"service_worker"\s*:\s*"([^"]+)"/) { print $1; exit }' "$manifest")"
  [ -n "$worker" ] || return 0
  # Re-stamping an already-shimmed manifest would chain shims; resolve back to
  # the real worker first.
  case "$worker" in *.sw-*.js) worker="background.js" ;; esac
  [ -f "$dir/$worker" ] || return 0
  find "$dir" -maxdepth 1 -name '*.sw-*.js' -delete
  rev="$(find "$dir" -type f ! -name manifest.json ! -path '*/_metadata/*' -exec shasum -a 256 {} + \
         | shasum -a 256 | cut -c1-12)"
  shim="background.sw-$rev.js"
  # A module worker imports; a classic one importScripts. Getting this wrong
  # breaks the extension outright, so it follows the manifest's own declaration.
  isModule="$(perl -0777 -ne 'print "yes" if /"background"\s*:\s*\{[^}]*"type"\s*:\s*"module"/s' "$manifest")"
  if [ "$isModule" = "yes" ]; then
    printf '// Generated at install: content-keyed worker URL so Chromium cannot\n// serve a cached worker from an older build. Real code: %s\nimport "./%s";\n' \
      "$worker" "$worker" > "$dir/$shim"
  else
    printf '// Generated at install: content-keyed worker URL so Chromium cannot\n// serve a cached worker from an older build. Real code: %s\nimportScripts("./%s");\n' \
      "$worker" "$worker" > "$dir/$shim"
  fi
  perl -i -pe "s/(\"service_worker\"\s*:\s*)\"[^\"]*\"/\${1}\"$shim\"/" "$manifest"
  cyber_ok "worker // $name -> $shim (content-keyed; defeats the cached-worker trap)"
}
stamp_service_worker "$RES/ext/zpwrchrome" "zpwrchrome"
stamp_service_worker "$RES/ext/hud-internal" "hud-internal"
stamp_service_worker "$RES/ext/newtab" "newtab"

# 3) the native hosts — self-contained Rust binaries (no python/psutil)
cp "$HOST_BIN" "$RES/native/zwire-host"
chmod +x "$RES/native/zwire-host"
cyber_ok "native // zwire-host (rust binary)"
cp "$ZPWR_HOST_BIN" "$RES/native/zpwrchrome-host"
chmod +x "$RES/native/zpwrchrome-host"
cyber_ok "native // zpwrchrome-host (rust binary)"

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

# 3c) the stryke-app package (the `App` module for GUI automation / App::open) — staged next to
#     zwire-host so the host's ensure_stryke_app() extracts it into the stryke store on first run.
#     Result: `use App` works with NO user install of stryke-app (and no system stryke). MIT, like
#     zwire. Build the cdylib fresh from the meta-level sibling checkout; best-effort (skipped with a
#     warning if the source or a Rust toolchain is absent — Hooks still run, `use App` just won't).
STRYKE_APP_SRC="$ROOT/../stryke-app"
if [[ -f "$STRYKE_APP_SRC/lib/App.stk" ]]; then
  ( cd "$STRYKE_APP_SRC" && cargo build --release ) >/dev/null 2>&1 || true
  mkdir -p "$RES/native/stryke-app/lib"
  cp "$STRYKE_APP_SRC/stryke.toml" "$RES/native/stryke-app/" 2>/dev/null || true
  cp "$STRYKE_APP_SRC/lib/App.stk" "$RES/native/stryke-app/lib/" 2>/dev/null || true
  _staged_dylib=""
  for dyl in "$STRYKE_APP_SRC/target/release/libstryke_app.dylib" \
             "$STRYKE_APP_SRC/target/release/libstryke_app.so"; do
    [[ -f "$dyl" ]] && cp "$dyl" "$RES/native/stryke-app/lib/" && _staged_dylib="$dyl"
  done
  if [[ -n "$_staged_dylib" && -f "$RES/native/stryke-app/lib/App.stk" ]]; then
    cyber_ok "native // stryke-app (App package for GUI scripts) ← $STRYKE_APP_SRC"
  else
    cyber_warn "stryke-app cdylib not built — App package incomplete (need a Rust toolchain)"
  fi
else
  cyber_warn "stryke-app source not found at $STRYKE_APP_SRC — GUI-script App package skipped"
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
# zpwrchrome's BP host, pointed at the BUNDLED binary. Rewritten on every launch
# so a Homebrew-written manifest (which pins a versioned Cellar path that
# `brew upgrade` deletes) can never leave zwire's downloads without a host.
read -r -d '' ZPWRHOSTJSON <<JSON || true
{
  "name": "com.menketechnologies.zpwrchrome",
  "description": "zpwrchrome native host (BP protocol)",
  "path": "$RES/native/zpwrchrome-host",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://hpppdchpnphmiijdeanibpcadgknmaja/"
  ]
}
JSON
printf '%s\n' "$ZPWRHOSTJSON" > "$PROFILE/NativeMessagingHosts/com.menketechnologies.zpwrchrome.json"
printf '%s\n' "$ZPWRHOSTJSON" > "$PROFILE/Default/NativeMessagingHosts/com.menketechnologies.zpwrchrome.json"
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
# Force the extension service worker to reload when the build changes. Chrome does NOT restart a
# registered MV3 service worker when unpacked --load-extension files change: content scripts
# re-inject per page, but the worker keeps running its OLD background.js. So service-worker fixes
# silently never take effect across a redeploy. Deleting the profile's Service Worker script cache
# (safe here — the launcher runs before Chrome starts; workers re-register from source) forces a
# fresh background.js eval. Gated on a version marker so it only happens on an actual version bump.
# NOTE: Chrome keeps the SW cache under the PROFILE subdir ($PROFILE/Default/Service Worker), NOT
# $PROFILE/Service Worker — deleting the latter (which never exists) is why SW fixes silently never
# took effect. Delete both to cover any profile layout.
SWVER="$(grep -m1 '"version"' "$USEREXT/hud-internal/manifest.json" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
if [ -n "$SWVER" ] && [ "$(cat "$STATE/.sw_version" 2>/dev/null)" != "$SWVER" ]; then
  rm -rf "$PROFILE/Default/Service Worker" "$PROFILE/Service Worker" 2>/dev/null || true
  printf '%s' "$SWVER" > "$STATE/.sw_version" 2>/dev/null || true
fi
LOAD="$USEREXT/newtab,$USEREXT/zpwrchrome,$USEREXT/hud-internal"
# Browser-wide audio EQ (fork patch 0022). Export the saved spec as
# ZWIRE_AUDIO_EQ BEFORE exec so ChromeContentBrowserClient forwards it to the
# sandboxed audio service as --zwire-audio-eq, which seeds the engine at process
# launch (SeedZwireEqFromLaunchArgs) — audio is shaped from the first sample.
# Without this the .app seeds unity/flat and the saved EQ only lands on the first
# live poll push (i.e. only after the user nudges a knob). Mirrors bin/zwire.
# Env override wins; empty/missing file = no export (engine defaults to unity).
if [[ -z "${ZWIRE_AUDIO_EQ:-}" && -f "$STATE/audio-eq" ]]; then
  EQ_SPEC="$(tr -d '\r\n' < "$STATE/audio-eq" 2>/dev/null || true)"
  [[ -n "$EQ_SPEC" ]] && export ZWIRE_AUDIO_EQ="$EQ_SPEC"
fi
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
