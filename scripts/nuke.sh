#!/usr/bin/env bash
# Total annihilation: remove the /Applications wrapper AND the 325MB base
# snapshot under ~/.zwire/base, then re-fetch the base from scratch, rebrand, and
# reinstall the wrapper. This RE-DOWNLOADS the base browser — slow, deliberate.
# Your profile (~/.zwire/profile) is preserved. Ported from the sibling set.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
export APP_TITLE="ZWIRE" APP_SUB="// chromium, rebranded"
source scripts/cyberpunk.sh

STATE=${ZWIRE_STATE:-$HOME/.zwire}

cyber_banner
cyber_status "OPERATION" "NUKE // wipe base + wrapper, refetch"
echo

cyber_section "WIPE INSTALLED WRAPPER"
command rm -rf /Applications/zwire.app dist
cyber_ok "wrapper + dist/ destroyed"
echo

cyber_section "WIPE BASE SNAPSHOT"
command rm -rf "$STATE/base" "$STATE/base.path" "$STATE/base.version"
cyber_ok "base snapshot destroyed (profile preserved)"
echo

cyber_section "REFETCH + REBRAND"
cyber_line
bash scripts/build.sh || { cyber_fail "rebuild failed"; cyber_tagline "LAUNCH ABORTED"; exit 1; }
echo

cyber_section "REINSTALL WRAPPER"
cyber_line
if [[ "$(uname -s)" == "Darwin" ]]; then
  bash scripts/localinstall.sh
else
  cyber_warn "/Applications install is macOS-only — skipped"
fi
cyber_tagline "NUCLEAR LAUNCH SUCCESSFUL"
