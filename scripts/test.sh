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
[[ "$JS_BAD" == "0" ]] && cyber_ok "JS nominal" || cyber_fail "JS compromised"
echo

cyber_section "EXTENSION SUITES"
for ext in extensions/hud-internal extensions/zpwrchrome; do
  [[ -f "$ext/package.json" ]] || continue
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
    cyber_warn "$ext // no test script"
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
