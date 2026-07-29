#!/usr/bin/env bash
# build-hooks-editor.sh — build the vendored Monaco hooks-editor bundle. THE single
# implementation; the repo-root scripts/build-hooks-editor.sh forwards here and every
# packaging path (scripts/localinstall*.sh, this extension's scripts/build.sh) calls it.
#
# pages/{hooks,commands,triggers}.html hard-depend on
#   lib/hooks-editor/hooks-editor.bundle.{js,css} + hooks-editor.worker.js
#                                                 + hooks-editor.ts.worker.js
# which define `window.HooksEditor`. That directory is a GITIGNORED build artifact
# produced from vendor/zpwr-hooks-editor/src by esbuild, so a fresh clone — or any tree
# whose node_modules was cleaned — has nothing to copy and every Monaco editor silently
# vanishes: hooks.js and the Commands step wizard only mount an editor
# `if (window.HooksEditor)`, so the mount is left EMPTY with no visible error. Nothing
# but a 404 in devtools distinguishes it from "the editor is gone".
#
# Callers hard-fail on a nonzero exit — shipping the pages with a dead <script src> is a
# release bug, not a warning.
#
# Idempotent: installs the monaco/esbuild devDeps only when absent, then rebuilds.
# Prints the artifact sizes on stdout; all diagnostics go to stderr.
set -euo pipefail
cd "$(dirname "$0")/.."
EXT="$(pwd)"

OUT="$EXT/lib/hooks-editor"
BUILDER="$EXT/vendor/zpwr-hooks-editor/scripts/build-hooks-editor.mjs"

[[ -f $BUILDER ]] || { echo "build-hooks-editor: builder missing: $BUILDER" >&2; exit 1; }
command -v node >/dev/null || { echo "build-hooks-editor: node not found (need >=20)" >&2; exit 1; }

# The builder resolves monaco-editor / monaco-vim / monaco-emacs from the CONSUMER's
# node_modules (shared-submodule build), so the devDeps must be installed right here.
if [[ ! -d $EXT/node_modules/monaco-editor || ! -d $EXT/node_modules/monaco-vim ]]; then
  command -v pnpm >/dev/null || { echo "build-hooks-editor: pnpm not found — needed for the monaco devDeps" >&2; exit 1; }
  ( cd "$EXT" && pnpm install ) >&2 \
    || { echo "build-hooks-editor: pnpm install failed in extensions/hud-internal" >&2; exit 1; }
fi

( cd "$EXT" && HOOKS_EDITOR_OUT="$OUT" node "$BUILDER" ) >&2 \
  || { echo "build-hooks-editor: esbuild bundle failed" >&2; exit 1; }

# Verify every artifact the pages load. A partial build (an aborted esbuild) looks the
# same as a good one to rsync, and a missing worker kills completion without killing the
# editor — so check them all, not just the entry bundle.
for f in hooks-editor.bundle.js hooks-editor.bundle.css hooks-editor.worker.js hooks-editor.ts.worker.js; do
  [[ -s $OUT/$f ]] || { echo "build-hooks-editor: $f missing/empty after build — hooks/commands/triggers would ship without Monaco" >&2; exit 1; }
done

du -h "$OUT"/hooks-editor.bundle.js "$OUT"/hooks-editor.bundle.css | awk '{print $2": "$1}'
