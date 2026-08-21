#!/usr/bin/env bash
# zwire test runner: a JS syntax gate over the repo's own front-end (new-tab +
# theme + root scripts) plus each bundled extension's own test script. There is
# no Rust/compile step at the browser level — the base is a prebuilt snapshot.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
export APP_TITLE="ZWIRE" APP_SUB="// chromium, rebranded"
source scripts/cyberpunk.sh

cyber_banner
cyber_status "OPERATION" "TEST // syntax gate + extension suites"
echo

FAIL=0

cyber_section "JS SUBSYSTEM (node --check)"
START=$(date +%s)
JS_TOTAL=0; JS_BAD=0
while IFS= read -r f; do
  JS_TOTAL=$((JS_TOTAL + 1))
  if ! node --check "$f" 2>/tmp/zwire-check.$$; then
    JS_BAD=$((JS_BAD + 1)); FAIL=1
    echo -e "  ${R}✗${N} $f"
    command sed 's/^/      /' /tmp/zwire-check.$$ | head -3
  fi
done < <(command find newtab theme -name '*.js' \
           -not -path '*/node_modules/*' -not -path '*/lib/zgui-core/*' 2>/dev/null)
command rm -f /tmp/zwire-check.$$
echo -e "  ${D}checked${N} ${W}${JS_TOTAL}${N}  ${D}bad${N} ${R}${JS_BAD}${N}  ${D}// $(( $(date +%s) - START ))s${N}"
# Checking nothing is not the same as checking clean: if newtab/ or theme/ moved, find would
# print nothing, the loop would never run, and this section would report "checked 0, bad 0 —
# JS nominal". Both directories carry sources today, so an empty sweep means a broken checkout.
if [[ "$JS_TOTAL" == "0" ]]; then
  FAIL=1
  cyber_fail "checked 0 files — newtab/ and theme/ matched nothing, so this gate proved nothing"
elif [[ "$JS_BAD" == "0" ]]; then
  cyber_ok "JS nominal"
else
  cyber_fail "JS compromised"
fi
echo

cyber_section "SHARED-FILE PARITY (newtab/ vs extensions/hud-internal/)"
# Chrome loads each unpacked extension from its own directory and an extension cannot
# read a sibling's files, so a handful of shared sources exist as byte-identical copies
# in both trees (README §architecture). Nothing enforced that: editing one copy and
# forgetting the other silently forks the two surfaces — the HUD palette and the new-tab
# palette disagreeing about a command, or the layout engine validating differently on
# each side. Compare them here so the drift is a test failure, not a bug report.
DUPES=(schemes.js palette-cmds.js cmd-defaults.js zntp-core.js lib/term/term-overlay.js)
DUP_BAD=0
for f in "${DUPES[@]}"; do
  if [[ ! -f "newtab/$f" || ! -f "extensions/hud-internal/$f" ]]; then
    DUP_BAD=$((DUP_BAD + 1)); FAIL=1
    echo -e "  ${R}✗${N} $f — missing on one side"
  elif ! command diff -q "newtab/$f" "extensions/hud-internal/$f" >/dev/null; then
    DUP_BAD=$((DUP_BAD + 1)); FAIL=1
    echo -e "  ${R}✗${N} $f — copies have drifted"
    command diff "extensions/hud-internal/$f" "newtab/$f" | head -6 | command sed 's/^/      /'
  fi
done
echo -e "  ${D}compared${N} ${W}${#DUPES[@]}${N}  ${D}drifted${N} ${R}${DUP_BAD}${N}"
[[ "$DUP_BAD" == "0" ]] && cyber_ok "shared copies in sync" || cyber_fail "shared copies drifted"
echo

cyber_section "EXTENSION SUITES"
for ext in extensions/hud-internal extensions/zpwrchrome; do
  # A bundled extension that has lost its package.json (or its test script) used to be skipped
  # in silence / with a warning, so the run still ended NOMINAL over a suite that never ran.
  # Both extensions ship a test script today; absence is a broken checkout, not an exemption.
  if [[ ! -f "$ext/package.json" ]]; then
    FAIL=1; cyber_fail "$ext // no package.json — bundled extension missing from the checkout"
    continue
  fi
  if node -e 'process.exit(require("./'"$ext"'/package.json").scripts?.test?0:1)' 2>/dev/null; then
    echo -e "  ${D}── $ext ──${N}"
    if (cd "$ext" && pnpm test) >/tmp/zwire-ext.$$ 2>&1; then
      cyber_ok "$ext // pass"
    else
      FAIL=1; cyber_fail "$ext // fail"
      command tail -8 /tmp/zwire-ext.$$ | command sed 's/^/      /'
    fi
    command rm -f /tmp/zwire-ext.$$
  else
    FAIL=1; cyber_fail "$ext // no test script — nothing measured this extension"
  fi
done
echo
cyber_line

if [[ "$FAIL" == "0" ]]; then
  cyber_tagline "ALL SYSTEMS NOMINAL."
else
  cyber_tagline "TESTS COMPROMISED."
fi
exit "$FAIL"
