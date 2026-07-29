#!/usr/bin/env bash
# build-hooks-editor.sh — repo-root entry point for the Monaco hooks-editor bundle.
# Thin forwarder: the real build (and the reason it must never be skipped) lives in
# extensions/hud-internal/scripts/build-hooks-editor.sh, next to the vendor/ source and
# the node_modules the esbuild run resolves against. One implementation, two entry points
# (root packaging scripts here, the extension's own scripts/build.sh there).
set -euo pipefail
cd "$(dirname "$0")/.."
exec extensions/hud-internal/scripts/build-hooks-editor.sh "$@"
