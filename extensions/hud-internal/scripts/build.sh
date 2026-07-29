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
# lib/hooks-editor/, which pages/{hooks,commands,triggers}.html load to get
# window.HooksEditor. This used to be "skipped cleanly when the devDeps aren't
# installed" — and that is exactly how the zip shipped with no editor at all: the
# pages 404 on a gitignored artifact that was never built, and each page only mounts
# an editor `if (window.HooksEditor)`, so the panes come up EMPTY with no error.
# build-hooks-editor.sh installs the devDeps itself and verifies every artifact, so
# there is nothing left to skip — a failure here is fatal to the package.
HE_OUT="$(scripts/build-hooks-editor.sh 2>/dev/null)" \
  || { cyber_fail "hooks editor bundle failed — run scripts/build-hooks-editor.sh to see why"; exit 1; }
cyber_ok "hooks editor // $(printf '%s\n' "$HE_OUT" | awk -F': ' '{printf "%s%s", (NR>1?" + ":""), $2}') bundle + 2 workers"

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
