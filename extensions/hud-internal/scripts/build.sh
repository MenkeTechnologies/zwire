#!/usr/bin/env bash
# Package the unpacked extension into a distributable .zip under dist/. There is
# no transpile step — the "build" is a clean zip of the shipping files (source,
# pages, native host, and the vendored zgui-core), excluding VCS + dev cruft.
set -euo pipefail
cd "$(dirname "$0")/.."
export APP_TITLE="ZWIRE HUD" APP_SUB="// the cyberpunk HUD extension"
source scripts/cyberpunk.sh

VERSION="$(python3 -c 'import json;print(json.load(open("manifest.json"))["version"])')"
OUT="dist/zwire-hud-internal-${VERSION}.zip"

cyber_banner
cyber_status "OPERATION" "BUILD // package v${VERSION}"
echo

cyber_section "HOOKS EDITOR"
# (Re)build the vendored stryke Hooks editor bundle (Monaco + vim/emacs) into
# lib/hooks-editor/ so pages/hooks.html ships a fresh artifact. Skipped cleanly
# when the monaco/esbuild devDeps aren't installed (source-only checkout).
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if command -v node >/dev/null && [[ -d "$ROOT/node_modules/monaco-editor" && -f "$ROOT/vendor/zpwr-hooks-editor/scripts/build-hooks-editor.mjs" ]]; then
  ( cd "$ROOT" && HOOKS_EDITOR_OUT="$ROOT/lib/hooks-editor" node vendor/zpwr-hooks-editor/scripts/build-hooks-editor.mjs ) \
    && cyber_ok "hooks editor bundled" || cyber_fail "hooks editor build failed (non-fatal)"
else
  cyber_ok "hooks editor: skipped (deps absent) — run 'pnpm install' to bundle"
fi

cyber_section "PACKAGE"
mkdir -p dist
command rm -f "$OUT"
START=$(date +%s)
# Zip the extension root, excluding the package/tooling files and VCS metadata.
zip -r -q "$OUT" . \
  -x 'dist/*' 'scripts/*' 'package.json' 'node_modules/*' \
     '.git/*' '.git' '.gitignore' '*/.git/*' '.DS_Store' '*/.DS_Store'
ELAPSED=$(( $(date +%s) - START ))
echo

if [[ -f "$OUT" ]]; then
  SIZE=$(du -h "$OUT" | awk '{print $1}')
  cyber_ok "packaged in ${ELAPSED}s // ${SIZE} // ${OUT}"
  cyber_tagline "BUILD COMPLETE."
else
  cyber_fail "zip not produced"
  exit 1
fi
