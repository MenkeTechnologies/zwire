#!/usr/bin/env bash
# release-macos.sh — cut a macOS zwire release and publish it to GitHub.
#
# Builds the SAME self-contained /Applications/zwire.app that localinstall.sh
# produces (into a writable staging dir, no sudo), then packages it two ways and
# uploads both to the `v<version>` GitHub release:
#
#   dist/zwire-<version>.pkg         installer — pkgbuild component, non-relocatable,
#                                    identifier com.menketechnologies.zwire, →/Applications
#   dist/zwire-<version>-macos.zip   the bundle itself (zwire.app at the archive root)
#
# The .app is ad-hoc signed (inherited from localinstall.sh) — there is no
# Developer ID / notarization, so first launch still needs right-click → Open.
# That matches every prior release; this script does not change signing.
#
# Version is read from package.json; the git tag `v<version>` must already exist
# (bump + commit + tag first — this script only packages + publishes). It pushes
# the tag if it is not yet on origin, and refuses to overwrite an existing
# release so it can't clobber a concurrent release of the same version.
#
#   scripts/release-macos.sh [--notes-file FILE] [--out DIR] [--dry-run]
#
#   --notes-file FILE  release body (Markdown). Default: commit subjects since
#                      the previous v* tag.
#   --out DIR          artifact output dir (default: dist/).
#   --dry-run          build + package the artifacts but do NOT create the
#                      release (prints the paths so you can inspect them).
#
# Requires: macOS, cargo (host build), gh (authenticated), and the system
# pkgbuild/ditto tools.
set -euo pipefail
cd "$(dirname "$0")/.."
export APP_TITLE="ZWIRE" APP_SUB="// macOS release"
source scripts/cyberpunk.sh

ROOT="$(pwd)"
IDENTIFIER="com.menketechnologies.zwire"   # pkg id + install-location key; keep in sync with the .app CFBundleIdentifier

NOTES_FILE=""
OUT="$ROOT/dist"
DRY_RUN=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --notes-file) NOTES_FILE="${2:?--notes-file needs a path}"; shift 2 ;;
    --out)        OUT="${2:?--out needs a path}"; shift 2 ;;
    --dry-run)    DRY_RUN=1; shift ;;
    -h|--help)    sed -n '2,26p' "$0"; exit 0 ;;
    *) cyber_fail "unknown arg: $1"; exit 1 ;;
  esac
done

cyber_banner
cyber_status "OPERATION" "RELEASE // package macOS .app/.pkg and publish to GitHub"
echo

cyber_section "PRE-FLIGHT"
[[ "$(uname -s)" == "Darwin" ]] || { cyber_fail "macOS-only (produces .app/.pkg)"; exit 1; }
command -v gh      >/dev/null || { cyber_fail "gh not found — install the GitHub CLI and 'gh auth login'"; exit 1; }
command -v cargo   >/dev/null || { cyber_fail "cargo not found — install Rust (https://rustup.rs)"; exit 1; }
command -v pkgbuild >/dev/null || { cyber_fail "pkgbuild not found (Xcode command line tools)"; exit 1; }

# Version comes out of package.json with perl, not python3: the JSON here is a
# flat manifest, and a perl one-liner has no interpreter-flavor dependency (a
# non-CPython python3 on PATH broke the release script mid-cut).
VERSION="$(perl -ne 'if (!$seen && /"version"\s*:\s*"([^"]+)"/) { print "$1\n"; $seen = 1 }' package.json)"
TAG="v$VERSION"
cyber_ok "version // $VERSION  (tag $TAG)"

# Release from a committed state — a dirty tree means the artifacts wouldn't
# match the tagged source. Warn loudly rather than hard-fail (allow deliberate
# local overrides), but the tag itself is required.
if [[ -n "$(git status --porcelain)" ]]; then
  cyber_warn "working tree is dirty — artifacts may not match the tagged commit"
fi
git rev-parse -q --verify "refs/tags/$TAG" >/dev/null \
  || { cyber_fail "tag $TAG does not exist — bump package.json, commit, then: git tag $TAG && git push origin $TAG"; exit 1; }

# Never clobber an existing published release (guards against a concurrent
# session having already cut this version).
if gh release view "$TAG" -R MenkeTechnologies/zwire >/dev/null 2>&1; then
  cyber_fail "release $TAG already exists — refusing to overwrite"; exit 1
fi

# Make sure the tag is on origin so the release attaches to a real ref.
if ! git ls-remote --exit-code --tags origin "$TAG" >/dev/null 2>&1; then
  cyber_warn "tag $TAG not on origin — pushing it"
  git push origin "$TAG"
fi
cyber_ok "tag present locally + on origin"

cyber_section "BUILD SELF-CONTAINED .app"
rm -rf "$OUT"; mkdir -p "$OUT/stage"
STAGE_APP="$OUT/stage/zwire.app"
# Reuse localinstall.sh's bundle assembly, redirected to a writable staging dir
# via $ZWIRE_DEST so no sudo / no touching /Applications. stage/ then contains
# exactly one thing — zwire.app — which is what pkgbuild --root expects.
ZWIRE_DEST="$STAGE_APP" bash scripts/localinstall.sh
[[ -d "$STAGE_APP" ]] || { cyber_fail "staged app missing: $STAGE_APP"; exit 1; }
BUILT_VER="$(defaults read "$STAGE_APP/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null || echo '?')"
[[ "$BUILT_VER" == "$VERSION" ]] \
  || cyber_warn "built .app is $BUILT_VER but releasing $VERSION — version.js/package.json out of sync?"
cyber_ok "app // $STAGE_APP ($(du -sh "$STAGE_APP" | awk '{print $1}'))"

cyber_section "PACKAGE .pkg"
PKG="$OUT/zwire-$VERSION.pkg"
PLIST="$OUT/component.plist"
# pkgbuild defaults an app bundle to relocatable=true, which lets an upgrade
# retarget a stray copy of the app elsewhere. Force the top bundle to
# non-relocatable so it always installs to /Applications (matches prior releases).
pkgbuild --analyze --root "$OUT/stage" "$PLIST" >/dev/null
/usr/libexec/PlistBuddy -c "Set :0:BundleIsRelocatable false" "$PLIST"
pkgbuild --root "$OUT/stage" --component-plist "$PLIST" \
  --identifier "$IDENTIFIER" --version "$VERSION" \
  --install-location /Applications "$PKG" >/dev/null
cyber_ok "pkg // $PKG ($(du -h "$PKG" | awk '{print $1}'))"

cyber_section "PACKAGE .zip"
ZIP="$OUT/zwire-$VERSION-macos.zip"
# --keepParent so the archive root is zwire.app/ (not its contents).
ditto -c -k --sequesterRsrc --keepParent "$STAGE_APP" "$ZIP"
cyber_ok "zip // $ZIP ($(du -h "$ZIP" | awk '{print $1}'))"

# Release notes: explicit file, else commit subjects since the previous v* tag.
NOTES="$OUT/notes.md"
if [[ -n "$NOTES_FILE" ]]; then
  cp "$NOTES_FILE" "$NOTES"
else
  PREV_TAG="$(git tag --list 'v*' --sort=-version:refname | grep -vx "$TAG" | head -1 || true)"
  {
    echo "### zwire $VERSION (macOS)"
    echo
    if [[ -n "$PREV_TAG" ]]; then
      echo "Changes since $PREV_TAG:"
      echo
      git log --no-merges --pretty='- %s' "$PREV_TAG..$TAG"
    else
      git log --no-merges --pretty='- %s' -20 "$TAG"
    fi
  } > "$NOTES"
  cyber_warn "no --notes-file — generated notes from commits since ${PREV_TAG:-HEAD~20}"
fi

if [[ "$DRY_RUN" == "1" ]]; then
  cyber_section "DRY RUN"
  cyber_ok "artifacts ready (release NOT created):"
  cyber_status "PKG" "$PKG"
  cyber_status "ZIP" "$ZIP"
  cyber_status "NOTES" "$NOTES"
  exit 0
fi

cyber_section "PUBLISH"
gh release create "$TAG" -R MenkeTechnologies/zwire \
  --title "zwire $VERSION (macOS)" \
  --notes-file "$NOTES" \
  "$PKG" "$ZIP"
cyber_ok "released // https://github.com/MenkeTechnologies/zwire/releases/tag/$TAG"
