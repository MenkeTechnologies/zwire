#!/usr/bin/env bash
# localinstall-linux.sh — Linux self-contained install of zwire, mirroring the
# macOS .app localinstall. Assembles everything the browser needs under
#   ~/.local/opt/zwire/   browser + newtab/zpwrchrome/hud-internal + zwire-host + stryke
# plus a `zwire` launcher on PATH and a .desktop entry (app menu + icon). No
# root required (user install under ~/.local). Delete the repo afterward and the
# install still runs — the native host is a self-contained cross-platform Rust
# binary. Only the user PROFILE (<app-data>/zwire/profile) lives outside the install.
#
# Dispatched from scripts/localinstall.sh on Linux. Needs the Rust toolchain
# (cargo) at build time; runs a plain Chromium snapshot fetched by fetch-base.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
export APP_TITLE="ZWIRE" APP_SUB="// self-contained linux install"
source scripts/cyberpunk.sh
source scripts/state-dir.sh

STATE=${ZWIRE_STATE:-$(zwire_default_state)}
PREFIX=${ZWIRE_PREFIX:-$HOME/.local}
DEST=$PREFIX/opt/zwire
BINLINK=$PREFIX/bin/zwire
DESKTOP=$PREFIX/share/applications/zwire.desktop
ICON_SRC=$ROOT/branding/icon-1024.png
ICON_DEST=$PREFIX/share/icons/hicolor/512x512/apps/zwire.png

# Stable extension IDs (pinned via each manifest "key").
HUD_ID=omcgnnjfmbmpdlofklbpddkhnfibfhgg
ZPWR_ID=hpppdchpnphmiijdeanibpcadgknmaja
NEWTAB_ID=gpoepnekoiplhkegjpocnpeijiefgieb

cyber_banner
cyber_status "OPERATION" "LOCALINSTALL // self-contained deploy to $DEST"
echo

cyber_section "PRE-FLIGHT"
if [[ ! -f "$STATE/base.path" ]]; then
  cyber_warn "no base browser yet — fetching …"
  scripts/fetch-base.sh >/dev/null || { cyber_fail "base fetch failed"; exit 1; }
fi
BASE_BIN="$(cat "$STATE/base.path")"          # …/chrome-linux/chrome
BASE_DIR="$(dirname "$BASE_BIN")"             # …/chrome-linux
[[ -x "$BASE_BIN" ]] || { cyber_fail "base binary missing: $BASE_BIN"; exit 1; }
cyber_ok "base browser // $BASE_DIR"
echo

cyber_section "BUILD NATIVE HOST (rust)"
export PATH="$HOME/.cargo/bin:$PATH"
command -v cargo >/dev/null || { cyber_fail "cargo not found — install Rust (https://rustup.rs)"; exit 1; }
( cd extensions/hud-internal/native/zwire-host && cargo build --release ) >/dev/null 2>&1 \
  || { cyber_fail "native host build failed (cargo build --release)"; exit 1; }
HOST_BIN="$ROOT/extensions/hud-internal/native/zwire-host/target/release/zwire-host"
cyber_ok "host // zwire-host $(du -h "$HOST_BIN" | awk '{print $1}') (self-contained binary, no python)"
echo

cyber_section "BUILD SELF-CONTAINED INSTALL"
command rm -rf "$DEST"
mkdir -p "$DEST/browser" "$DEST/ext" "$DEST/native"

# 1) the browser snapshot (whole chrome-linux tree: binary + paks + locales + libs)
cyber_status "COPY" "browser ($(du -sh "$BASE_DIR" | awk '{print $1}')) …"
cp -a "$BASE_DIR/." "$DEST/browser/"
cyber_ok "browser -> $DEST/browser"

# 2) the extensions (skip node_modules/.git/tests/target to stay lean)
for ext in newtab extensions/zpwrchrome extensions/hud-internal; do
  name="$(basename "$ext")"
  rsync -a --exclude 'node_modules' --exclude '.git' --exclude 'tests' --exclude 'target' \
    "$ROOT/$ext/" "$DEST/ext/$name/"
  cyber_ok "ext // $name"
done

# 3) the native host — one self-contained Rust binary
cp "$HOST_BIN" "$DEST/native/zwire-host"; chmod +x "$DEST/native/zwire-host"
cyber_ok "native // zwire-host"

# 3b) stryke sidecar for the Hooks feature (runner + `stryke --lsp`), bundled
#     next to zwire-host so resolve_stryke() finds it as a sibling. Skipped with
#     a warning if absent (host falls back to a system stryke on PATH).
STRYKE_SRC=""
for cand in "${ZWIRE_STRYKE:-}" "$(command -v stryke 2>/dev/null || true)" \
            "$HOME/.cargo/bin/stryke" /usr/local/bin/stryke /usr/bin/stryke; do
  if [[ -n "$cand" && -x "$cand" ]]; then STRYKE_SRC="$cand"; break; fi
done
if [[ -n "$STRYKE_SRC" ]]; then
  cp "$STRYKE_SRC" "$DEST/native/stryke"; chmod +x "$DEST/native/stryke"
  cyber_ok "native // stryke (Hooks sidecar) ← $STRYKE_SRC"
else
  cyber_warn "stryke not found — Hooks sidecar skipped (host falls back to system stryke on PATH)"
fi

# 4) install-relative launcher: installs the native-host manifest into the
#    profile (pointing at the bundled host) then execs the bundled browser.
#    Quoted heredoc keeps $vars literal, resolved at RUNTIME by the launcher.
cat > "$DEST/zwire" <<'LAUNCH'
#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
STATE="${ZWIRE_STATE:-${XDG_CONFIG_HOME:-$HOME/.config}/zwire}"
PROFILE="$STATE/profile"
for d in "$PROFILE/NativeMessagingHosts" "$PROFILE/Default/NativeMessagingHosts"; do
  mkdir -p "$d"
  cat > "$d/com.zwire.hud.json" <<JSON
{
  "name": "com.zwire.hud",
  "description": "zwire HUD native host",
  "path": "$HERE/native/zwire-host",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://__HUD_ID__/",
    "chrome-extension://__ZPWR_ID__/",
    "chrome-extension://__NEWTAB_ID__/"
  ]
}
JSON
done
exec "$HERE/browser/chrome" \
  --user-data-dir="$PROFILE" \
  --load-extension="$HERE/ext/newtab,$HERE/ext/zpwrchrome,$HERE/ext/hud-internal" \
  --extensions-on-chrome-urls \
  --test-type \
  --no-sandbox \
  --no-first-run \
  --no-default-browser-check \
  --homepage="chrome://newtab" \
  --disable-features=NtpFooter \
  --enable-features=SplitViewHorizontal,SplitViewTabRestore \
  "$@"
LAUNCH
# bake the (build-time-known) extension IDs into the launcher
sed -i "s/__HUD_ID__/$HUD_ID/; s/__ZPWR_ID__/$ZPWR_ID/; s/__NEWTAB_ID__/$NEWTAB_ID/" "$DEST/zwire"
chmod +x "$DEST/zwire"
cyber_ok "launcher // install-relative"

# 5) PATH symlink
mkdir -p "$(dirname "$BINLINK")"
ln -sf "$DEST/zwire" "$BINLINK"
cyber_ok "bin // $BINLINK -> zwire"

# 6) icon + .desktop (app menu integration)
mkdir -p "$(dirname "$ICON_DEST")" "$(dirname "$DESKTOP")"
[[ -f "$ICON_SRC" ]] && cp "$ICON_SRC" "$ICON_DEST" && cyber_ok "icon // $ICON_DEST"
cat > "$DESKTOP" <<EOF
[Desktop Entry]
Type=Application
Name=zwire
GenericName=Web Browser
Comment=Chromium superset with the zwire cyberpunk HUD
Exec=$DEST/zwire %U
Icon=$ICON_DEST
Terminal=false
StartupNotify=true
StartupWMClass=chrome
Categories=Network;WebBrowser;
MimeType=text/html;text/xml;application/xhtml+xml;x-scheme-handler/http;x-scheme-handler/https;
EOF
update-desktop-database "$(dirname "$DESKTOP")" >/dev/null 2>&1 || true
gtk-update-icon-cache "$PREFIX/share/icons/hicolor" >/dev/null 2>&1 || true
cyber_ok "desktop // $DESKTOP"
echo

cyber_line
SIZE=$(du -sh "$DEST" | awk '{print $1}')
cyber_ok "installed // ${SIZE} // $DEST  (self-contained — repo can be deleted)"
case ":$PATH:" in
  *":$(dirname "$BINLINK"):"*) cyber_tagline "ZWIRE DEPLOYED. RUN: zwire" ;;
  *) cyber_warn "$(dirname "$BINLINK") is not on PATH — add it, or run $DEST/zwire"
     cyber_tagline "ZWIRE DEPLOYED. RUN: $DEST/zwire" ;;
esac
