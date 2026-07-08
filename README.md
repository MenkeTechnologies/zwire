```
 _______        _____ ____  _____ 
|__  /\ \      / /_ _|  _ \| ____|
  / /  \ \ /\ / / | || |_) |  _|  
 / /_   \ V  V /  | ||  _ <| |___ 
/____|   \_/\_/  |___|_| \_\_____|
```

[![Base](https://img.shields.io/badge/base-chromium%20fork-05d9e8.svg)](#0x02-architecture)
[![Workspace](https://img.shields.io/badge/HUD-tiling%20workspace-ff2a6d.svg)](#0x01-the-hud-workspace)
[![Patches](https://img.shields.io/badge/native%20fork-15%20patches-d300c5.svg)](#0x05-full-hud-fork)
[![Docs](https://img.shields.io/badge/docs-online-05d9e8.svg)](https://menketechnologies.github.io/zwire/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

### `[FORKED CHROMIUM · TILING HUD · CYBERPUNK]`

> *"Not Chrome with a skin — a real Blink engine turned into a keyboard-driven, tiling, cyberpunk workspace."*

zwire is a **Chromium/Blink browser forked into a cyberpunk HUD**. It is not a
theme and not a wrapper — it is a real engine running a full keyboard-driven
workspace layered on top:

- a **tmux-style tiling overlay** — unlimited windows, recursive pane splits,
  each pane an embedded webview of any site;
- a **⌘K command palette**, **vim-style navigation**, and a **find bar**;
- durable, named **session management** with full CRUD + SVG layout previews;
- **HUD reimplementations of Chrome's own internal pages** (extensions,
  settings, history, bookmarks, version) plus a keyboard-remap page and a
  **dashboard** — one searchable, drag-orderable tile grid that launches every
  HUD page *and* every `chrome://` internal page;
- **8 color schemes** — each with a **light variant** — that drive the browser
  chrome natively, with a light/dark toggle that syncs across the HUD, new-tab
  page, and `zpwrchrome` instantly;
- the **`zpwrchrome`** power-tool preloaded against a dedicated profile, so it
  never touches your system Chrome.

The HUD layer (`extensions/hud-internal`) is ~5,400 lines of extension code
across 11 subsystems and 15 pages. Under it, a **15-patch C++ fork** restyles the
*native* chrome the extension layer can't reach.

**zwire is the full fork.** The 15-patch series (`fork/`) compiles a patched
Chromium so the *native* chrome carries the HUD too — sharp tab shapes, the
Share Tech Mono UI font, the neon toolbar, the omnibox, and the 8 HUD schemes
wired into the color mixer + DevTools — the styling an extension can't reach.
See [`fork/README.md`](fork/README.md).

## `[0x00] WHY A REAL BLINK BASE`

`zpwrchrome` is a Manifest V3 extension that needs `userScripts`,
`declarativeNetRequestWithHostAccess`, `nativeMessaging`, `webRequest`, and a
service-worker background (`minimum_chrome_version: 127`). None of that runs on
WebKit (Tauri/Safari) or Servo — **only a real Chromium engine loads it.** The
tiling overlay also iframes arbitrary sites into its panes, which needs the
fork's frame-ancestors bypass (patch 0008) — impossible in a wrapper.

The fork compiles unbranded (`is_chrome_branded=false`), so it carries **no
Google logo and no "for automated testing" banner** (that stripe is exclusive to
Chrome for Testing), and it retains the `--load-extension` switch that preloads
`zpwrchrome` — [removed from *branded* Chrome in version 137][psa]. Stock Google
Chrome can no longer be scripted this way; a Chromium build can.

[psa]: https://groups.google.com/a/chromium.org/g/chromium-extensions/c/1-g8EFx2BBY/m/S0ET5wPjCAAJ

## `[0x01] THE HUD WORKSPACE`

`extensions/hud-internal` is where zwire stops being "a browser" and becomes a
workspace. It is a content-script + page bundle (~5,400 LOC), not a theme.

**`ztmux` — the tiling overlay (`ztmux.js`, ~900 LOC).** A tmux server, in the
browser. Recursive binary pane splits, unlimited windows, and **every pane is a
live webview** (any URL, iframed via the allow-framing patch). Driven by a
**rebindable prefix** (default `Ctrl-b` / `⌥B`; set your own — `C-a` — on the
Keyboard page, with a configurable timeout). 45 prefix actions, all remappable:

- **panes** — split h/v, directional nav (arrows + `h/j/k/l`), resize
  (`H/J/K/L`), zoom, close, swap, rotate, break-to-window, pane numbers;
- **layouts** — cycle even/main/tiled, plus preset grids (4 / 8 / 16 panes);
- **windows** — new, next/prev/last, rename, move, go-to, list, kill;
- **partial synchronize-panes** — broadcast typing to a *chosen subset* of
  panes, not just all-or-nothing (`Ctrl-b e` toggles all, `Ctrl-b E` toggles one);
- **copy mode** — scroll + yank selection into a paste-buffer stack;
- **marks**, **clock**, and a registry-driven **help** overlay.

**Sessions (`pages/sessions.html`).** Durable, named tmux sessions — windows,
panes, and each pane's webview — saved to `chrome.storage` (survives restart).
A full CRUD page: create / rename / duplicate / delete / load / import-export,
per-pane URL editing, and a **live SVG preview** of each window's tiling. Save
the current layout with `Ctrl-b S`, attach a saved one with `Ctrl-b s`.

**Around it:** a **⌘K command palette** (`zpalette`) — which also carries the
scheme picker, the light/dark toggle, and the settings controls — **vim-style
motions** (`zkeys` — jump / scroll / tabs / launch categories), a **find bar**
(`zfind`), a **powerline status bar** (`zstatus`), and **HUD reimplementations**
of `chrome://{extensions,settings,history,bookmarks,downloads,version}` plus
Keyboard, Commands, Sessions, CI, a **Host** console, a **Terminal**, and an
**App Store** page — 14 in all. Every shortcut, and the tmux prefix itself, is
remappable on the Keyboard page.

**Host console (`pages/host.html`).** A HUD tab that talks to the `zwire-host`
native-messaging host directly — inspect and drive the native bridge from inside
the browser.

**App Store (`pages/store.html`).** A HUD storefront tab for the
**MenkeTechnologies app store** — the paid Rust desktop apps and audio plugins,
each a `ZGui.productCard` linking to its live product page to buy. zwire is free
and open source; this is its shop window. On **first run** (`onInstalled`),
`background.js` opens this page once with a welcome modal, so the store is shown
up front — the new-tab page stays untouched.

## `[0x02] ARCHITECTURE`

| Layer | What it is |
|---|---|
| **Base** | The compiled `fork/` build — a patched Chromium (pinned tag `150.0.7871.46`), unbranded release |
| **HUD workspace** | `extensions/hud-internal` — the tiling overlay (`ztmux`), ⌘K palette (`zpalette`), vim nav + keymap (`zkeys`/`zvim`), find (`zfind`), status bar (`zstatus`), the 8-scheme picker (with light/dark toggle), and 14 HUD pages (incl. the Sessions manager, Keyboard remapper, Host console + App Store). MV3 content scripts on `chrome://*/*` + `http(s)`; bridges to a native host. Needs `--extensions-on-chrome-urls` |
| **New tab** | `newtab/` — a `chrome_url_overrides.newtab` extension: the full HUD new-tab (Orbitron, CRT scanlines, neon omnibox), fonts vendored locally |
| **Power-tool** | `extensions/zpwrchrome` — the MV3 power-tool, loaded as a submodule (reuse, not copy) |
| **Theme** | `theme/` — a colors-only Chrome theme. Present but **not** launcher-loaded — the fork's native color mixer (patch 0002) and the HUD skin own the palette, and a static theme applies last and would override them |
| **Launcher** | `bin/zwire` — starts the base against `$ZWIRE_STATE/profile` with `newtab` + `zpwrchrome` + `hud-internal` loaded and `--extensions-on-chrome-urls` set (any dir missing a `manifest.json` is skipped, so a missing submodule degrades gracefully) |
| **Fork** | `fork/` — the 15-patch source build that restyles the native chrome (tab shapes, fonts, borders, omnibox, DevTools schemes) and tunes native behavior (forced zwire new-tab, session restore, framing) the extension layer can't reach; this is what zwire ships as |

A Chrome theme extension changes **colors only** — it cannot reshape tabs, fonts,
or toolbar (those are native C++), and it cannot add a tiling overlay or a
command palette. The HUD extension layer adds the workspace; the `fork/` build
adds the native styling — together they are zwire.

## `[0x03] INSTALL`

```sh
git clone --recurse-submodules https://github.com/MenkeTechnologies/zwire.git
cd zwire
scripts/install.sh          # fetch base + link `zwire` on PATH + rebrand (macOS)
zwire                    # launch
```

`install.sh` downloads the Chromium base into `$ZWIRE_STATE/base`, symlinks
`bin/zwire` into `~/.local/bin`, and on macOS rebrands the base bundle's Dock
name and icon in place. Re-run after a base upgrade.

## `[0x04] USAGE`

```sh
zwire                         # open with the HUD new tab
zwire https://github.com      # open a url
zwire --incognito             # any Chromium flag is passed through
```

Once running, press the tmux prefix (default `Ctrl-b` or `⌥B`) to arm the tiling
overlay, then a pane/window action; `⌘K` opens the command palette. Rebind the
prefix and every shortcut on the Keyboard HUD page.

State lives under `$ZWIRE_STATE`, which defaults to the OS application-data
directory — macOS `~/Library/Application Support/com.menketechnologies.zwire`
(the bundle id), Linux `${XDG_CONFIG_HOME:-~/.config}/zwire`, Windows
`%APPDATA%\zwire`. A one-time launch auto-migrates a legacy `~/.zwire` (and, on
macOS, an earlier bare `~/Library/Application Support/zwire`) into the new
location:

| Path | Purpose |
|---|---|
| `base/` | the Chromium binary |
| `base.path` / `base.version` | resolved binary + pinned revision |
| `profile/` | the dedicated user-data-dir (bookmarks, history, sessions) |
| `ext/` | per-user copy of the loaded extensions, staged from the `.app` bundle at launch (each user needs a writable copy — Chromium writes extension `_metadata/` indexes there) |

Override the base with `ZWIRE_BASE=/path/to/chromium zwire`.

## `[0x05] FULL-HUD FORK`

The extension layer can't restyle the native chrome (tab shapes, fonts, toolbar
are C++), so zwire ships as the fork: `fork/` compiles a patched Chromium
(~100 GB checkout, 1–4 hr first build, ongoing rebase maintenance):

```sh
fork/fetch.sh                                   # depot_tools + pinned Chromium
fork/apply-patches.sh  ~/zwire-chromium/src  # HUD patch series
fork/build.sh          ~/zwire-chromium/src  # the long compile
fork/package.sh        ~/zwire-chromium/src/out/zwire
```

All **15** HUD patches are **authored** against the pinned tag (`150.0.7871.46`)
and verified apply-clean. The nine styling/behavior patches: hard trapezoid tabs
(`tab_style_views.cc`), the cyberpunk palette + the 8 HUD schemes on
frame/toolbar/tabs/omnibox (`chrome_color_mixer.cc`), the Share Tech Mono /
Monaco UI font (`resource_bundle.cc`), a neon cyan under-toolbar line
(`toolbar_view.cc`), a sharp omnibox field (`location_bar_view.cc`), `zwire`
product strings (`BRANDING`), the 8 HUD schemes in the DevTools Theme dropdown
(`design_system_tokens.css` + `main-meta.ts` + `ThemeSupport.ts`), allow-framing
any site so the `ztmux` overlay can iframe pages (`ancestor_throttle.cc`), and
extension-command focus hand-off so the ⌘K palette is typeable from the omnibox
(`extension_keybinding_registry_views.cc`). Plus six patches that force zwire's
behavior over Chromium's defaults: `chrome://newtab` always resolves to the
zwire new-tab (`search.cc`), pinned extension actions never drop to the overflow
puzzle (`toolbar_view.cc`), a host page's `frame-src`/`child-src` CSP never
blocks a sub-frame nav so panes can embed any site (`navigation_request.cc`),
startup restores the last session (`session_startup_pref.cc`), no "Restore
pages?" crash bubble (`session_crashed_bubble_view.cc`), and no navigation block
for a not-yet-registered extension so the new-tab override always loads
(`extension_navigation_throttle.cc`). Apply-clean proves the diff context
matches; `fork/build.sh` is the compile gate. See [`fork/README.md`](fork/README.md)
and [`fork/patches/README.md`](fork/patches/README.md).

**Building it:** the fork is a normal Chromium checkout + `autoninja`, so any box
that can build Chromium can build zwire — no paid infra required. It does **not**
fit on stock GitHub-hosted runners (the ~100 GB checkout exceeds their disk and a
cold build races the 6 h job cap); build it locally, or point a self-hosted
runner at a warm checkout so only the delta rebuilds.

## `[0x06] UPDATING THE BASE`

```sh
scripts/fetch-base.sh              # latest Chromium snapshot
scripts/fetch-base.sh 1656770      # pin an exact revision
scripts/rebrand-macos.sh           # re-apply the rebrand after the swap
```

## `[0x07] NOTES`

- **Native messaging:** `zpwrchrome`'s `pass` and segmented-download features
  need its native host installed — see the
  [zpwrchrome](https://github.com/MenkeTechnologies/zpwrchrome) setup.
- **Developer-mode banner:** unpacked extensions loaded via `--load-extension`
  show Chromium's developer-extensions notice. It is cosmetic; the extensions
  run fully.
- **Cross-platform:** the `zwire` launcher works on macOS (aarch64/x64) and
  Linux (x86_64). The in-place Dock rebrand is macOS-only; on Linux the launcher
  name is the brand.

## `[0x08] LICENSE`

MIT — see [LICENSE](LICENSE).
