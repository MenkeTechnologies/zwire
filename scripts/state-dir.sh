#!/usr/bin/env bash
# Shared: resolve the default zwire state directory (base snapshot, profile,
# native-host manifest, hud-scheme). zwire stores user data in the OS's regular
# application-data location — NOT a dotdir in $HOME:
#
#   macOS   ~/Library/Application Support/com.menketechnologies.zwire  (base::DIR_APP_DATA)
#   Linux   ${XDG_CONFIG_HOME:-~/.config}/zwire                        (XDG Base Directory)
#   other   ${XDG_CONFIG_HOME:-~/.config}/zwire
#
# macOS uses the bundle identifier (the .app's CFBundleIdentifier and the
# platform convention that app-data folders are named by reverse-DNS id); the
# other platforms keep the short app name their conventions expect.
#
# The C++ HUD color patch (fork/patches/0002-ui-colors-hud.patch) resolves the
# SAME directory natively, so the scheme file the launcher/host writes is the
# file the browser reads. Keep the two in sync.
#
# $ZWIRE_STATE overrides the default on every platform. Source this file, then:
#   STATE=${ZWIRE_STATE:-$(zwire_default_state)}
zwire_default_state() {
  case "$(uname -s)" in
    Darwin) printf '%s\n' "$HOME/Library/Application Support/com.menketechnologies.zwire" ;;
    *)      printf '%s\n' "${XDG_CONFIG_HOME:-$HOME/.config}/zwire" ;;
  esac
}
