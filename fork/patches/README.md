# zbrowser HUD patch map

The whole-browser cyberpunk HUD look requires patching Chromium's native C++
(Views) UI and recompiling — a Chrome theme extension cannot change tab shape,
fonts, borders, or toolbar layout (only colors). This directory holds the patch
series that restyles the chrome. Patches are authored against the pinned tree
(`fork/CHROMIUM_VERSION`), compile-tested, then listed in `series`.

Do not fabricate these blind. Author each against the real checked-out source
(after `fork/fetch.sh`) or by reading the file at the exact tag on
`chromium.googlesource.com`, then verify with a build.

## Target-file map (verified locations)

| # | HUD element | Target file(s) | Approach |
|---|---|---|---|
| 0001 | **Tab shape** | `chrome/browser/ui/views/tabs/tab_style_views.cc` (`TabStyleViewsImpl::GetPath`) | Replace the Refresh bezier path with a sharp/chamfered "squarcle" path for all tab states — the exact edit helium-chromium and brave-core make. `tab.cc` / `tab_strip.cc` for spacing. |
| 0002 | **UI colors** | `chrome/browser/ui/color/chrome_color_mixer.cc`, `ui/color/` | Override the color IDs for frame, toolbar, tab, omnibox background/text to the HUD palette (`#05050a` / `#05d9e8` / `#ff2a6d`). This restyles the *chrome*, beyond what the theme extension can reach. |
| 0003 | **UI font** | `ui/gfx/font_list.cc` / platform font resolution; bundle `Orbitron` + `Share Tech Mono` as resources | Route the browser UI font list to the HUD faces. Tabs/menus/omnibox render in HUD type. |
| 0004 | **Toolbar neon border** | `chrome/browser/ui/views/toolbar/toolbar_view.cc` (`OnPaintBorder`/border) | Draw a cyan→magenta neon separator + subtle glow under the toolbar. |
| 0005 | **Omnibox field** | `chrome/browser/ui/views/location_bar/location_bar_view.cc` | Sharp 2px radius, cyan focus glow — mirror the new-tab omnibox. |
| 0006 | **Product strings** | `chrome/app/chromium_strings.grd` (or `chrome_strings.grd`), `chrome/BUILD.gn` | Replace "Chromium" → "zbrowser" in visible UI strings; keep `is_chrome_branded=false`. |

## Rebasing onto a new Chromium release

1. Bump `fork/CHROMIUM_VERSION` to the new tag.
2. `fork/apply-patches.sh SRC --reverse` on the old tree (or start clean).
3. `fork/fetch.sh` the new tag.
4. `fork/apply-patches.sh SRC` — fix any rejects (`.rej`) against the new source.
5. `fork/build.sh SRC` — compile-test each patch still does what it claims.

The `GetPath` and color-mixer signatures shift between milestones; expect to
re-anchor 0001–0002 most releases. This is the ongoing fork-maintenance cost.
