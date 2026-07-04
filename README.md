```
 _________  ____   _____        ______  _____ ____  
|__  / __ )|  _ \ / _ \ \      / / ___|| ____|  _ \ 
  / /|  _ \| |_) | | | \ \ /\ / /\___ \|  _| | |_) |
 / /_| |_) |  _ <| |_| |\ V  V /  ___) | |___|  _ < 
/____|____/|_| \_\\___/  \_/\_/  |____/|_____|_| \_\
```

[![Manifest](https://img.shields.io/badge/base-chromium-05d9e8.svg)](#0x01-architecture)
[![Extensions](https://img.shields.io/badge/preloaded-zpwrchrome-ff2a6d.svg)](https://github.com/MenkeTechnologies/zpwrchrome)
[![Theme](https://img.shields.io/badge/theme-cyberpunk-d300c5.svg)](theme/)
[![Docs](https://img.shields.io/badge/docs-online-05d9e8.svg)](https://menketechnologies.github.io/zbrowser/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

### `[CHROMIUM — REBRANDED — CYBERPUNK]`

> *"Chrome, with my own branding, my own extensions, my own look."*

zbrowser is a **Chromium/Blink browser, rebranded**, in the strykelang cyberpunk
HUD. It preloads the `zpwrchrome` power-tool, a HUD chrome theme, and a HUD
new-tab page against a dedicated profile so it never touches your system Chrome.
Two build paths:

- **Runtime rebrand** (default, no compile): HUD **colors** + HUD **new-tab** +
  your extensions on a prebuilt Chromium base. Tab shapes stay stock.
- **Source fork** (`fork/`, compiles Chromium): the **whole chrome** in the HUD —
  tab shapes, UI fonts, neon toolbar. See [`fork/README.md`](fork/README.md).

## `[0x00] WHY A REAL BLINK BASE`

`zpwrchrome` is a Manifest V3 extension that needs `userScripts`,
`declarativeNetRequestWithHostAccess`, `nativeMessaging`, `webRequest`, and a
service-worker background (`minimum_chrome_version: 127`). None of that runs on
WebKit (Tauri/Safari) or Servo — **only a real Chromium engine loads it.**

The base is a **plain [Chromium snapshot](https://commondatastorage.googleapis.com/chromium-browser-snapshots/index.html)**
— unbranded Chromium, **no Google logo, no "for automated testing" banner**
(that stripe is exclusive to Chrome for Testing). Unbranded Chromium also retains
the `--load-extension` switch that preloads `zpwrchrome` — [removed from *branded*
Chrome in version 137][psa]. Stock Google Chrome can no longer be scripted this
way; Chromium can.

[psa]: https://groups.google.com/a/chromium.org/g/chromium-extensions/c/1-g8EFx2BBY/m/S0ET5wPjCAAJ

## `[0x01] ARCHITECTURE`

| Layer | What it is |
|---|---|
| **Base** | Plain Chromium snapshot (pinned rev), downloaded by `scripts/fetch-base.sh` |
| **Rebrand** | `scripts/rebrand-macos.sh` patches the base bundle's Dock name to `zbrowser` + cyberpunk `.icns`, deletes `CFBundleIconName`, and re-signs ad-hoc so macOS honors it |
| **Theme** | `theme/` — a Chrome theme extension mapping the HUD palette onto frame / toolbar / tabs (colors only) |
| **New tab** | `newtab/` — a `chrome_url_overrides.newtab` extension: the full HUD (Orbitron, CRT scanlines, neon omnibox), fonts vendored locally |
| **Power-tool** | `extensions/zpwrchrome` — the MV3 extension, loaded as a submodule (reuse, not copy) |
| **Launcher** | `bin/zbrowser` — starts the base against `~/.zbrowser/profile` with all three extensions |
| **Fork** | `fork/` — optional source build that restyles the native chrome (tab shapes, fonts, borders) for the full HUD |

A Chrome theme extension changes **colors only** — it cannot reshape tabs, fonts,
or toolbar (those are native C++). The runtime rebrand accepts that limit; the
`fork/` path removes it by compiling a patched Chromium.

## `[0x02] INSTALL`

```sh
git clone --recurse-submodules https://github.com/MenkeTechnologies/zbrowser.git
cd zbrowser
scripts/install.sh          # fetch base + link `zbrowser` on PATH + rebrand (macOS)
zbrowser                    # launch
```

`install.sh` downloads the Chromium base into `~/.zbrowser/base`, symlinks
`bin/zbrowser` into `~/.local/bin`, and on macOS rebrands the base bundle's Dock
name and icon in place. Re-run after a base upgrade.

## `[0x03] USAGE`

```sh
zbrowser                         # open with the HUD new tab
zbrowser https://github.com      # open a url
zbrowser --incognito             # any Chromium flag is passed through
```

State lives under `$ZBROWSER_STATE` (default `~/.zbrowser`):

| Path | Purpose |
|---|---|
| `base/` | the Chromium binary |
| `base.path` / `base.version` | resolved binary + pinned revision |
| `profile/` | the dedicated user-data-dir (bookmarks, history, sessions) |

Override the base with `ZBROWSER_BASE=/path/to/chromium zbrowser`.

## `[0x04] UPDATING THE BASE`

```sh
scripts/fetch-base.sh              # latest Chromium snapshot
scripts/fetch-base.sh 1656770      # pin an exact revision
scripts/rebrand-macos.sh           # re-apply the rebrand after the swap
```

## `[0x05] FULL-HUD FORK`

The runtime rebrand can't restyle the native chrome. To put the whole browser —
tab shapes, neon toolbar, HUD-colored frame — in the HUD, `fork/` compiles a
patched Chromium (~100 GB checkout, 1–4 hr first build, ongoing rebase
maintenance):

```sh
fork/fetch.sh                                   # depot_tools + pinned Chromium
fork/apply-patches.sh  ~/zbrowser-chromium/src  # HUD patch series
fork/build.sh          ~/zbrowser-chromium/src  # the long compile
fork/package.sh        ~/zbrowser-chromium/src/out/zbrowser
```

The HUD patch series is **authored** against the pinned tag (`150.0.7871.46`) and
verified apply-clean: sharp 2px tabs (`tab_style_views.cc`), the cyberpunk
palette on frame/toolbar/tabs/omnibox (`chrome_color_mixer.cc`), a neon cyan
under-toolbar line (`toolbar_view.cc`), a sharp omnibox field
(`location_bar_view.cc`), and `zbrowser` product strings (`BRANDING`). The UI
font patch (Orbitron / Share Tech Mono) is pending the checked-out tree.
`fork/build.sh` is the compile gate. See [`fork/README.md`](fork/README.md) and
[`fork/patches/README.md`](fork/patches/README.md).

## `[0x06] NOTES`

- **Native messaging:** `zpwrchrome`'s `pass` and segmented-download features
  need its native host installed — see the
  [zpwrchrome](https://github.com/MenkeTechnologies/zpwrchrome) setup.
- **Developer-mode banner:** unpacked extensions loaded via `--load-extension`
  show Chromium's developer-extensions notice. It is cosmetic; the extensions
  run fully.
- **Cross-platform:** the `zbrowser` launcher works on macOS (aarch64/x64) and
  Linux (x86_64). The in-place Dock rebrand is macOS-only; on Linux the launcher
  name is the brand.

## `[0x07] LICENSE`

MIT — see [LICENSE](LICENSE).
