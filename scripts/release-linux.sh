#!/usr/bin/env bash
# release-linux.sh — cut a Linux x86_64 zwire release and publish it to GitHub.
#
# Builds the SAME self-contained ~/.local/opt/zwire tree that
# localinstall-linux.sh produces (into a writable staging prefix, desktop
# integration skipped), then tars it and uploads it to the `v<version>` release:
#
#   dist/zwire-<version>-linux-x86_64[-stock].tar.gz
#       zwire/            browser + ext/ + native/ + launcher + linux-integrate.sh
#   dist/zwire-<version>-linux-x86_64[-stock].tar.gz.sha256
#
# Install: tar xzf …; zwire/linux-integrate.sh (PATH link + icon + .desktop).
#
# The base browser is labelled from $STATE/base.version, never assumed: a
# fork-* base (fork/package.sh on a Linux host) ships as plain `linux-x86_64`;
# anything else is a STOCK Chromium snapshot (fetch-base.sh — no fork patches)
# and the asset name and release notes say `-stock`.
#
# Version is read from package.json; the tag `v<version>` must already exist.
# If the release exists (e.g. the macOS cut) the tarball is uploaded onto it;
# otherwise a release is created. An asset of the same name is never clobbered.
#
#   scripts/release-linux.sh [--notes-file FILE] [--out DIR] [--dry-run]
#
# Requires: Linux x86_64, cargo, node + pnpm (Monaco bundle), gh (authenticated),
# and the submodules checked out recursively.
set -euo pipefail
cd "$(dirname "$0")/.."
export APP_TITLE="ZWIRE" APP_SUB="// linux release"
source scripts/cyberpunk.sh

ROOT="$(pwd)"
REPO=MenkeTechnologies/zwire
NOTES_FILE=""
OUT="$ROOT/dist"
DRY_RUN=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --notes-file) NOTES_FILE="${2:?--notes-file needs a path}"; shift 2 ;;
    --out)        OUT="${2:?--out needs a path}"; shift 2 ;;
    --dry-run)    DRY_RUN=1; shift ;;
    -h|--help)    perl -ne 'print if 2..25' "$0" | perl -pe 's/^# ?//'; exit 0 ;;
    *) cyber_fail "unknown arg: $1"; exit 1 ;;
  esac
done

cyber_banner
cyber_status "OPERATION" "RELEASE // package linux tarball and publish to GitHub"
echo

cyber_section "PRE-FLIGHT"
[[ "$(uname -s)/$(uname -m)" == "Linux/x86_64" ]] || { cyber_fail "Linux x86_64 only (fetch-base.sh has no other Linux snapshot)"; exit 1; }
command -v gh    >/dev/null || { cyber_fail "gh not found — install the GitHub CLI and 'gh auth login'"; exit 1; }
command -v cargo >/dev/null || { cyber_fail "cargo not found — install Rust (https://rustup.rs)"; exit 1; }

VERSION="$(perl -ne 'if (!$seen && /"version"\s*:\s*"([^"]+)"/) { print "$1\n"; $seen = 1 }' package.json)"
TAG="v$VERSION"
cyber_ok "version // $VERSION  (tag $TAG)"
[[ -z "$(git status --porcelain --ignore-submodules=dirty)" ]] \
  || cyber_warn "working tree is dirty — artifacts may not match the tagged commit"
git rev-parse -q --verify "refs/tags/$TAG" >/dev/null \
  || { cyber_fail "tag $TAG does not exist — bump package.json, commit, then: git tag $TAG && git push origin $TAG"; exit 1; }
git ls-remote --exit-code --tags origin "$TAG" >/dev/null 2>&1 \
  || { cyber_warn "tag $TAG not on origin — pushing it"; git push origin "$TAG"; }
cyber_ok "tag present locally + on origin"

cyber_section "BUILD SELF-CONTAINED TREE"
command rm -rf "$OUT"; mkdir -p "$OUT/stage"
# Fresh state dir unless one is given: an existing base.path is reused (that is
# how a fork base from fork/package.sh gets in); otherwise localinstall-linux.sh
# fetches the stock snapshot into it.
export ZWIRE_STATE="${ZWIRE_STATE:-$OUT/state}"
ZWIRE_PREFIX="$OUT/stage" ZWIRE_NO_INTEGRATE=1 bash scripts/localinstall-linux.sh
TREE="$OUT/stage/opt/zwire"
[[ -x "$TREE/zwire" ]] || { cyber_fail "staged tree missing launcher: $TREE/zwire"; exit 1; }
[[ -x "$TREE/native/stryke" ]] || cyber_warn "no bundled stryke — Hooks falls back to a stryke on PATH"

BASE_VER="$(cat "$ZWIRE_STATE/base.version" 2>/dev/null || echo unknown)"
case "$BASE_VER" in
  fork-*) FLAVOR="";       BASE_DESC="zwire Chromium fork ${BASE_VER#fork-} (patch series fork/patches)" ;;
  *)      FLAVOR="-stock"; BASE_DESC="stock Chromium snapshot $BASE_VER — no zwire fork patches (HUD chrome, audio EQ, branding are extension-level only)" ;;
esac
cyber_ok "base // $BASE_DESC"

cyber_section "PACKAGE .tar.gz"
NAME="zwire-$VERSION-linux-x86_64$FLAVOR"
TARBALL="$OUT/$NAME.tar.gz"
# Archive root is zwire/ so an extract never sprays files into the cwd.
tar -C "$OUT/stage/opt" -czf "$TARBALL" zwire
( cd "$OUT" && sha256sum "$NAME.tar.gz" > "$NAME.tar.gz.sha256" )
cyber_ok "tarball // $TARBALL ($(du -h "$TARBALL" | awk '{print $1}'))"

NOTES="$OUT/notes.md"
if [[ -n "$NOTES_FILE" ]]; then
  cp "$NOTES_FILE" "$NOTES"
else
  PREV_TAG="$(git tag --list 'v*' --sort=-version:refname | grep -vx "$TAG" | head -1 || true)"
  {
    echo "### zwire $VERSION (Linux x86_64)"
    echo
    echo "Base browser: $BASE_DESC."
    echo
    echo '```'
    echo "tar xzf $NAME.tar.gz && zwire/linux-integrate.sh   # PATH link + icon + .desktop under ~/.local"
    echo '```'
    echo
    if [[ -n "$PREV_TAG" ]]; then
      echo "Changes since $PREV_TAG:"
      echo
      git log --no-merges --pretty='- %s' "$PREV_TAG..$TAG"
    else
      git log --no-merges --pretty='- %s' -20 "$TAG"
    fi
  } > "$NOTES"
fi

if [[ "$DRY_RUN" == "1" ]]; then
  cyber_section "DRY RUN"
  cyber_status "TARBALL" "$TARBALL"
  cyber_status "NOTES" "$NOTES"
  exit 0
fi

cyber_section "PUBLISH"
if gh release view "$TAG" -R "$REPO" >/dev/null 2>&1; then
  gh release view "$TAG" -R "$REPO" --json assets -q '.assets[].name' | grep -qx "$NAME.tar.gz" \
    && { cyber_fail "release $TAG already carries $NAME.tar.gz — refusing to overwrite"; exit 1; }
  gh release upload "$TAG" -R "$REPO" "$TARBALL" "$TARBALL.sha256"
else
  gh release create "$TAG" -R "$REPO" \
    --title "zwire $VERSION (Linux)" \
    --notes-file "$NOTES" \
    "$TARBALL" "$TARBALL.sha256"
fi
cyber_ok "released // https://github.com/$REPO/releases/tag/$TAG"
