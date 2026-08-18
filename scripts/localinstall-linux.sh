#!/usr/bin/env bash
# localinstall-linux.sh — Linux self-contained install of zwire, mirroring the
# macOS .app localinstall. Assembles everything the browser needs under
#   ~/.local/opt/zwire/   browser + newtab/zpwrchrome/hud-internal + zwire-host
#                         + zpwrchrome-host (downloads · otp · search) + stryke
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

# zpwrchrome's own native host (BP protocol) — backs `dl.*` segmented downloads,
# otp, search, run.spawn. Bundled so downloads never depend on a system-installed
# host manifest (a package upgrade that moves the binary silently drops every
# download back to the browser's built-in downloader).
( cd extensions/zpwrchrome/zpwrchrome-host && cargo build --release ) >/dev/null 2>&1 \
  || { cyber_fail "zpwrchrome host build failed (cargo build --release)"; exit 1; }
ZPWR_HOST_BIN="$ROOT/extensions/zpwrchrome/zpwrchrome-host/target/release/zpwrchrome-host"
cyber_ok "host // zpwrchrome-host $(du -h "$ZPWR_HOST_BIN" | awk '{print $1}') (downloads · otp · search)"
echo

cyber_section "BUILD HOOKS EDITOR (monaco)"
# lib/hooks-editor/ is a gitignored esbuild artifact, so a fresh clone (or a tree whose
# extensions/hud-internal/node_modules was cleaned) has NOTHING for the copy below to
# take — and the Hooks / Commands / Triggers pages then mount no editor at all, silently:
# they only build one `if (window.HooksEditor)`, which the dead <script src> never defines.
HE_OUT="$(scripts/build-hooks-editor.sh 2>/dev/null)" \
  || { cyber_fail "hooks-editor (monaco) bundle build failed — run scripts/build-hooks-editor.sh to see why"; exit 1; }
cyber_ok "monaco // $(printf '%s\n' "$HE_OUT" | awk -F': ' '{printf "%s%s", (NR>1?" + ":""), $2}') bundle + 2 workers"
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

# The Monaco bundle built above must have SURVIVED the copy — the pages 404 silently if not.
[ -s "$DEST/ext/hud-internal/lib/hooks-editor/hooks-editor.bundle.js" ] \
  || { cyber_fail "installed hud-internal is missing lib/hooks-editor/ — Hooks/Commands/Triggers would ship without Monaco"; exit 1; }

# Same trap for the git SUBMODULE libs: an uninitialised submodule is an EMPTY
# directory, so rsync copies it happily and the pages that import from it render
# blank with only a console 404. Guard the one entry point each page loads.
#   lib/file-browser  -> pages/files.js injects webui/file-browser.js
#   lib/clip-engine   -> pages/timeline.js imports webui/grid/index.js
# clip-engine carries its own NESTED zgui-core submodule at webui/lib/zgui-core, which a
# non-recursive `git submodule update --init` leaves empty, so guard that one too — the
# grid's browser-drawer.js imports ../lib/zgui-core/webui/esm/util.mjs from it.
for sub in "lib/file-browser/webui/file-browser.js" "lib/clip-engine/webui/grid/index.js" "lib/clip-engine/webui/lib/zgui-core/webui/esm/util.mjs"; do
  [ -s "$DEST/ext/hud-internal/$sub" ] \
    || { cyber_fail "installed hud-internal is missing $sub — run: git submodule update --init --recursive"; exit 1; }
done

# 3) the native host — one self-contained Rust binary
cp "$HOST_BIN" "$DEST/native/zwire-host"; chmod +x "$DEST/native/zwire-host"
cp "$ZPWR_HOST_BIN" "$DEST/native/zpwrchrome-host"; chmod +x "$DEST/native/zpwrchrome-host"
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
  # zpwrchrome's BP host, pointed at the BUNDLED binary. Rewritten on every
  # launch so a system-installed manifest can never leave downloads hostless.
  cat > "$d/com.menketechnologies.zpwrchrome.json" <<JSON
{
  "name": "com.menketechnologies.zpwrchrome",
  "description": "zpwrchrome native host (BP protocol)",
  "path": "$HERE/native/zpwrchrome-host",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://__ZPWR_ID__/"
  ]
}
JSON
done
# Browser-wide audio EQ (fork patch 0022) — export the saved spec so it is
# forwarded to the sandboxed audio service as --zwire-audio-eq and seeds the
# engine at launch (audio shaped from the first sample, not only after the first
# knob nudge). Env override wins; empty/missing file = unity default. See
# scripts/localinstall.sh / bin/zwire for the same block.
if [[ -z "${ZWIRE_AUDIO_EQ:-}" && -f "$STATE/audio-eq" ]]; then
  EQ_SPEC="$(tr -d '\r\n' < "$STATE/audio-eq" 2>/dev/null || true)"
  [[ -n "$EQ_SPEC" ]] && export ZWIRE_AUDIO_EQ="$EQ_SPEC"
fi
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
perl -i -pe "s/__HUD_ID__/$HUD_ID/; s/__ZPWR_ID__/$ZPWR_ID/; s/__NEWTAB_ID__/$NEWTAB_ID/" "$DEST/zwire"
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
