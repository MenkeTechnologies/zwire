#!/usr/bin/env bash
# linux-integrate.sh — wire an installed zwire tree into the desktop session:
# a `zwire` symlink on PATH, the app icon, and a .desktop entry (app menu).
#
#   linux-integrate.sh [PREFIX]
#
# Lives INSIDE the install (copied there by localinstall-linux.sh, shipped in
# the Linux release tarball) and integrates the tree it sits in, so an extracted
# release is installed by running zwire/linux-integrate.sh — no repo needed.
# PREFIX defaults to ~/.local (no root): $PREFIX/bin, $PREFIX/share/….
set -euo pipefail
DEST="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
PREFIX=${1:-${ZWIRE_PREFIX:-$HOME/.local}}
BINLINK=$PREFIX/bin/zwire
DESKTOP=$PREFIX/share/applications/zwire.desktop
ICON_DEST=$PREFIX/share/icons/hicolor/512x512/apps/zwire.png

[[ -x "$DEST/zwire" ]] || { echo "linux-integrate: no zwire launcher in $DEST" >&2; exit 1; }

mkdir -p "$(dirname "$BINLINK")" "$(dirname "$ICON_DEST")" "$(dirname "$DESKTOP")"
ln -sf "$DEST/zwire" "$BINLINK"
echo "bin // $BINLINK -> $DEST/zwire"
[[ -f "$DEST/zwire.png" ]] && cp "$DEST/zwire.png" "$ICON_DEST" && echo "icon // $ICON_DEST"
cat > "$DESKTOP" <<EOF
[Desktop Entry]
Type=Application
Name=zwire
GenericName=Web Browser
Comment=Chromium superset with the zwire cyberpunk HUD
Exec=$DEST/zwire %U
Icon=$ICON_DEST
Terminal=false
StartupNotify=true
StartupWMClass=chrome
Categories=Network;WebBrowser;
MimeType=text/html;text/xml;application/xhtml+xml;x-scheme-handler/http;x-scheme-handler/https;
EOF
update-desktop-database "$(dirname "$DESKTOP")" >/dev/null 2>&1 || true
gtk-update-icon-cache "$PREFIX/share/icons/hicolor" >/dev/null 2>&1 || true
echo "desktop // $DESKTOP"
