#!/usr/bin/env bash
# install.sh — put `zwire` on PATH, fetch the base browser, and (macOS)
# rebrand the base bundle's Dock name + icon in place.
#
#   scripts/install.sh [--bindir DIR]
#
# Idempotent: safe to re-run after a base upgrade.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
source "$ROOT/scripts/state-dir.sh"
BINDIR=${HOME}/.local/bin
while [[ $# -gt 0 ]]; do
  case $1 in
    --bindir) BINDIR=$2; shift 2 ;;
    *) echo "install: unknown arg $1" >&2; exit 1 ;;
  esac
done

# 1. base browser
if [[ ! -f ${ZWIRE_STATE:-$(zwire_default_state)}/base.path ]]; then
  "$ROOT/scripts/fetch-base.sh"
fi

# 1b. Monaco hooks-editor bundle. lib/hooks-editor/ is a gitignored esbuild artifact and
# bin/zwire loads the extensions straight out of the repo, so on a fresh clone the Hooks /
# Commands / Triggers pages come up with NO editor at all: each only mounts one
# `if (window.HooksEditor)` and the <script src> 404s — silently, nothing on screen says why.
# Needs node >=20 + pnpm (the monaco/esbuild devDeps).
"$ROOT/scripts/build-hooks-editor.sh" >/dev/null
echo "install: built the Monaco hooks editor bundle (lib/hooks-editor)" >&2

# 2. launcher on PATH
mkdir -p "$BINDIR"
ln -sf "$ROOT/bin/zwire" "$BINDIR/zwire"
echo "install: linked $BINDIR/zwire" >&2
case ":$PATH:" in
  *":$BINDIR:"*) ;;
  *) echo "install: add $BINDIR to PATH to use \`zwire\`" >&2 ;;
esac

# 3. macOS: rebrand the running app's Dock presence
if [[ $(uname -s) == Darwin ]]; then
  "$ROOT/scripts/rebrand-macos.sh" || true
fi

echo "install: done — run \`zwire\`" >&2
