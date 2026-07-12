#!/usr/bin/env bash
# HUD extension test runner: JS syntax gate (node --check across every source +
# page script) plus a debug build of the Rust native host (native/zwire-host).
# The host's own unit tests live under native/zwire-host (cargo test).
set -uo pipefail
cd "$(dirname "$0")/.."
export APP_TITLE="ZWIRE HUD" APP_SUB="// the cyberpunk HUD extension"
source scripts/cyberpunk.sh

cyber_banner
cyber_status "OPERATION" "TEST // syntax gate"
echo

FAIL=0

cyber_section "JS SUBSYSTEM (node --check)"
START=$(date +%s)
JS_TOTAL=0; JS_BAD=0
while IFS= read -r f; do
  JS_TOTAL=$((JS_TOTAL + 1))
  if ! node --check "$f" 2>/tmp/zwire-hud-check.$$; then
    JS_BAD=$((JS_BAD + 1)); FAIL=1
    echo -e "  ${R}✗${N} $f"
    command sed 's/^/      /' /tmp/zwire-hud-check.$$ | head -3
  fi
done < <(command find . -name '*.js' \
           -not -path './node_modules/*' -not -path './lib/zgui-core/*' \
           -not -path './dist/*' -not -path './.git/*')
command rm -f /tmp/zwire-hud-check.$$
echo -e "  ${D}checked${N} ${W}${JS_TOTAL}${N}  ${D}bad${N} ${R}${JS_BAD}${N}  ${D}// $(( $(date +%s) - START ))s${N}"
[[ "$JS_BAD" == "0" ]] && cyber_ok "JS nominal" || cyber_fail "JS compromised"
echo

cyber_section "AUDIO SPEC (buildSpec/parseSpec round-trip)"
if node tests/spec-roundtrip.mjs 2>/tmp/zwire-hud-spec.$$; then
  cyber_ok "spec round-trip nominal"
else
  FAIL=1; cyber_fail "spec round-trip compromised"
  command sed 's/^/    /' /tmp/zwire-hud-spec.$$ | head -30
fi
command rm -f /tmp/zwire-hud-spec.$$
echo

cyber_section "PALETTE COMPUTE (calc / units / percent / currency ports)"
if node tests/compute.mjs 2>/tmp/zwire-hud-compute.$$; then
  cyber_ok "compute engine nominal"
else
  FAIL=1; cyber_fail "compute engine compromised"
  command sed 's/^/    /' /tmp/zwire-hud-compute.$$ | head -30
fi
command rm -f /tmp/zwire-hud-compute.$$
echo

cyber_section "HISTORY DASHBOARD (calendar / analytics aggregation + render)"
if node tests/history.mjs 2>/tmp/zwire-hud-history.$$ && node tests/history-render.mjs 2>>/tmp/zwire-hud-history.$$; then
  cyber_ok "history dashboard nominal"
else
  FAIL=1; cyber_fail "history dashboard compromised"
  command sed 's/^/    /' /tmp/zwire-hud-history.$$ | head -30
fi
command rm -f /tmp/zwire-hud-history.$$
echo

cyber_section "NATIVE HOST (rust build)"
if command -v cargo >/dev/null 2>&1; then
  if ( cd native/zwire-host && cargo build --quiet ) 2>/tmp/zwire-hud-rs.$$; then
    cyber_ok "zwire-host builds"
  else
    FAIL=1; cyber_fail "zwire-host failed to build"
    command sed 's/^/    /' /tmp/zwire-hud-rs.$$ | head -8
  fi
  command rm -f /tmp/zwire-hud-rs.$$
else
  cyber_warn "cargo not found — skipping native host build"
fi
echo
cyber_line

if [[ "$FAIL" == "0" ]]; then
  cyber_tagline "ALL SYSTEMS NOMINAL."
else
  cyber_tagline "TESTS COMPROMISED."
fi
exit "$FAIL"
